import { quota, boundedBody } from '../_shared/security.ts';
import { CALM_FEMALE_VOICE_ID, PCM_SAMPLE_RATE } from '../_shared/aiVoice.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (error: string, status: number) => new Response(JSON.stringify({ error }), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json('Method not allowed', 405);
  const authorization = req.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return json('ログインが必要です。', 401);
  try {
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } },
    });
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return json('ログインが必要です。', 401);
    const limited = await quota(data.user.id, 'voice', cors); if (limited) return limited;
    const key = Deno.env.get('FISH_AUDIO_API_KEY');
    if (!key) return json('AI音声の設定が未完了です。サーバーにFish AudioのAPIキーを設定してください。', 503);
    if (Number(req.headers.get('content-length')) > 16000) return json('読み上げる文章が長すぎます。', 413);
    let raw: string;
    try { raw = await boundedBody(req, 16000); } catch { return json("読み上げる文章が長すぎます。", 413); }
    if (raw.length > 16000) return json('読み上げる文章が長すぎます。', 413);
    let body;
    try { body = JSON.parse(raw); } catch { return json('音声リクエストが無効です。', 400); }
    if (!body || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 600) return json('読み上げる文章は1〜600文字で指定してください。', 400);
    const rate = body.rate ?? 1;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0.5 || rate > 2) return json('音声の速度が無効です。', 400);
    if (body.referenceId !== undefined && (typeof body.referenceId !== 'string' || !/^[a-f0-9]{32}$/i.test(body.referenceId))) return json('Fish AudioのボイスIDは32文字の英数字で指定してください。', 400);
    const referenceId = body.referenceId || CALM_FEMALE_VOICE_ID;
    const format = body.format === 'pcm' ? 'pcm' : 'mp3';
    const response = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', model: 's2.1-pro-free' },
      body: JSON.stringify({ text: body.text.trim(), ...(referenceId ? { reference_id: referenceId } : {}), format, ...(format === 'pcm' ? { sample_rate: PCM_SAMPLE_RATE } : { mp3_bitrate: 128 }), chunk_length: 100, prosody: { speed: rate, volume: 0, normalize_loudness: true }, latency: 'balanced', normalize: true }),
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(60000)]),
    });
    if (!response.ok) {
      if (response.status === 429) return json('AI音声が混み合っています。少し待って再試行してください。', 429);
      if (response.status === 401 || response.status === 403) return json('Fish AudioのAPIキーまたは利用権限を確認してください。', 503);
      return json('Fish Audioで音声を生成できませんでした。ボイスIDとサービスの状態を確認してください。', 502);
    }
    if (!response.body) return json('AI音声データが空でした。', 502);
    return new Response(response.body, { headers: { ...cors, 'Content-Type': format === 'pcm' ? 'audio/pcm' : 'audio/mpeg', 'Cache-Control': 'no-store' } });
  } catch {
    return json('AI音声に接続できませんでした。もう一度お試しください。', 502);
  }
});
