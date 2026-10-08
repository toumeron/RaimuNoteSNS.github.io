import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export async function secretMatches(actual: string | null, expected: string | undefined): Promise<boolean> {
  if (!actual || !expected) return false;
  const encode = new TextEncoder();
  const [a, b] = await Promise.all([actual, expected].map(value => crypto.subtle.digest('SHA-256', encode.encode(value))));
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}

export async function quota(userId: string, scope: 'chat' | 'voice' | 'token' | 'preview' | 'upload', headers: HeadersInit): Promise<Response | null> {
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {auth: {persistSession: false, autoRefreshToken: false}});
    const {data, error} = await db.rpc('consume_security_quota', {p_actor: userId, p_scope: scope});
    if (error) throw error;
    if (data !== true) return Response.json({error: 'リクエストが多すぎます。時間をおいて再試行してください'}, {status: 429, headers: {...Object.fromEntries(new Headers(headers)), 'Retry-After': '300', 'Cache-Control': 'no-store'}});
    return null;
  } catch {
    return Response.json({error: 'アクセス制限を確認できません'}, {status: 503, headers});
  }
}

export async function authenticate(request: Request, headers: HeadersInit): Promise<{userId: string} | Response> {
  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+$/i.test(authorization)) return Response.json({error: 'ログインしてください'}, {status: 401, headers});
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {auth: {persistSession: false, autoRefreshToken: false}});
    const {data, error} = await db.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));
    if (error || !data.user) return Response.json({error: 'ログインしてください'}, {status: 401, headers});
    return {userId: data.user.id};
  } catch { return Response.json({error: '認証を確認できません'}, {status: 503, headers}); }
}

/** Enforce the limit while reading, rather than trusting Content-Length. */
async function boundedBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBytes) throw new Error('Request body too large');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const buffer = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  return buffer;
}

export async function boundedBody(request: Request, maxBytes: number): Promise<string> {
  return new TextDecoder().decode(await boundedBytes(request,maxBytes));
}
export async function boundedRequest(request: Request, maxBytes: number): Promise<Request> {
  const bytes = await boundedBytes(request,maxBytes);
  return new Request(request.url,{method:request.method,headers:request.headers,body:new Blob([bytes as Uint8Array<ArrayBuffer>])});
}
