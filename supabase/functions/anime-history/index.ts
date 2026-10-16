import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {authenticate,quota} from '../_shared/security.ts';
import {AnnictCatalog} from '../_shared/animeHistory.ts';
import {createAnimeHistoryHandler} from './handler.ts';
const headers={'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'};
Deno.serve(createAnimeHistoryHandler({
 catalog:new AnnictCatalog(Deno.env.get('ANNICT_ACCESS_TOKEN')??''),
 authenticate:(request,readOnly)=>authenticate(request,headers,readOnly),
 limit:actor=>quota(actor,'preview',headers),
 client:request=>createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:request.headers.get('authorization')!}},auth:{persistSession:false,autoRefreshToken:false}}),
}));
