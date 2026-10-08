import {decodeHttp} from './http.ts';
import {loadPreview,allowedImage,loadImage,loadMisskey} from './load.ts';
import {metadata} from './metadata.ts';
function assert(condition:unknown,message='Assertion failed'){if(!condition)throw new Error(message);}
Deno.test('HTTP response parser supports chunked UTF-8 metadata and redirects',()=>{
  const body='<meta property="og:title" content="日記"><meta property="og:image" content="/cover.jpg">';
  const bytes=new TextEncoder().encode(body);
  const header=new TextEncoder().encode(`HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nTransfer-Encoding: chunked\r\n\r\n${bytes.length.toString(16)}\r\n`);
  const tail=new TextEncoder().encode('\r\n0\r\n\r\n');const response=new Uint8Array(header.length+bytes.length+tail.length);response.set(header);response.set(bytes,header.length);response.set(tail,header.length+bytes.length);
  const parsed=decodeHttp(response);assert(metadata(parsed.html,'https://example.com')?.title==='日記');
  const redirect=decodeHttp(new TextEncoder().encode('HTTP/1.1 302 Found\r\nLocation: /next\r\n\r\n'));assert(redirect.status===302&&redirect.location==='/next');
});
Deno.test('non-HTML and incomplete HTTP responses do not produce cards',()=>{
  assert(decodeHttp(new TextEncoder().encode('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{}')).html==='');
  let rejected=false;try{decodeHttp(new TextEncoder().encode('bad response'));}catch{rejected=true;}assert(rejected);
});
Deno.test({name:'public pixiv and BOOTH URLs return real preview metadata',ignore:Deno.env.get('LINK_PREVIEW_NETWORK_TEST')!=='1',fn:async()=>{
  for(const url of ['https://www.pixiv.net/','https://mozzs.booth.pm/','https://mozzs.booth.pm/?utm_source=booth&utm_medium=email_0006','https://george-doredore.jrkyushu.co.jp/ip/']){
    const preview=await loadPreview(url);assert(preview?.title,`${url}: missing preview`);
  }
}});

async function rejects(fn:()=>unknown){let rejected=false;try{await fn();}catch{rejected=true;}assert(rejected);}
Deno.test('offline reader accepts platform media and rejects other hosts or private URLs',async()=>{
 assert(allowedImage('https://melonbooks.akamaized.net/user_data/packages/resize_image.php?image=sample.jpg','project.supabase.co').hostname==='melonbooks.akamaized.net');
 assert(allowedImage('https://media.misskeyusercontent.jp/photo.png','project.supabase.co').hostname==='media.misskeyusercontent.jp');
 assert(allowedImage('https://video.bsky.app/watch/thumbnail.jpg','project.supabase.co').hostname==='video.bsky.app');
 assert(allowedImage('https://res.cloudinary.com/lime/image/upload/a.png','project.supabase.co').hostname==='res.cloudinary.com');
 assert(allowedImage('https://project.supabase.co/storage/v1/object/public/photos/a.png','project.supabase.co').hostname==='project.supabase.co');
 for(const url of ['https://127.0.0.1/a','https://example.com/a','https://project.supabase.co/auth/v1/user','http://cdn.bsky.app/a','https://cdn.bsky.app.example.com/a'])await rejects(()=>allowedImage(url,'project.supabase.co'));
});

Deno.test('Misskey reader restricts endpoints and credentials and hides non-public note contents',async()=>{
 const original=globalThis.fetch;
 try{
  let called=false;
  globalThis.fetch=async(url,options)=>{
   called=true;assert(String(url)==='https://misskey.io/api/notes/search');
   const body=JSON.parse(String(options?.body));assert(body.limit===100&&!body.i&&!body.url);
   return Response.json([{id:'public',visibility:'public',text:'公開',user:{id:'user',username:'cat',email:'private@example.com'}},{id:'hidden',visibility:'home',text:'非公開',user:{username:'secret'}}]);
  };
  const result=await loadMisskey('notes/search',{query:'猫',limit:1000,url:'https://127.0.0.1'}) as Record<string,unknown>[];
  assert(result[0].text==='公開');assert(JSON.stringify(result).includes('非公開')===false);assert(JSON.stringify(result).includes('private@example.com')===false);
  called=false;
  await rejects(()=>loadMisskey('notes/reactions/create',{noteId:'post',i:'token'}));assert(!called);
  await rejects(()=>loadMisskey('notes/show',{noteId:'post',i:'token'}));assert(!called);
  await rejects(()=>loadMisskey('../admin/delete-user',{userId:'user'}));assert(!called);
 }finally{globalThis.fetch=original;}
});
Deno.test('offline reader preserves image bytes and rejects redirects to an unsupported host',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/png'}});
  const image=await loadImage('https://cdn.bsky.app/image/a','project.supabase.co');assert(image.type==='image/png'&&image.size===3);
  globalThis.fetch=async()=>new Response(null,{status:302,headers:{Location:'https://127.0.0.1/private'}});
  await rejects(()=>loadImage('https://cdn.bsky.app/image/a','project.supabase.co'));
  globalThis.fetch=async()=>new Response('not an image',{headers:{'Content-Type':'text/html'}});
  await rejects(()=>loadImage('https://cdn.bsky.app/image/a','project.supabase.co'));
 }finally{globalThis.fetch=original;}
});

