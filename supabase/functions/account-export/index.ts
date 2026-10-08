import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
type Row = Record<string, unknown>;
const privateHeaders = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value);
export function withoutCredentials(value: unknown): unknown {
    if (Array.isArray(value))
        return value.map(withoutCredentials);
    if (typeof value === 'string' && /^[{[]/.test(value.trim())) {
        try { return withoutCredentials(JSON.parse(value)); } catch { /* Retain ordinary text. */ }
    }
    if (!value || typeof value !== 'object')
        return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !/(?:password|secret|token|jwt|api.?key|authorization|^auth$)/i.test(key)).map(([key, item]) => [key, ['content','text','body'].includes(key) ? item : withoutCredentials(item)]));
}
export async function paged(read: (offset: number) => Promise<Row[]>): Promise<Row[]> {
    const rows: Row[] = [];
    for (let offset = 0;; offset += 500) {
        const page = await read(offset);
        rows.push(...page);
        if (page.length < 500)
            return rows;
    }
}
async function requireResult<T>(request: PromiseLike<{
    data: T | null;
    error: {
        message: string;
    } | null;
}>): Promise<T> {
    const { data, error } = await request;
    if (error)
        throw new Error(error.message);
    if (data === null)
        throw new Error('Missing export result');
    return data;
}
export async function handleExport(request: Request, makeClient:typeof createClient=createClient): Promise<Response> {
    const origin = request.headers.get('origin') || '';
    const allowed = origin === 'https://toumeron.github.io' || /^http:\/\/(localhost|127\.0\.0\.1):(8080|4173)$/.test(origin);
    const headers = { ...privateHeaders, ...(allowed ? { 'Access-Control-Allow-Origin': origin } : {}), Vary: 'Origin' };
    const reply = (value: unknown, status = 200) => Response.json(value, { status, headers });
    if (origin && !allowed)
        return reply({ error: 'Origin denied' }, 403);
    if (request.method === 'OPTIONS')
        return new Response('ok', { headers });
    if (request.method !== 'POST')
        return reply({ error: 'POST required' }, 405);
    let db: SupabaseClient | undefined, owner: string | undefined;
    try {
        const body = await request.text();
        if (body.length > 8192)
            return reply({ error: 'Request too large' }, 413);
        const input = JSON.parse(body);
        const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
        if (!token)
            return reply({ error: 'ログインしてください' }, 401);
        const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!;
        const actor = makeClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
        const auth = await actor.auth.getUser(token);
        if (auth.error || !auth.data.user)
            return reply({ error: 'ログイン状態を確認してください' }, 401);
        owner = auth.data.user.id;
        db = makeClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
        if (!['collect', 'verify'].includes(input.action))
            return reply({ error: '画面を再読み込みしてからエクスポートしてください' }, 409);
        if (typeof input.password !== 'string' || !input.password || input.password.length > 4096)
            return reply({ error: 'パスワードを入力してください' }, 400);
        if (!auth.data.user.email)
            return reply({ error: 'このアカウントにはパスワードの再認証に必要なメールアドレスがありません' }, 400);
        const permitted = await requireResult(db.rpc('account_export_attempt', { p_user_id: owner }));
        if (!permitted)
            return reply({ error: '確認回数の上限に達しました。15分後にもう一度お試しください' }, 429);
        // Use a separate, non-persistent client: password verification must not change
        // the caller's current session or trigger account-switching side effects.
        const verifier = makeClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
        const confirmed = await verifier.auth.signInWithPassword({ email: auth.data.user.email, password: input.password });
        if (confirmed.error || confirmed.data.user?.id !== owner)
            return reply({ error: 'パスワードが正しくありません' }, 403);
        await db.from('account_exports').update({ attempts: 0 }).eq('user_id', owner);
        if (input.action === 'verify')
            return reply({ verified: true, userId: owner });
        // The snapshot exists only for this response; exports are cached on the device.
        const createdAt = new Date().toISOString();
        const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
        const tables: Record<string, Row[]> = {};
        const sources = await requireResult<{
            table: string;
        }[]>(db.rpc('account_export_tables'));
        for (const source of sources)
            tables[source.table] = await paged(offset => requireResult<Row[]>(db!.rpc('account_export_rows', { p_user_id: owner, p_table: source.table, p_offset: offset, p_cutoff: createdAt })));
        // Export room records only for rooms hosted by this account. Membership
        // does not authorize copying another host's room into this archive.
        tables.spaces = (tables.spaces || []).filter(room => room.host_id === owner).map(room => Object.fromEntries(['id','title','host_id','is_active','created_at','speaker_policy','announcement_post_id','recording_url'].filter(key => key in room).map(key => [key, room[key]])));
        // Related originals obey the requesting user's current audience permissions,
        // including private likes/bookmarks and the parents of replies/quotes.
        const linked: Record<string, Map<string, Row>> = { posts: new Map(), comments: new Map(), profiles: new Map(), spaces: new Map(), custom_emojis: new Map() };
        for (const name of Object.keys(linked))
            for (const row of tables[name] || [])
                if (typeof row.id === 'string')
                    linked[name].set(row.id, row);
        const unavailable: {
            table: string;
            id: string;
        }[] = [];
        const readIds = async (table: string, ids: string[], column = 'id') => {
            const rows: Row[] = [];
            for (let start = 0; start < ids.length; start += 100) {
                const batch = ids.slice(start, start + 100);
                const data = await paged(async (offset) => { let query = actor.from(table).select('*').in(column, batch).order(column); query = query.order(['likes', 'reposts', 'reply_reposts', 'comment_likes'].includes(table) ? 'user_id' : 'id'); return requireResult<Row[]>(query.range(offset, offset + 499)); });
                rows.push(...data);
                if (column === 'id')
                    for (const id of batch)
                        if (!data.some(row => row.id === id))
                            unavailable.push({ table, id });
            }
            return rows;
        };
        const ownedPosts = (tables.posts || []).map(row => row.id).filter(uuid);
        for (const table of ['comments', 'likes', 'reposts', 'post_reactions']) {
            const data = await readIds(table, ownedPosts, 'post_id');
            tables[`received_${table}`] = data;
        }
        const pendingPosts = new Set<string>(), pendingComments = new Set<string>(), visitedPosts = new Set(linked.posts.keys()), visitedComments = new Set(linked.comments.keys());
        const scan = (value: unknown) => {
            if (Array.isArray(value)) {
                value.forEach(scan);
                return;
            }
            if (!value || typeof value !== 'object')
                return;
            for (const [key, item] of Object.entries(value)) {
                if (uuid(item) && ['post_id', 'parent_id', 'parent_post_id'].includes(key) && !visitedPosts.has(item))
                    pendingPosts.add(item);
                if (uuid(item) && ['comment_id', 'parent_comment_id', 'parent_reply_id', 'quoted_reply_id'].includes(key) && !visitedComments.has(item))
                    pendingComments.add(item);
                if (item && typeof item === 'object')
                    scan(item);
            }
        };
        scan(tables);
        while (pendingPosts.size || pendingComments.size) {
            for (const [table, pending, visited] of [['posts', pendingPosts, visitedPosts], ['comments', pendingComments, visitedComments]] as const) {
                const ids = [...pending];
                pending.clear();
                ids.forEach(id => visited.add(id));
                for (const row of await readIds(table, ids)) {
                    linked[table].set(String(row.id), row);
                    scan(row);
                }
            }
        }
        const ownedComments = (tables.comments || []).map(row => row.id).filter(uuid);
        for (const table of ['comment_likes', 'comment_reactions', 'reply_reposts'])
            tables[`received_${table}`] = await readIds(table, ownedComments, 'comment_id');
        const profileIds = new Set<string>([owner]);
        const scanIdentities = (value: unknown) => {
            if (Array.isArray(value)) {
                value.forEach(scanIdentities);
                return;
            }
            if (!value || typeof value !== 'object')
                return;
            for (const [key, item] of Object.entries(value)) {
                if (uuid(item) && /(?:user|owner|author|follower|followee|member|creator|actor|host|recipient)_id$/.test(key))
                    profileIds.add(item);
                if (item && typeof item === 'object')
                    scanIdentities(item);
            }
        };
        scanIdentities([tables, ...Object.values(linked).flatMap(map => [...map.values()])]);
        // Public profile fields only for other people; their settings are not part of
        // this account's export even if an older permissive profile policy allows it.
        for (let start = 0; start < profileIds.size; start += 100) {
            const profiles = await requireResult<Row[]>(actor.from('profiles').select('id,username,display_name,avatar_url,cover_url,bio,created_at,is_official').in('id', [...profileIds].slice(start, start + 100)));
            for (const profile of profiles)
                if (profile.id !== owner)
                    linked.profiles.set(String(profile.id), profile);
        }
        const emojis = await paged(offset => requireResult<Row[]>(actor.from('custom_emojis').select('*').order('id').range(offset, offset + 499)));
        const serialized = JSON.stringify([tables, ...Object.values(linked).flatMap(map => [...map.values()])]);
        for (const emoji of emojis)
            if (typeof emoji.name === 'string' && (serialized.includes(emoji.name)||serialized.includes(encodeURIComponent(emoji.name))||serialized.includes(String(emoji.id))))
                linked.custom_emojis.set(String(emoji.id), emoji);
        const uploads = await paged(offset => requireResult<Row[]>(db!.rpc('account_export_uploads', { p_user_id: owner, p_offset: offset })));
        const snapshot = withoutCredentials({ version: 1, userId: owner, createdAt, expiresAt, account: { id: owner, email: auth.data.user.email, created_at: auth.data.user.created_at, user_metadata: auth.data.user.user_metadata }, tables, related: Object.fromEntries(Object.entries(linked).map(([name, rows]) => [name, [...rows.values()]])), uploads, unavailable });
        const mediaReads: { url: string; downloadUrl: string }[] = [];
        for (const file of uploads) {
            // Read grants for existing originals only. Never grant an export upload.
            const signed = await requireResult(db.storage.from(String(file.bucket_id)).createSignedUrl(String(file.name), 3600));
            mediaReads.push({ url: `storage://${file.bucket_id}/${file.name}`, downloadUrl: signed.signedUrl });
        }
        return reply({ snapshot, userId: owner, createdAt, expiresAt, uploads: mediaReads });
    }
    catch (error) {
        console.error('Account export failed', error instanceof Error ? error.message : 'Unknown');
        return reply({ error: 'データのエクスポートに失敗しました。もう一度お試しください' }, 500);
    }
}
if (import.meta.main)
    Deno.serve(request=>handleExport(request));
