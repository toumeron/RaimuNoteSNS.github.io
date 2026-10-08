import { quota, boundedRequest } from '../_shared/security.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authorization = req.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'ログインが必要です。' }, 401);
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return json({ error: 'ログインが必要です。' }, 401);
    const limited = await quota(data.user.id, 'voice', cors); if (limited) return limited;
  const key = Deno.env.get('GROQ_API_KEY');
  if (!key) return json({ error: '音声認識のサーバー設定が完了していません。' }, 503);
  const length = Number(req.headers.get('content-length'));
  if (length > 5 * 1024 * 1024) return json({ error: '録音が長すぎます。短く区切って話してください。' }, 413);
  try {
    let bounded: Request;
    try { bounded = await boundedRequest(req, 5 * 1024 * 1024 + 65536); }
    catch { return json({ error: "録音データが大きすぎます" }, 413); }
    const form = await bounded.formData();
    const audio = form.get('audio');
    if (!(audio instanceof File) || audio.size === 0 || audio.size > 5 * 1024 * 1024) {
      return json({ error: '録音データが無効です。' }, 400);
    }
    if (!/^audio\/(webm|mp4|ogg|wav)(;|$)/i.test(audio.type)) return json({ error: '録音形式に対応していません。' }, 400);
    const upstream = new FormData();
    upstream.append('file', audio, audio.name);
    upstream.append('model', 'whisper-large-v3-turbo');
    upstream.append('response_format', 'json');
    const lang = form.get('language');
    if (typeof lang === 'string' && /^[a-z]{2}$/.test(lang)) upstream.append('language', lang);
    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: upstream,
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) return json({ error: response.status === 429 ? '音声認識が混み合っています。少し待って再試行してください。' : '音声認識に失敗しました。もう一度お試しください。' }, response.status === 429 ? 429 : 502);
    const result = await response.json();
    return json({ text: typeof result.text === 'string' ? result.text : '' });
  } catch {
    return json({ error: '音声認識に接続できません。もう一度お試しください。' }, 502);
  }
});
