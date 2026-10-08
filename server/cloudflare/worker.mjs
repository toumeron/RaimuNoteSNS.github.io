import {DurableObject} from 'cloudflare:workers';
import {createClient} from '@supabase/supabase-js';
import {startExternalNotificationListener} from '../external-notification-listener.mjs';
import {connectStream} from '../external-notification-events.mjs';
import {cloudflareSocketClass} from './socket.mjs';
export class ExternalNotificationListener extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.ctx=ctx;this.env=env;this.started=null;this.stopListener=null;}
 async fetch(request){
  const path=new URL(request.url).pathname;
  if(path==='/status')return Response.json({running:!!this.stopListener,started_at:this.started});
  if(path==='/stop'){await this.stopListener?.();this.stopListener=null;this.started=null;return Response.json({running:false});}
  if(path!=='/start')return new Response('Not found',{status:404});
  await this.ctx.blockConcurrencyWhile(async()=>{
   if(this.stopListener)return;
   const Socket=cloudflareSocketClass();
   const db=createClient(this.env.SUPABASE_URL,this.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},realtime:{transport:Socket}});
   this.stopListener=await startExternalNotificationListener({db,connect:(url,message,options)=>connectStream(url,message,{...options,socketFactory:url=>new Socket(url)})});
   this.started=new Date().toISOString();
  });
  return Response.json({running:true,started_at:this.started});
 }
}
export async function authenticated(request,expected){
 const actual=request.headers.get('x-worker-secret');if(!actual||!expected)return false;
 const bytes=new TextEncoder();const hashes=await Promise.all([actual,expected].map(value=>crypto.subtle.digest('SHA-256',bytes.encode(value))));
 const a=new Uint8Array(hashes[0]),b=new Uint8Array(hashes[1]);let difference=0;for(let i=0;i<a.length;i++)difference|=a[i]^b[i];return difference===0;
}
export default {
 async fetch(request,env){
  if(!await authenticated(request,env.WORKER_CONTROL_SECRET))return new Response('Unauthorized',{status:401});
  const path=new URL(request.url).pathname;
  if(!['/start','/stop','/status'].includes(path))return new Response('Not found',{status:404});
  if(request.method!==(path==='/status'?'GET':'POST'))return new Response('Method not allowed',{status:405});
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return new Response('Server configuration missing',{status:503});
  const id=env.LISTENER.idFromName('singleton');return env.LISTENER.get(id).fetch(request);
 }
};