Deno.test('bounded HTML reads preserve metadata from oversized chunked pages',()=>{
 const body='<title>商品名</title><meta name="description" content="商品説明">';const bytes=new TextEncoder().encode(body);
 const header=new TextEncoder().encode(`HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nTransfer-Encoding: chunked\r\n\r\n${(bytes.length+5000000).toString(16)}\r\n`);
 const response=new Uint8Array(header.length+bytes.length);response.set(header);response.set(bytes,header.length);
 const preview=metadata(decodeHttp(response,true).html,'https://example.com');assert(preview?.title==='商品名'&&preview.description==='商品説明'&&preview.image==='');
 let rejected=false;try{decodeHttp(response);}catch{rejected=true;}assert(rejected);
});

Deno.test('short links follow long redirect chains and HTML refresh and keep the original link',async()=>{
 const original='https://short.example/0';let calls=0;
 const preview=await loadPreview(original,async url=>{
  calls++;const step=Number(url.pathname.slice(1));
  if(step<5)return {status:302,location:'/'+(step+1),html:''};
  if(step===5)return {status:200,html:'<meta content="0; url=https://shop.example/item" http-equiv="refresh">'};
  return {status:200,html:'<title>商品ページ</title><meta name="description" content="商品の説明">'};
 });
 assert(calls===7&&preview?.url===original&&preview.domain==='shop.example'&&preview.title==='商品ページ'&&preview.image==='');
});
Deno.test('short link loops, non-HTML failures and unsafe refresh destinations do not make cards',async()=>{
 assert(await loadPreview('https://short.example/a',async()=>({status:302,location:'/a',html:''}))===null);
 assert(await loadPreview('https://short.example/a',async()=>({status:404,html:'<title>Not found</title>'}))===null);
 await rejects(()=>loadPreview('https://short.example/a',async()=>({status:200,html:'<meta http-equiv="refresh" content="0; url=javascript:alert(1)">'})));
});

Deno.test('Amazon storefront responses retry the canonical product path and extract its actual image',async()=>{
 const calls:string[]=[];
 const result=await loadPreview('https://www.amazon.co.jp/title/dp/4832297554/ref=tracking',async(url,agent)=>{
  calls.push(url.href);if(calls.length===1)return {status:200,html:'<title>Amazon.co.jp</title>'};
  assert(url.pathname==='/dp/4832297554');return {status:200,html:'<span id="productTitle">実際の商品</span><img id="landingImage" src="https://m.media-amazon.com/images/I/cover.jpg">'};
 });
 assert(calls.length===2&&result?.title==='実際の商品'&&result.image==='https://m.media-amazon.com/images/I/cover.jpg');
 assert(allowedImage(result!.image,'project.supabase.co').hostname==='m.media-amazon.com');
});

Deno.test('Amazon product information falls back to its mobile storefront and ignores empty storefront cards',async()=>{
 const calls:string[]=[];
 const preview=await loadPreview('https://www.amazon.co.jp/dp/4832297554',async url=>{
  calls.push(url.pathname);
  return {status:200,html:url.pathname==='/gp/aw/d/4832297554'?'<span id="productTitle">商品の表紙</span><img id="landingImage" data-old-hires="https://m.media-amazon.com/images/I/cover.jpg">':'<title>Amazon.co.jp</title>'};
 });
 assert(calls.length===3&&preview?.image==='https://m.media-amazon.com/images/I/cover.jpg');
 await rejects(()=>loadPreview('https://www.amazon.co.jp/dp/4832297554',async()=>({status:200,html:'<title>Amazon.co.jp</title>'})));
});

Deno.test('a missing exact Misskey user is an empty lookup while other upstream failures remain errors',async()=>{
 const original=globalThis.fetch;
 try {
  globalThis.fetch=async()=>new Response('{}',{status:404});
  assert(await loadMisskey('users/show',{username:'missing',host:null})===null);
  await rejects(()=>loadMisskey('users/search',{query:'missing'}));
 } finally {globalThis.fetch=original;}
});
