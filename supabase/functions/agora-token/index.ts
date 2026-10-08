import { authenticate } from '../_shared/security.ts';
import { corsHeaders } from './_shared/cors.ts';

// This obsolete endpoint accepted arbitrary channels and caller-selected UIDs.
// All active Spaces use space-token, which checks membership and publishing rights.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: corsHeaders});
  if (req.method !== 'POST') return Response.json({error: 'Method not allowed'}, {status: 405, headers: corsHeaders});
  const actor = await authenticate(req, corsHeaders);
  if (actor instanceof Response) return actor;
  return Response.json({error: 'Use the membership-checked space-token endpoint'}, {status: 410, headers: {...corsHeaders, 'Cache-Control': 'no-store'}});
});
