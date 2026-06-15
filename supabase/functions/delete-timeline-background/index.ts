import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

async function sha1Hex(value: string) {
  const data = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function destroyCloudinaryImage(publicId: string) {
  const cloudName = Deno.env.get('CLOUDINARY_CLOUD_NAME');
  const apiKey = Deno.env.get('CLOUDINARY_API_KEY');
  const apiSecret = Deno.env.get('CLOUDINARY_API_SECRET');

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinaryのサーバー側環境変数が不足しています');
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await sha1Hex(`public_id=${publicId}&timestamp=${timestamp}${apiSecret}`);

  const formData = new FormData();
  formData.append('public_id', publicId);
  formData.append('api_key', apiKey);
  formData.append('timestamp', timestamp);
  formData.append('signature', signature);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, {
    method: 'POST',
    body: formData,
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error?.message || 'Cloudinary画像の削除に失敗しました');
  }

  const result = payload?.result;

  if (result !== 'ok' && result !== 'not found' && result !== 'not_found') {
    throw new Error(`Cloudinary画像の削除結果が不正です: ${result || 'unknown'}`);
  }

  return payload;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'POSTのみ対応しています' }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error('Supabase Edge Functionの環境変数が不足しています');
    }

    const authorization = req.headers.get('Authorization') ?? '';

    if (!authorization) {
      return jsonResponse({ error: '認証情報がありません' }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authorization,
        },
      },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return jsonResponse({ error: '認証に失敗しました' }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json().catch(() => ({}));
    const requestedPublicId = typeof body?.publicId === 'string' ? body.publicId : '';

    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('timeline_background_url, timeline_background_public_id')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) throw profileError;

    const storedPublicId = profile?.timeline_background_public_id ?? '';
    const publicId = storedPublicId || requestedPublicId;

    if (requestedPublicId && storedPublicId && requestedPublicId !== storedPublicId) {
      return jsonResponse({ error: '削除対象のpublic_idが現在のユーザー設定と一致しません' }, 403);
    }

    if (publicId && !publicId.startsWith(`timeline_backgrounds/${user.id}/`)) {
      return jsonResponse({ error: 'この画像は現在のユーザーのタイムライン背景ではありません' }, 403);
    }

    let cloudinaryResult: unknown = null;

    if (publicId) {
      cloudinaryResult = await destroyCloudinaryImage(publicId);
    }

    const { error: updateError } = await adminClient
      .from('profiles')
      .update({
        timeline_background_url: null,
        timeline_background_public_id: null,
      })
      .eq('id', user.id);

    if (updateError) throw updateError;

    return jsonResponse({
      ok: true,
      deletedPublicId: publicId || null,
      cloudinaryResult,
    });
  } catch (err) {
    console.error('delete-timeline-background error:', err);
    return jsonResponse(
      {
        error: err instanceof Error ? err.message : 'タイムライン背景の削除に失敗しました',
      },
      500,
    );
  }
});