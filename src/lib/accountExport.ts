import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Home, UserRound, Search, Bell, MessageSquare, Settings as SettingsIcon, CircleEllipsis, Heart, MessageCircle, Plus, Bookmark, Upload, ArrowLeft, X, Pin, Sun, Moon, Mic, Images, BadgeCheck } from 'lucide-react';
import { RepostIcon } from '../components/feed/RepostIcon';
import archiveDesignCss from '../index.css?inline';
import { supabase } from './supabase';
import { readOfflineBookmarks } from './offlineBookmarks';
import { savedPreviewImage } from './linkPreviewCache';
import { stickerUrl, type CustomSticker } from './stickers';
import { listModels } from './avatarModelStore';
type Row = Record<string, unknown>;
export type AccountArchive = {
    version: number;
    userId: string;
    createdAt: string;
    expiresAt: string;
    account: Row;
    tables: Record<string, Row[]>;
    related: Record<string, Row[]>;
    uploads: Row[];
    unavailable: unknown[];
    local?: Record<string, unknown>;
    assets?: Record<string, string>;
    missingAssets?: string[];
};
type Receipt = {
    cached: boolean;
    viewerVersion: number;
    zip: Blob;
    userId: string;
    createdAt: string;
    expiresAt: string;
    missingCount?: number;
    cacheWarning?: string;
};
type Collection = {
    snapshot: AccountArchive;
    userId: string;
    createdAt: string;
    expiresAt: string;
    uploads?: { url: string; downloadUrl: string }[];
};
/** Only this device retains the completed ZIP. Passwords and signed URLs are not stored. */
export async function localAccountExport(userId: string, value?: Receipt): Promise<Receipt | null> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('lime-account-exports', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('archives', { keyPath: 'userId' });
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('端末内の保存データを開けませんでした'));
        request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => db.close();
            const transaction = db.transaction('archives', 'readwrite');
            const store = transaction.objectStore('archives');
            let result: Receipt | null = null;
            if (value) { store.put(value); result = value; }
            else {
                const read = store.get(userId);
                read.onsuccess = () => {
                    const saved = read.result as Receipt | undefined;
                    if (saved && saved.userId === userId && saved.viewerVersion === 3 && saved.zip instanceof Blob && Date.parse(saved.expiresAt) > Date.now()) result = saved;
                    else if (saved) store.delete(userId);
                };
            }
            transaction.oncomplete = () => { db.close(); resolve(result); };
            transaction.onabort = () => { db.close(); reject(transaction.error || new Error('端末内の保存に失敗しました')); };
            transaction.onerror = () => { /* onabort reports the failure. */ };
        };
    });
}
type Entry = {
    name: string;
    blob: Blob;
};
export function redactExport(value: unknown): unknown {
    if (Array.isArray(value))
        return value.map(redactExport);
    if (typeof value === 'string' && /^[{[]/.test(value.trim())) {
        try {
            return redactExport(JSON.parse(value));
        }
        catch { }
    }
    if (!value || typeof value !== 'object')
        return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !/(?:password|secret|token|jwt|api.?key|authorization|^auth$)/i.test(key)).map(([key, item]) => [key, ["content","text","body"].includes(key)?item:redactExport(item)]));
}
export function exportLocalPreferences(userId: string, storage: Storage = localStorage): Record<string, unknown> {
    const output: Record<string, unknown> = {};
    for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)!;
        const own = key.startsWith(`limeai:${userId}:`) || key === `lime-companion:${userId}` || ['lime_recommendation_likes:', 'lime_recommendation_liked_ids:', 'lime_recommendation_impressions:'].some(prefix => key === prefix + userId) || key.startsWith(`lime_account_integrations:`) && key.endsWith(`:${userId}`);
        const shared = ['theme', 'search:recent', 'lime_emoji_pref', 'lime_timeline_background_url', 'limeai-voice', 'lime_search_exclude_bluesky', 'lime_search_page_tab'].includes(key);
        if (!own && !shared)
            continue;
        const raw = storage.getItem(key);
        try {
            output[key] = redactExport(JSON.parse(raw || 'null'));
        }
        catch {
            output[key] = raw;
        }
    }
    return output;
}
export function checkExportAbort(signal?:AbortSignal):void {
 if(signal?.aborted)throw new DOMException('エクスポートを中断しました','AbortError');
}
const encoder = new TextEncoder();
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++)
    n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
async function crc(blob: Blob, signal?: AbortSignal) { let n = 0xffffffff; for (let offset = 0; offset < blob.size; offset += 1048576) {
    checkExportAbort(signal);
    for (const byte of new Uint8Array(await blob.slice(offset, offset + 1048576).arrayBuffer()))
        n = crcTable[(n ^ byte) & 255] ^ (n >>> 8);
} return (n ^ 0xffffffff) >>> 0; }
function header(size: number, values: [
    number,
    number,
    number
][]) { const buffer = new ArrayBuffer(size), view = new DataView(buffer); for (const [offset, value, width] of values)
    width === 2 ? view.setUint16(offset, value, true) : view.setUint32(offset, value, true); return buffer; }
