import {authenticate,boundedBody,quota} from '../_shared/security.ts';
import {findFriendPhoto} from '../_shared/friendImages.ts';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
export async function handleFriendImages(req:Request):Promise<Response>{
 if(req.method==='OPTIONS')return new Response(null,{headers});
 if(req.method!=='POST')return new Response(null,{status:405,headers});
 const actor=await authenticate(req,headers);if(actor instanceof Response)return actor;
 const limited=await quota(actor.userId,'preview',headers);if(limited)return limited;
 try{const input=JSON.parse(await boundedBody(req,1000));if(typeof input.query!=='string'||input.query.length>80)return Response.json({error:'Invalid query'},{status:400,headers});return Response.json({photo:await findFriendPhoto(input.query)},{headers});}
 catch{return Response.json({photo:null},{headers});}
}
if(import.meta.main)Deno.serve(handleFriendImages);
