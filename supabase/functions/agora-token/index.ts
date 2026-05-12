// supabase/functions/agora-token/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import * as AccessToken from "https://esm.sh/agora-access-token@2.0.4"
import { corsHeaders } from "./_shared/cors.ts" // .ts を必ずつける

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { channelName, uid } = body;

    const APP_ID = Deno.env.get('AGORA_APP_ID')
    const APP_CERTIFICATE = Deno.env.get('AGORA_APP_CERTIFICATE')

    if (!APP_ID || !APP_CERTIFICATE) {
      return new Response(
        JSON.stringify({ error: 'Agora configuration missing on server' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    if (!channelName) {
      return new Response(
        JSON.stringify({ error: 'channelName is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const role = AccessToken.RtcRole.PUBLISHER
    const expirationTimeInSeconds = 3600
    const currentTimestamp = Math.floor(Date.now() / 1000)
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds

    const token = AccessToken.RtcTokenBuilder.buildTokenWithUid(
      APP_ID,
      APP_CERTIFICATE,
      channelName,
      uid || 0,
      role,
      privilegeExpiredTs
    )

    return new Response(
      JSON.stringify({ token }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})