/** Stored ZIP entries keep large media as Blob parts instead of a second full in-memory copy. */
export async function accountZip(entries: Entry[], signal?: AbortSignal): Promise<Blob> {
    const parts: BlobPart[] = [], central: BlobPart[] = [];
    let offset = 0, centralSize = 0;
    for (const entry of entries) {
        checkExportAbort(signal);
        if (!/^[\w./-]+$/.test(entry.name) || entry.name.split('/').includes('..'))
            throw new Error('Invalid archive path');
        const name = encoder.encode(entry.name), sum = await crc(entry.blob, signal), size = entry.blob.size;
        if (size > 0xffffffff || offset + size > 0xffffffff || entries.length > 65535)
            throw new Error('エクスポートが大きすぎます');
        parts.push(header(30, [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x800, 2], [12,33,2], [14, sum, 4], [18, size, 4], [22, size, 4], [26, name.length, 2]]), name, entry.blob);
        central.push(header(46, [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x800, 2], [14,33,2], [16, sum, 4], [20, size, 4], [24, size, 4], [28, name.length, 2], [42, offset, 4]]), name);
        offset += 30 + name.length + size;
        centralSize += 46 + name.length;
    }
    return new Blob([...parts, ...central, header(22, [[0, 0x06054b50, 4], [8, entries.length, 2], [10, entries.length, 2], [12, centralSize, 4], [16, offset, 4]])], { type: 'application/zip' });
}
export function archiveAssetUrls(value: unknown): string[] {
    const urls = new Set<string>();
    function visit(item: unknown, key = '') {
        if (typeof item === 'string' && (/image|avatar|cover|thumb|attachment|recording|audio|video|background|model/i.test(key) || key === 'dataUrl') && /^(https?:\/\/|data:)/.test(item))
            urls.add(item);
        else if (Array.isArray(item))
            item.forEach(value => visit(value, key));
        else if (item && typeof item === 'object')
            for (const [name, value] of Object.entries(item))
                visit(value, (/avatar/i.test(key)||name === 'url' && /attachment|media/i.test(key)) ? key : name);
    }
    visit(value);
    return [...urls];
}
async function exportRequest(body: Record<string, unknown>, signal: AbortSignal): Promise<Collection> {
    checkExportAbort(signal);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session)
        throw new Error('ログインしてください');
    const result = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/account-export`, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    const value = await result.json();
    if (!result.ok)
        throw new Error(value.error || 'データを保存できませんでした');
    return value;
}
export async function createAccountExport(userId: string, password: string, progress: (text: string) => void, signal: AbortSignal): Promise<Receipt> {
    progress('処理中…');
    const saved = await localAccountExport(userId).catch(() => null);
    const job = await exportRequest({ action: saved ? 'verify' : 'collect', password }, signal);
    password = '';
    const ensureOwner = async () => { checkExportAbort(signal); const { data: { session } } = await supabase.auth.getSession(); if (session?.user.id !== userId)
        throw new Error('アカウントが変更されました'); };
    await ensureOwner();
    if (job.userId !== userId) throw new Error('アカウントの確認に失敗しました');
    if (saved) return { ...saved, cached: true };
    const archive = job.snapshot;
    if (!archive || archive.userId !== userId) throw new Error('保存データを取得できませんでした');
    archive.local = exportLocalPreferences(userId);
    archive.assets = {};
    archive.missingAssets = [];
    const entries: Entry[] = [], cached = new Map<string, Blob>();
    const offline = await readOfflineBookmarks(userId, false).catch(() => null);
    if (offline) {
        archive.local.offlineBookmarks = { ...offline, assets: [] };
        for (const asset of offline.assets)
            cached.set(asset.url, new Blob([asset.bytes], { type: asset.type }));
    }
    // Save only models referenced by this account's current companion/AI preferences.
    const preferences = JSON.stringify(archive.local);
    for (const model of await listModels().catch(() => []))
        if (preferences.includes(model.id)) {
            const path = `assets/model-${entries.length}.bin`;
            entries.push({ name: path, blob: model.blob });
            (archive.local.models ??= [] as unknown[]);
            (archive.local.models as unknown[]).push({ ...model, blob: undefined, path });
        }
    archive.local.fontCss = '';
    const loadedFonts = new Set(performance.getEntriesByType('resource').map(entry => entry.name).filter(url => /^https:\/\/fonts\.gstatic\.com\//.test(url)));
    if (loadedFonts.size) {
        progress('表示用フォントを保存中…');
        for (const link of Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')))
            if (link.href.startsWith('https://fonts.googleapis.com/')) {
                try {
                    const response = await fetch(link.href, { signal });
                    if (!response.ok) continue;
                    const css = await response.text();
                    for (const face of css.match(/@font-face\s*\{[^}]+\}/g) || []) {
                        const url = face.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/)?.[1];
                        if (!url || !loadedFonts.has(url)) continue;
                        let path = archive.assets[url];
                        if (!path) {
                            const font = await fetch(url, { signal });
                            if (!font.ok) continue;
                            const blob = await font.blob();
                            path = `assets/font-${entries.length}.woff2`;
                            entries.push({ name: path, blob });
                            archive.assets[url] = path;
                        }
                        archive.local.fontCss += face.split(url).join(path);
                    }
                } catch { checkExportAbort(signal); }
            }
    }
    if (/"(?:is_official|isOfficial)":true/.test(JSON.stringify([archive.tables, archive.related]))) {
        try {
            const response = await fetch(`${import.meta.env.BASE_URL}verified.png`, { signal });
            if (response.ok) {
                const blob = await response.blob();
                if (blob.type.startsWith('image/')) {
                    entries.push({ name: 'assets/verified.png', blob });
                    archive.local.verifiedBadge = 'assets/verified.png';
                }
            }
        } catch { checkExportAbort(signal); }
    }
    const previews: Record<string, unknown> = {};
    try {
        const saved = JSON.parse(localStorage.getItem('lime-link-previews-v1') || '{}');
        const posts = JSON.stringify(archive);
        for (const [url, value] of Object.entries(saved))
            if (posts.includes(url))
                previews[url] = value;
    }
    catch { /* No local previews. */ }
    archive.local.linkPreviews = previews;
    const emojis = [...(archive.tables.custom_emojis || []), ...(archive.related.custom_emojis || [])];
    const extra = emojis.map(row => stickerUrl(row as CustomSticker)).filter((url): url is string => !!url);
    const urls = [...new Set([...archiveAssetUrls(archive), ...extra, ...(job.uploads || []).map(file => file.url)])];
    const signed = new Map((job.uploads || []).map(file => [file.url, file.downloadUrl]));
    let processed = 0;
    // Two workers avoid a burst of concurrent downloads on older iOS devices.
    const queue = [...urls];
    async function worker() {
        for (let url = queue.shift(); url; url = queue.shift()) {
            checkExportAbort(signal);
            let blob = cached.get(url) || await savedPreviewImage(url).catch(() => null);
            const proxyFirst = /^https:\/\/(cdn\.bsky\.app|pbs\.twimg\.com|melonbooks\.akamaized\.net|(?:media|proxy)\.misskeyusercontent\.jp|media\d*\.tenor\.com)\//i.test(url);
            const proxy = async () => {
                try {
                    const { data, error, response } = await supabase.functions.invoke('link-preview', { body: { mode: 'image', url }, signal });
                    if (!error && data instanceof Blob) {
                        const mime = response?.headers.get('x-lime-image-type') || data.type;
                        if (mime.startsWith('image/')) return new Blob([data], { type: mime });
                    }
                } catch { checkExportAbort(signal); }
                return null;
            };
            if (!blob && proxyFirst) blob = await proxy();
            if (!blob && !proxyFirst) {
                try {
                    const media = await fetch(signed.get(url) || url, { signal });
                    if (media.ok) {
                        const downloaded = await media.blob();
                        if (/^(image|video|audio)\//.test(downloaded.type) || downloaded.type === 'application/octet-stream') blob = downloaded;
                    }
                } catch { checkExportAbort(signal); }
                if (!blob && !url.startsWith('storage:')) blob = await proxy();
            }
            if (blob && blob.size) {
                const mime = blob.type.split(';')[0];
                const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'video/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg' } as Record<string, string>)[mime] || 'bin';
                const path = `assets/media-${entries.length}.${extension}`;
                entries.push({ name: path, blob });
                archive.assets![url] = path;
                // Public bucket URLs pointing to an owned object use the same local bytes.
                if (url.startsWith('storage://')) {
                    const object = url.slice(10);
                    archive.assets![`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/${object}`] = path;
                }
            }
            else
                archive.missingAssets!.push(url);
            progress(`添付データを保存中… ${++processed} / ${urls.length}`);
        }
    }
    await Promise.all([worker(), worker()]);
    await ensureOwner();
    progress('オフライン閲覧用ファイルを作成中…');
    const json = JSON.stringify(archive);
    entries.push({ name: 'data.json', blob: new Blob([json], { type: 'application/json' }) }, { name: 'data.js', blob: new Blob([`window.LIME_ARCHIVE=${json.replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')};`], { type: 'text/javascript' }) }, { name: 'index.html', blob: new Blob([offlineArchiveHtml()], { type: 'text/html' }) }, { name: 'README.txt', blob: new Blob(['ZIPを展開しindex.htmlをブラウザで開いてください。ネット接続は不要です。data.jsonには保存データの全項目があります。削除済み・閲覧権限のない投稿や取得できなかった添付ファイルは含まれません。missingAssetsとunavailableを確認できます。再利用用データはこの端末内だけに7日間保存します。ダウンロードしたファイルは自動削除されません。'], { type: 'text/plain' }) });
    const zip = await accountZip(entries, signal);
    await ensureOwner();
    const receipt: Receipt = { cached: false, viewerVersion: 3, zip, userId, createdAt: job.createdAt, expiresAt: job.expiresAt, missingCount: archive.missingAssets.length };
    progress('端末内に保存中…');
    await localAccountExport(userId, receipt).catch(() => {
        receipt.cacheWarning = '端末内の再利用用データを保存できませんでした。ダウンロードしたZIPは閲覧できます。';
    });
    await ensureOwner();
    return receipt;
}
/** Offline pages share LimeNote's design tokens and SVG components, not text icon substitutes. */
export function offlineArchiveHtml(): string {
    const components = {home: Home, user: UserRound, search: Search, bell: Bell, chat: MessageSquare, settings: SettingsIcon, more: CircleEllipsis, heart: Heart, repost: RepostIcon, reply: MessageCircle, plus: Plus, bookmark: Bookmark, share: Upload, back: ArrowLeft, close: X, pin: Pin, sun: Sun, moon: Moon, mic: Mic, image: Images, check: BadgeCheck};
    const icons = Object.fromEntries(Object.entries(components).map(([name, component]) => [name, renderToStaticMarkup(createElement(component, {className:'icon', 'aria-hidden':true}))]));
    return String.raw`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'"><title>LimeNote</title><style>${archiveDesignCss}
:root{--archive-header-row:64px}*{box-sizing:border-box}[hidden]{display:none!important}html,body{margin:0;min-height:100%;background:hsl(var(--background));color:hsl(var(--foreground))}body{font-family:'M PLUS Rounded 1c',system-ui,-apple-system,sans-serif;background-image:none}button,input{font:inherit;color:inherit}button{cursor:pointer;border:0;background:transparent;padding:0}button:focus-visible,a:focus-visible{outline:2px solid hsl(var(--primary));outline-offset:3px}button:hover{background:hsl(var(--primary)/.06)}a{color:hsl(var(--primary));text-decoration:none}a:hover{text-decoration:underline}.icon{width:20px;height:20px;flex-shrink:0;vertical-align:middle;fill:none;stroke:currentColor;stroke-width:2}button svg{pointer-events:none}.muted{color:hsl(var(--muted-foreground))}.name{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.handle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.badge{color:#eab308;display:inline-flex;flex-shrink:0}.badge .icon,.badge img{width:16px;height:16px}.name,.logo,.profile h2{font-family:Zen Maru Gothic,M PLUS Rounded 1c,sans-serif}.avatar,.avatar-fallback{width:44px;height:44px;border-radius:50%;object-fit:cover;flex-shrink:0}.avatar-fallback{display:inline-flex;align-items:center;justify-content:center;background:hsl(var(--primary)/.12);color:hsl(var(--primary));font-weight:700}.shell{display:grid;grid-template-columns:clamp(210px,23vw,320px) minmax(0,1fr) clamp(210px,25vw,380px);min-height:100dvh}.sidebar{position:sticky;top:0;height:100dvh;display:flex;flex-direction:column;padding:28px 20px 16px;min-width:0;z-index:20}.logo{display:flex;gap:8px;font-size:24px;font-weight:900;align-items:center;height:36px}.logo span:first-child{background:var(--gradient-primary);background-clip:text;-webkit-background-clip:text;color:transparent}.logo span:last-child{color:hsl(var(--accent))}nav{display:flex;flex-direction:column;gap:4px;margin-top:28px;overflow:auto;min-height:0}nav button{display:flex;align-items:center;gap:20px;min-height:52px;padding:10px 0;text-align:left;border-radius:999px;font-size:20px;white-space:nowrap}nav button .icon{width:28px;height:28px}nav button.active{font-weight:700;color:hsl(var(--primary))}.sidebar-footer{display:flex;align-items:center;gap:12px;margin-top:auto;padding-top:24px;min-width:0}.sidebar-footer>div{min-width:0}.offline-label{display:block;font-size:12px;margin-top:2px}.column{border-inline:1px solid hsl(var(--border)/.6);min-width:0}.dark .column,.dark article,.dark header,.dark .tabs,.dark .reply-thread{border-color:#2f3336}header{position:sticky;top:0;z-index:15;background:hsl(var(--background)/.93);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:1px solid hsl(var(--border)/.6)}.header-row{height:64px;display:flex;align-items:center;gap:12px;padding:0 16px}.header-row h1{font-weight:700;font-size:20px;line-height:1.3;margin:0;min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.icon-button{width:36px;height:36px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}.header-search{padding:0 16px 12px;height:56px}.search-wrap{display:flex;align-items:center;gap:8px;border:1px solid hsl(var(--border));border-radius:999px;padding:9px 14px}.search-wrap input{width:100%;min-width:0;outline:none;border:0;background:transparent;font-size:15px}.tabs{position:sticky;top:calc(var(--archive-header-row) + var(--archive-search-height,0px) + 1px);z-index:14;background:hsl(var(--background)/.94);display:flex;overflow-x:auto;border-top:1px solid hsl(var(--border)/.3);scrollbar-width:none}.tabs button{position:relative;flex:1;padding:14px 12px;white-space:nowrap;font-size:15px;color:hsl(var(--muted-foreground))}.tabs button.active{color:hsl(var(--foreground));font-weight:700}.tabs button.active:after{content:'';position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:52px;height:4px;background:hsl(var(--primary));border-radius:999px}.profile{border-bottom:1px solid hsl(var(--border)/.6)}.cover{width:100%;height:180px;object-fit:cover;background:hsl(var(--primary)/.08);display:block}.profile-body{padding:0 16px 16px}.profile-avatar{width:96px;height:96px;border:4px solid hsl(var(--background));position:relative;margin-top:-48px;font-size:32px}.profile h2{font-size:22px;margin:8px 0 0;font-weight:800}.profile p{margin:10px 0;white-space:pre-wrap;overflow-wrap:anywhere}.profile-counts{display:flex;gap:20px;font-size:14px}.archive-info{font-size:12px;padding:10px 16px;color:hsl(var(--muted-foreground));border-bottom:1px solid hsl(var(--border)/.6)}article{padding:12px 16px;border-bottom:1px solid hsl(var(--border)/.6);min-width:0}article:hover{background:hsl(var(--primary)/.02)}.post-layout{display:flex;align-items:flex-start;gap:12px;min-width:0}.post-layout>.avatar,.post-layout>.avatar-fallback{margin-top:4px}.post-content{min-width:0;flex:1}.who{display:flex;align-items:center;gap:4px;min-width:0;line-height:24px}.who .name{max-width:50%;flex-shrink:0}.who .time{white-space:nowrap;flex-shrink:0;font-size:14px}.who .icon-button{margin-left:auto;width:24px;height:24px}.text{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6;margin:2px 0 0;font-size:16px}.text:empty{display:none}.photos{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px;max-width:100%;border-radius:16px;overflow:hidden;margin-top:12px}.photos:empty{display:none}.photos.single{display:block;width:fit-content}.photos img{width:100%;max-height:300px;object-fit:cover;display:block;cursor:zoom-in;background:hsl(var(--muted))}.photos.single img{width:auto;max-width:100%;object-fit:contain}.post-video{width:100%;max-height:340px;border-radius:16px;margin-top:12px}.quote,.preview{border:1px solid hsl(var(--border));border-radius:16px;padding:12px;margin-top:12px;overflow:hidden}.quote .avatar,.quote .avatar-fallback{width:24px;height:24px}.quote .who{gap:6px}.quote .name{max-width:50%}.quote .time{font-size:13px}.quote .text{margin-top:6px}.preview{display:block;color:inherit;padding:0;max-width:520px;text-decoration:none!important}.preview img{width:100%;height:140px;object-fit:cover}.preview>div{padding:10px 12px}.preview-title{font-weight:600;display:block;overflow-wrap:anywhere}.emoji{display:inline-block;height:1.5em;width:auto;max-width:3em;vertical-align:middle}.stamp{display:block;height:140px;max-width:100%;object-fit:contain;margin-top:8px}.actions{height:36px;display:flex;align-items:center;gap:4px;margin-top:12px;color:hsl(var(--muted-foreground));min-width:0}.action{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;border-radius:999px;padding:0 8px;font-size:14px;font-weight:700;white-space:nowrap}.action .icon{width:20px;height:20px}.actions .push{margin-left:auto}.liked,.saved{color:hsl(var(--primary))}.liked .icon{fill:currentColor}.reposted{color:#22c55e}.pin{display:flex;align-items:center;gap:12px;color:hsl(var(--muted-foreground));font-size:14px;font-weight:600;margin-bottom:4px;padding-left:28px}.pin .icon{width:16px;height:16px}.reaction-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.reaction-pill{display:inline-flex;align-items:center;gap:5px;padding:5px 9px;border-radius:12px;background:hsl(var(--primary)/.09);font-size:13px}.reaction-pill img{height:20px}.reply-thread{position:relative}.reply-thread:before{content:'';position:absolute;left:37px;top:60px;bottom:0;width:2px;background:hsl(var(--border))}.reply-target{font-size:14px;margin-bottom:4px;color:hsl(var(--primary))}.discover{position:sticky;top:0;height:100dvh;overflow-y:auto;padding:20px;min-width:0}.discover-card{border:1px solid hsl(var(--border));border-radius:20px;margin-top:20px;overflow:hidden}.discover-card h2{font-size:20px;font-weight:800;margin:0;padding:16px}.discover-card button{display:flex;align-items:center;gap:10px;padding:12px 16px;width:100%;text-align:left;min-width:0}.discover-card button>div{min-width:0}.discover-card .name{display:block}.notice{padding:32px 16px;text-align:center;color:hsl(var(--muted-foreground))}.space{background:hsl(var(--primary));border-radius:20px;color:white;padding:20px;margin-top:8px;overflow-wrap:anywhere}.space .host{display:flex;align-items:center;gap:8px;font-size:14px}.space .avatar,.space .avatar-fallback{width:28px;height:28px}.space h2{font-size:22px;line-height:1.4;font-weight:800;margin:18px 0}.space p{font-size:14px;margin:8px 0}.space-ended{display:flex;gap:6px;align-items:center;background:#ffffff20;padding:10px 14px;border-radius:999px;margin-top:20px}.list-row{display:flex;align-items:center;gap:12px}.list-row>div{min-width:0;flex:1}.chat-bubble{margin:12px 0;padding:12px 16px;background:hsl(var(--muted)/.6);border-radius:20px;overflow-wrap:anywhere}.chat-bubble.user{background:hsl(var(--primary)/.12)}.history-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 0}.history-row span{overflow-wrap:anywhere}.bottom-nav{display:none;flex-direction:row;margin:0;gap:0;overflow:visible}.drawer-scrim{display:none}.mobile-menu{display:none}#more{display:block;margin:16px auto;padding:10px 20px;color:hsl(var(--primary));border-radius:999px}#more[hidden]{display:none}dialog{max-width:min(90vw,620px);max-height:90dvh;width:100%;padding:20px;border:1px solid hsl(var(--border));border-radius:24px;background:hsl(var(--background));color:hsl(var(--foreground));overflow:auto}dialog::backdrop{background:#000b;backdrop-filter:blur(4px)}.dialog-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}.dialog-head h2{font-size:20px;font-weight:700}.image-dialog{max-width:100vw;width:100vw;height:100dvh;max-height:100dvh;border:0;border-radius:0;padding:0;background:#000}.image-dialog .dialog-head{position:absolute;top:16px;left:16px;z-index:2;color:white}.image-dialog img{display:block;max-width:100%;max-height:100%;width:100%;height:100%;object-fit:contain}.image-dialog .icon-button{background:#0008}.image-dialog .dialog-head a{color:white}.dark .space{background:hsl(var(--primary)/.8)}
@media(min-width:640px){.sidebar nav [data-tab="bookmarks"],.sidebar nav [data-tab="spaces"]{display:none}}
@media(min-width:640px) and (max-width:1199px){.shell{grid-template-columns:72px minmax(0,1fr) 240px}.sidebar{padding:16px 12px}.sidebar .logo,.sidebar nav span,.sidebar-footer>div{display:none}.sidebar nav{margin-top:0}.sidebar nav button{width:48px;height:48px;justify-content:center;padding:0;gap:0}.sidebar nav button .icon{width:24px;height:24px}.sidebar-footer{padding:16px 2px}.discover{padding:12px}}
@media(max-width:639px){:root{--archive-header-row:56px}.shell{display:block}.column{border:0;padding-bottom:calc(64px + env(safe-area-inset-bottom))}.discover{display:none}.sidebar{position:fixed;left:0;top:0;bottom:0;height:100dvh;width:min(82vw,360px);padding:24px;transform:translateX(-100%);transition:transform .2s ease;background:hsl(var(--background));z-index:50}.sidebar.open{transform:translateX(0)}.sidebar .logo{display:flex}.sidebar nav{margin-top:20px}.sidebar nav button{min-height:48px;font-size:18px}.sidebar-footer{padding-top:16px}.drawer-scrim.open{display:block;position:fixed;inset:0;background:#0008;z-index:40}.mobile-menu{display:inline-flex}.header-row{height:56px}.header-row h1{font-size:18px}.header-search{padding-bottom:10px}.tabs button{padding:12px 8px;font-size:14px}.profile .cover{height:140px}.profile-avatar{width:80px;height:80px;margin-top:-40px}.profile h2{font-size:20px}.bottom-nav{position:fixed;bottom:0;left:0;right:0;height:calc(56px + env(safe-area-inset-bottom));padding-bottom:env(safe-area-inset-bottom);display:flex;align-items:center;justify-content:space-around;border-top:1px solid hsl(var(--border));background:hsl(var(--background)/.94);backdrop-filter:blur(20px);z-index:25}.bottom-nav button{width:48px;height:48px;display:flex;align-items:center;justify-content:center}.bottom-nav .icon{width:24px;height:24px}.bottom-nav .active{color:hsl(var(--primary))}article{padding:12px}.actions{height:32px;margin-top:8px;gap:0}.action{height:32px;padding:0 6px}.who .time{font-size:12px}.who .name{max-width:45%}.who .handle{font-size:14px}.reply-thread:before{left:33px}.archive-info{padding:8px 12px}.photos img{max-height:360px}.discover-card{margin-top:12px}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
</style></head><body><div class="drawer-scrim" id="scrim"></div><div class="shell"><aside class="sidebar" id="sidebar"><button class="logo" data-tab="posts" aria-label="LimeNote"><span>Lime</span><span id="logo-suffix">Note</span></button><nav id="nav"></nav><div class="sidebar-footer" id="account"></div></aside><main class="column"><header><div class="header-row"><button class="icon-button mobile-menu" id="menu" aria-label="メニューを開く"></button><button class="icon-button" id="back" aria-label="戻る" hidden></button><h1 id="title">プロフィール</h1><button class="icon-button" id="search-toggle" aria-label="検索を開く"></button><button class="icon-button" id="theme" aria-label="配色を切り替える"></button></div><div class="header-search" id="header-search" hidden><label class="search-wrap"><span id="search-icon" class="muted"></span><input id="search" aria-label="保存データを検索" placeholder="検索"></label></div></header><section id="profile" class="profile"></section><div class="tabs" id="tabs"></div><div id="info" class="archive-info"></div><div id="feed"></div><button id="more" hidden>さらに表示</button></main><aside class="discover" id="discover"></aside></div><nav class="bottom-nav" id="bottom"></nav><dialog id="image" class="image-dialog"><div class="dialog-head"><button class="icon-button" data-close="image" aria-label="画像を閉じる"></button><a id="save-image" download>画像を保存</a></div><img id="large" alt="拡大画像"></dialog><dialog id="details"><div class="dialog-head"><h2 id="details-title"></h2><button class="icon-button" data-close="details" aria-label="閉じる"></button></div><div id="details-body"></div></dialog><script src="data.js"></script><script>
const I=${JSON.stringify(icons)};
const D=window.LIME_ARCHIVE||{},T=D.tables||{},R=D.related||{},A=D.assets||{},L=D.local||{};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const table=k=>Array.isArray(T[k])?T[k]:[],list=v=>Array.isArray(v)?v:[],unique=rows=>[...new Map(rows.filter(r=>r&&typeof r==='object').map(r=>[r.id||r.uri||JSON.stringify(r),r])).values()];
const posts=unique([...table('posts'),...list(R.posts),...list(L.offlineBookmarks?.posts)]),comments=unique([...table('comments'),...table('received_comments'),...list(R.comments)]),profiles=new Map(unique([...list(R.profiles),...table('profiles')]).map(p=>[p.id,p]));
const own=profiles.get(D.userId)||D.account?.user_metadata||{},emojis=unique([...table('custom_emojis'),...list(R.custom_emojis)]),spaces=unique([...table('spaces'),...list(R.spaces)]).filter(s=>s.host_id===D.userId);
const media=url=>{const path=A[url];return typeof path==='string'&&/^assets\/[\w./-]+$/.test(path)&&!path.split('/').includes('..')?path:'';},source=row=>String(row.content??row.text??row.body??'');
const icon=name=>I[name]||'',date=value=>value&&!Number.isNaN(Date.parse(value))?new Date(value).toLocaleString('ja-JP'):'';
const isPinned=id=>table('profile_pins').some(p=>p.post_id===id)||own.pinned_post_id===id;
function person(row){return row.author||profiles.get(row.user_id||row.author_id||row.host_id)||{};}
function avatar(p,extra=''){const url=media(p.avatar_url||p.avatarUrl);return url?'<img class="avatar '+extra+'" src="'+esc(url)+'" alt="'+esc(p.display_name||p.displayName||p.username||'')+'">':'<span class="avatar-fallback '+extra+'">'+esc((p.display_name||p.displayName||p.username||'L').slice(0,1))+'</span>';}
function name(p){return esc(p.display_name||p.displayName||p.username||'ユーザー');}
function badge(p){return p.is_official||p.isOfficial?'<span class="badge" aria-label="認証済み">'+(L.verifiedBadge==='assets/verified.png'?'<img src="assets/verified.png" alt="認証済み">':icon('check'))+'</span>':'';}
function emoji(value,stamp=false){const e=emojis.find(e=>e.name===value||e.id===value);if(!e||typeof e.public_id!=='string')return esc(/^[\w-]+$/.test(value)?':'+value+':':value);const url='https://res.cloudinary.com/dveiikhhw/image/upload/'+(e.public_id.startsWith('custom_emojis/')?e.public_id:'custom_emojis/'+e.public_id)+'.'+(e.format||'png');return media(url)?'<img class="'+(stamp?'stamp':'emoji')+'" src="'+esc(media(url))+'" alt="'+esc(e.name)+'">':esc(':'+e.name+':');}
function text(value){return esc(value).replace(/\[\[(stamp|emoji):([^\]]+)\]\]|:([a-zA-Z0-9_-]+):/g,(_,kind,n,plain)=>{let value=n||plain;try{value=decodeURIComponent(value)}catch{}return emoji(value,kind==='stamp');}).replace(/https?:\/\/[^\s<>]+/g,url=>'<a href="'+url+'" target="_blank" rel="noopener noreferrer">'+url+'</a>');}
function author(row,compact=false){const p=person(row);return '<div class="who">'+(compact?avatar(p):'')+'<span class="name">'+name(p)+'</span>'+badge(p)+'<span class="handle muted">@'+esc(p.username||p.handle||'')+'</span><span class="muted">·</span><time class="time muted">'+esc(date(row.created_at||row.createdAt).split(' ')[0])+'</time>'+(compact?'':'<button class="icon-button" data-menu="'+esc(row.id||'')+'" aria-label="もっと見る">'+icon('more')+'</button>')+'</div>';}
function images(row){return list(row.image_urls||row.imageUrls||row.images||row.media?.images).map(i=>typeof i==='string'?i:i.url||i.fullsize||i.fullsizeUrl).filter(u=>media(u));}
function pictures(row){const urls=images(row);let html=urls.length?'<div class="photos '+(urls.length===1?'single':'')+'">'+urls.map(url=>'<img data-image="'+esc(media(url))+'" src="'+esc(media(url))+'" alt="保存画像" loading="lazy">').join('')+'</div>':'';const video=media(row.video_url||row.videoUrl||row.media?.videoUrl);if(video)html+='<video class="post-video" controls preload="metadata" src="'+esc(video)+'"></video>';return html;}
function relatedRows(kind,row){const reply=comments.some(c=>c.id===row.id);const field=reply?'comment_id':'post_id';if(reply)kind=({likes:'comment_likes',reposts:'reply_reposts'}[kind]||kind);return unique([...table(kind),...table('received_'+kind)]).filter(v=>v[field]===row.id);}
function reactionRows(row){const key=comments.some(c=>c.id===row.id)?'comment_reactions':'post_reactions';return unique([...relatedRows(key,row),...relatedRows('reactions',row)]);}
function reactions(row){const groups=new Map();for(const r of reactionRows(row)){const value=r.emoji||r.reaction||r.emoji_id||'';groups.set(value,(groups.get(value)||0)+Number(r.count||1));}return groups.size?'<div class="reaction-list">'+[...groups].map(([value,count])=>'<span class="reaction-pill">'+emoji(value)+' '+count+'</span>').join('')+'</div>':'';}
function counts(row,kind,fallback){return Number(row[fallback]??relatedRows(kind,row).length)||0;}
function action(name,label,value,attrs='',state=''){return '<'+(attrs?'button':'span')+' class="action '+state+'" '+(attrs||'title="保存時点の状態"')+' aria-label="'+esc(label)+'">'+icon(name)+(value?'<span>'+esc(value)+'</span>':'')+'</'+(attrs?'button':'span')+'>';}
function actions(row){const replyCount=Number(row.commentsCount??row.comments_count??comments.filter(c=>comments.includes(row)?c.parent_comment_id===row.id:c.post_id===row.id&&!c.parent_comment_id).length);const liked=row.likedByMe||relatedRows('likes',row).some(r=>r.user_id===D.userId),reposted=row.repostedByMe||relatedRows('reposts',row).some(r=>r.user_id===D.userId),saved=table('bookmarks').some(r=>r.post_id===row.id||r.external_post_id===row.id);return '<div class="actions">'+action('heart','いいね',counts(row,'likes','likesCount'),'',liked?'liked':'')+action('repost','リポスト',counts(row,'reposts','repostsCount'),'',reposted?'reposted':'')+action('reply','返信 '+replyCount,replyCount,'data-post="'+esc(row.id)+'"')+action('plus','保存されたリアクション',0,'data-reactions="'+esc(row.id)+'"')+'<span class="push"></span>'+action('bookmark','ブックマーク',0,'',saved?'saved':'')+action('share','ポストを共有',0,'data-share="'+esc(row.id)+'"')+'</div>';}
function spaceCard(s){const p=profiles.get(s.host_id)||own;return '<div class="space"><div class="host">'+avatar(p)+'<strong>'+name(p)+'</strong><span>ホスト</span></div><h2>'+esc(s.title||'スペース')+'</h2><p>'+esc(date(s.created_at))+'</p><div class="space-ended">'+icon('mic')+esc(s.is_active?'保存時点で開催中':'終了しました')+'</div>'+(media(s.recording_url)?'<audio controls preload="metadata" src="'+esc(media(s.recording_url))+'"></audio>':'')+'</div>';}
function body(row,depth=0){let html='<div class="text">'+text(source(row))+'</div>'+pictures(row);const quote=posts.find(p=>p.id===row.parent_id)||comments.find(p=>p.id===(row.quoted_reply_id||row.parent_reply_id))||row.quoted_external_post;if(quote&&depth===0)html+='<div class="quote" data-post="'+esc(quote.id||'')+'">'+author(quote,true)+body(quote,1)+'</div>';
const saved=Object.entries(L.linkPreviews||{}).find(([url])=>source(row).includes(url));const preview=row.link_preview||row.linkPreview||(saved?(saved[1].preview||saved[1]):null);if(preview&&preview.title)html+='<div class="preview">'+(media(preview.image)?'<img src="'+esc(media(preview.image))+'" alt="">':'')+'<div><span class="muted">'+esc(preview.domain||'')+'</span><span class="preview-title">'+esc(preview.title)+'</span>'+(preview.description?'<div class="muted">'+esc(preview.description)+'</div>':'')+'</div></div>';const space=spaces.find(s=>source(row).includes(s.id)||s.announcement_post_id===row.id);if(space)html+=spaceCard(space);return html;}
function card(row,thread=false){const p=person(row);let target='';if(comments.some(c=>c.id===row.id)){const parent=posts.find(p=>p.id===row.post_id)||comments.find(c=>c.id===row.parent_comment_id);if(parent)target='<div class="reply-target">返信先：@'+esc(person(parent).username||person(parent).handle||'')+'さん</div>';}
return '<article'+(thread?' class="reply-thread"':'')+'>'+(isPinned(row.id)&&!detail?'<div class="pin">'+icon('pin')+'<span>固定されたポスト</span></div>':'')+'<div class="post-layout">'+avatar(p)+'<div class="post-content">'+author(row)+target+body(row)+reactions(row)+actions(row)+'</div></div></article>';}
const tabs=[['search','検索'],['profile','プロフィール'],['posts','ポスト'],['replies','返信'],['media','メディア'],['reposts','リポスト'],['likes','いいね'],['reactions','リアクション'],['bookmarks','ブックマーク'],['notifications','通知'],['follows','フォロー'],['chats','LimeAI'],['spaces','スペース'],['history','履歴・設定']];const labels=Object.fromEntries(tabs);let current='profile',detail=null,limit=30;
const feed=document.getElementById('feed'),search=document.getElementById('search'),more=document.getElementById('more'),nav=document.getElementById('nav'),sidebar=document.getElementById('sidebar');
const navItems=[['posts','ホーム','home'],['profile','プロフィール','user'],['search','検索','search'],['notifications','通知','bell'],['bookmarks','ブックマーク','bookmark'],['chats','LimeAI','chat'],['spaces','スペース','mic'],['history','履歴・設定','settings']];nav.innerHTML=navItems.map(([id,label,image])=>'<button data-tab="'+id+'" aria-label="'+label+'">'+icon(image)+'<span>'+label+'</span></button>').join('')+'<button id="more-nav" aria-label="もっと見る">'+icon('more')+'<span>もっと見る</span></button>';
document.getElementById('bottom').innerHTML=[['posts','ホーム','home'],['search','検索','search'],['profile','プロフ','user'],['chats','チャット','chat'],['history','設定','settings']].map(([id,label,image])=>'<button data-tab="'+id+'" aria-label="'+label+'">'+icon(image)+'</button>').join('');
document.getElementById('account').innerHTML=avatar(own)+'<div><div class="name">'+name(own)+badge(own)+'</div><div class="muted handle">@'+esc(own.username||'')+'</div><span class="offline-label muted">オフライン</span></div>';
document.getElementById('menu').innerHTML=icon('user');document.getElementById('back').innerHTML=icon('back');document.getElementById('search-icon').innerHTML=icon('search');document.getElementById('search-toggle').innerHTML=icon('search');document.querySelectorAll('[data-close]').forEach(b=>b.innerHTML=icon('close'));
const hasPro=table('user_entitlements').some(r=>r.feature==='limepro');document.getElementById('logo-suffix').textContent=hasPro?'Pro':'Note';
function setTheme(value){document.documentElement.classList.toggle('dark',value==='dark');document.getElementById('theme').innerHTML=icon(value==='dark'?'sun':'moon');}
if(typeof L.fontCss==='string'&&L.fontCss.length<500000&&!/https?:|<|@import/i.test(L.fontCss)){const fontStyle=document.createElement('style');fontStyle.textContent=L.fontCss;document.head.append(fontStyle);}
const preferred=L.theme==='dark'||L.theme==='light'?L.theme:(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');setTheme(preferred);document.getElementById('theme').onclick=()=>setTheme(document.documentElement.classList.contains('dark')?'light':'dark');
function closeDrawer(){document.body.style.overflow='';sidebar.classList.remove('open');document.getElementById('scrim').classList.remove('open');}document.getElementById('menu').onclick=()=>{document.body.style.overflow='hidden';sidebar.classList.add('open');document.getElementById('scrim').classList.add('open');};document.getElementById('scrim').onclick=closeDrawer;document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawer();});
function showDialog(title,html){document.getElementById('details-title').textContent=title;document.getElementById('details-body').innerHTML=html;document.getElementById('details').showModal();}
function showSearch(open){document.getElementById('header-search').hidden=!open;document.documentElement.style.setProperty('--archive-search-height',open?'56px':'0px');if(open)search.focus();}document.getElementById('search-toggle').onclick=()=>showSearch(document.getElementById('header-search').hidden);
function navigate(id){if(!labels[id])return;current=id;detail=null;limit=30;search.value='';closeDrawer();showSearch(id==='search');render();window.scrollTo({top:0,behavior:'auto'});}
document.getElementById('more-nav').onclick=()=>showDialog('もっと見る',tabs.filter(([id])=>['media','bookmarks','spaces','reposts','likes','reactions','follows'].includes(id)).map(([id,label])=>'<button class="history-row" style="width:100%" data-tab="'+id+'">'+esc(label)+'</button>').join(''));
document.onclick=async e=>{const close=e.target.closest('[data-close]');if(close){document.getElementById(close.dataset.close).close();return;}const tab=e.target.closest('[data-tab]');if(tab){document.getElementById('details').close();navigate(tab.dataset.tab);return;}const image=e.target.closest('[data-image]');if(image){document.getElementById('large').src=image.dataset.image;document.getElementById('save-image').href=image.dataset.image;document.getElementById('image').showModal();return;}const post=e.target.closest('[data-post]');if(post&&post.dataset.post){detail=post.dataset.post;limit=30;render();window.scrollTo({top:0,behavior:'auto'});return;}const menu=e.target.closest('[data-menu]');if(menu){showDialog('ポスト', '<button class="history-row" data-post="'+esc(menu.dataset.menu)+'">ポストと返信を表示</button><button class="history-row" data-share="'+esc(menu.dataset.menu)+'">本文をコピー</button>');return;}const react=e.target.closest('[data-reactions]');if(react){const row=posts.find(p=>p.id===react.dataset.reactions)||comments.find(p=>p.id===react.dataset.reactions);showDialog('保存されたリアクション',row&&reactionRows(row).length?reactions(row):'<p class="muted">リアクションはありません。</p>');return;}const share=e.target.closest('[data-share]');if(share){const row=posts.find(p=>p.id===share.dataset.share)||comments.find(p=>p.id===share.dataset.share);if(!row)return;try{await navigator.clipboard.writeText(source(row));showDialog('共有','<p>本文をコピーしました。</p>');}catch{showDialog('本文をコピー','<textarea readonly style="width:100%;min-height:140px">'+esc(source(row))+'</textarea>');}}};
for(const id of ['details','image']){const dialog=document.getElementById(id);dialog.addEventListener('click',e=>{if(e.target===dialog||(id==='image'&&e.target===document.getElementById('large')))dialog.close();});}
search.oninput=()=>{limit=30;const right=document.getElementById('desktop-search');if(right)right.value=search.value;render();};more.onclick=()=>{limit+=30;render();};document.getElementById('back').onclick=()=>{detail=null;render();};
function rowsFor(){if(detail){const root=posts.find(p=>p.id===detail)||comments.find(c=>c.id===detail);if(!root)return [];const result=[root],seen=new Set([root.id]);function append(parent){for(const c of comments.filter(c=>parent===root?(posts.includes(root)?c.post_id===root.id&&!c.parent_comment_id:c.parent_comment_id===root.id):c.parent_comment_id===parent.id).sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at))){if(seen.has(c.id))continue;seen.add(c.id);result.push(c);append(c);}}append(root);return result;}
if(current==='search')return unique([...posts,...comments,...table('bookmarks').map(r=>r.external_snapshot||r.external_post||r.post_data||r.snapshot||r.post_snapshot).filter(Boolean),...list(L['lime_recommendation_likes:'+D.userId])]);if(current==='posts'||current==='profile')return posts.filter(p=>p.user_id===D.userId||p.author_id===D.userId).sort((a,b)=>Number(isPinned(b.id))-Number(isPinned(a.id))||Date.parse(b.created_at)-Date.parse(a.created_at));if(current==='replies')return comments.filter(c=>c.user_id===D.userId).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));if(current==='media')return unique([...posts,...comments]).filter(p=>(p.user_id===D.userId||p.author_id===D.userId)&&(images(p).length||p.video_url||p.videoUrl));
if(['reposts','likes','reactions','bookmarks'].includes(current)){const name={reposts:'reposts',likes:'likes',reactions:'post_reactions',bookmarks:'bookmarks'}[current],ids=new Set([...table(name),...(current==='reactions'?table('reactions'):[])].map(r=>r.post_id));const ext=table(current==='reposts'?'external_reposts':name).flatMap(r=>[r.external_snapshot||r.external_post||r.post_data||r.snapshot||r.post_snapshot].filter(v=>v&&typeof v==='object'));const replyIds=new Set(table({likes:'comment_likes',reposts:'reply_reposts',reactions:'comment_reactions',bookmarks:'bookmarks'}[current]).map(r=>r.comment_id));return unique([...posts.filter(p=>ids.has(p.id)),...ext,...comments.filter(c=>replyIds.has(c.id)),...list(current==='likes'?L['lime_recommendation_likes:'+D.userId]:[]),...list(current==='bookmarks'?L.offlineBookmarks?.posts:[])]);}
if(current==='follows')return table('follows').map(r=>({profile:profiles.get(r.follower_id===D.userId?r.followee_id:r.follower_id),direction:r.follower_id===D.userId?'フォロー中':'フォロワー'}));if(current==='chats')return table('chat_sessions');if(current==='spaces')return spaces;if(current==='history')return list(L['search:recent']).map(value=>({label:'検索履歴',value:String(value)}));return table(current);}
function profileHeader(){const cover=media(own.cover_url||own.coverUrl);return (cover?'<img class="cover" data-image="'+esc(cover)+'" src="'+esc(cover)+'" alt="ヘッダー画像">':'<div class="cover"></div>')+'<div class="profile-body">'+avatar(own,'profile-avatar')+'<h2>'+name(own)+badge(own)+'</h2><span class="muted">@'+esc(own.username||'')+'</span><p>'+text(own.bio||'')+'</p><div class="profile-counts"><span><b>'+table('follows').filter(f=>f.follower_id===D.userId).length+'</b> <span class="muted">フォロー中</span></span><span><b>'+table('follows').filter(f=>f.followee_id===D.userId).length+'</b> <span class="muted">フォロワー</span></span></div></div>';}
function render(){document.getElementById('title').textContent=detail?'ポスト':current==='profile'?(own.display_name||own.displayName||'プロフィール'):labels[current];document.getElementById('back').hidden=!detail;document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===current));const profile=document.getElementById('profile');profile.hidden=!!detail||!['profile','replies','media','likes'].includes(current);if(!profile.hidden)profile.innerHTML=profileHeader();const tabRows=['profile','replies','media','likes'];document.getElementById('tabs').innerHTML=!detail&&tabRows.includes(current)?tabRows.map(id=>'<button class="'+(id===current?'active':'')+'" data-tab="'+id+'">'+(id==='profile'?'ポスト':labels[id])+'</button>').join(''):'';
let rows=rowsFor(),query=search.value.trim().toLocaleLowerCase();if(query)rows=rows.filter(r=>[source(r),r.title,r.label,r.value,person(r).display_name,person(r).displayName,person(r).username,r.profile?.username].filter(Boolean).join(' ').toLocaleLowerCase().includes(query));document.getElementById('info').textContent=date(D.createdAt)+' の保存データ · '+rows.length+'件'+(list(D.missingAssets).length?' · 未取得の添付 '+D.missingAssets.length+'件':'');
feed.innerHTML=rows.slice(0,limit).map((row,index)=>{if(detail||['search','profile','posts','replies','media','reposts','likes','reactions','bookmarks'].includes(current))return card(row,!!detail&&index<rows.length-1);if(current==='spaces')return '<article>'+spaceCard(row)+'</article>';if(current==='follows')return '<article class="list-row">'+avatar(row.profile||{})+'<div><strong>'+name(row.profile||{})+badge(row.profile||{})+'</strong><div class="muted">@'+esc(row.profile?.username||'')+' · '+esc(row.direction)+'</div></div></article>';if(current==='chats')return '<article><h2>'+esc(row.title||'チャット')+'</h2>'+list(row.messages).map(m=>'<div class="chat-bubble '+(m.role==='user'?'user':'')+'"><div class="muted">'+esc(m.role==='user'?'あなた':'LimeAI')+'</div><div class="text">'+text(m.content)+'</div>'+pictures(m)+'</div>').join('')+'</article>';if(current==='notifications'){const types={like:'いいねされました',repost:'リポストされました',reply:'返信されました',comment:'返信されました',follow:'フォローされました',mention:'メンションされました',reaction:'リアクションされました'};return '<article><div class="list-row">'+icon(row.type==='like'?'heart':row.type==='follow'?'user':'bell')+'<div>'+name(profiles.get(row.actor_id)||{})+'<div>'+esc(types[row.type]||row.message||'通知')+'</div><time class="muted">'+esc(date(row.created_at))+'</time></div></div>'+(posts.some(p=>p.id===row.post_id)?'<button class="history-row" data-post="'+esc(row.post_id)+'">ポストを表示</button>':'')+'</article>';}
return '<article class="history-row"><span class="muted">'+esc(row.label)+'</span><span>'+esc(row.value)+'</span></article>';}).join('')+(rows.length?'':'<div class="notice">保存データはありません。</div>');if(current==='history')feed.innerHTML='<article><h2>表示設定</h2><div class="history-row"><span>配色</span><button class="action" id="history-theme">'+icon('sun')+'切り替える</button></div><div class="history-row"><span>検索履歴</span><span class="muted">'+rows.length+'件</span></div></article>'+feed.innerHTML;const themeButton=document.getElementById('history-theme');if(themeButton)themeButton.onclick=()=>document.getElementById('theme').click();more.hidden=rows.length<=limit;}
const recommendations=unique(table('follows').filter(f=>f.follower_id===D.userId).map(f=>profiles.get(f.followee_id))).slice(0,5);document.getElementById('discover').innerHTML='<div class="search-wrap muted">'+icon('search')+'<input id="desktop-search" aria-label="サイドバーで検索" placeholder="検索"></div><section class="discover-card"><h2>フォロー中</h2>'+recommendations.map(p=>'<div class="list-row" style="padding:12px 16px">'+avatar(p)+'<div><span class="name">'+name(p)+'</span><span class="muted handle">@'+esc(p.username)+'</span></div></div>').join('')+(!recommendations.length?'<p class="muted" style="padding:0 16px 16px">保存データはありません。</p>':'')+'</section><section class="discover-card"><h2>保存したデータ</h2>'+[['posts','ポスト'],['bookmarks','ブックマーク'],['spaces','スペース']].map(([id,label])=>'<button data-tab="'+id+'"><strong>'+label+'</strong></button>').join('')+'</section><p class="muted" style="font-size:12px;margin-top:16px">オフラインアーカイブ · '+esc(date(D.createdAt))+'</p>';
document.getElementById('desktop-search').oninput=e=>{search.value=e.target.value;limit=30;render();};
render();
</script></body></html>`;
}
