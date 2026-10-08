import { quota, boundedBody } from '../_shared/security.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as AccessToken from 'https://esm.sh/agora-access-token@2.0.4';
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return Response.json({error: 'Method not allowed'}, {status: 405, headers});
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { headers, status });
  try {
    const auth = req.headers.get('Authorization') || '';
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: { user } } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
    if (!user) return reply({ error: 'ログインしてください' }, 401);
    const limited = await quota(user.id, 'token', headers); if (limited) return limited;
    const { spaceId, uid, publishing = false } = JSON.parse(await boundedBody(req, 4096));
    if (typeof spaceId !== 'string' || !Number.isInteger(uid) || uid < 1) return reply({ error: 'Invalid session' }, 400);
    const { data: space, error: spaceError } = await db.from('spaces').select('host_id,is_active,heartbeat_at,speaker_policy').eq('id', spaceId).maybeSingle();
    const { data: member, error: memberError } = await db.from('space_members').select('id,rtc_uid,anonymous,heartbeat_at').eq('space_id', spaceId).eq('user_id', user.id).maybeSingle();
    if (spaceError || memberError) return reply({ error: '音声サービスでスペースを確認できませんでした。もう一度お試しください。' }, 503);
    const fresh = (value: string) => Date.parse(value) > Date.now() - 90000;
    if (!space?.is_active || !fresh(space.heartbeat_at) || !member || !fresh(member.heartbeat_at) || member.rtc_uid !== uid) return reply({ error: 'スペースは終了したか、参加していません' }, 403);
    const host = space.host_id === user.id;
    if (publishing && !host) {
      const { data: allowed, error } = await db.rpc('can_publish_live_space', { p_space_id: spaceId, p_user_id: user.id });
      if (error) return reply({ error: '発言権を確認できませんでした' }, 503);
      if (!allowed) return reply({ error: '発言する権限がありません' }, 403);
    }
    const publisher = host || publishing;
    const appId = Deno.env.get('AGORA_APP_ID'), certificate = Deno.env.get('AGORA_APP_CERTIFICATE');
    if (!appId || !certificate) return reply({ error: '音声サービスが設定されていません' }, 503);
    const role = publisher ? AccessToken.RtcRole.PUBLISHER : AccessToken.RtcRole.SUBSCRIBER;
    const token = AccessToken.RtcTokenBuilder.buildTokenWithUid(appId, certificate, `lime-space:${spaceId}`, uid, role, Math.floor(Date.now()/1000)+3600);
    const { error } = await db.from('space_members').update({ role: host ? 'host' : publisher ? 'speaker' : 'listener', heartbeat_at: new Date().toISOString() }).eq('id', member.id);
    if (error) throw error;
    return reply({ token, appId, role: publisher ? 'host' : 'audience' });
  } catch { return reply({ error: '音声接続を準備できませんでした' }, 500); }
});
