import {lookup} from 'node:dns/promises';
import {publicAddress} from './metadata.ts';
const LIMIT=1_500_000;
export function decodeHttp(bytes:Uint8Array,truncated=false):{status:number;location?:string;html:string} {
  const text=new TextDecoder('latin1').decode(bytes),end=text.indexOf('\r\n\r\n');
  if(end<0)throw new Error('Invalid HTTP response');
  const head=text.slice(0,end),status=Number(head.match(/^HTTP\/1\.[01] (\d+)/)?.[1]);
  const headers=new Map(head.split('\r\n').slice(1).map(line=>{const colon=line.indexOf(':');return [line.slice(0,colon).toLowerCase(),line.slice(colon+1).trim()];}));
  if(status!==200||!/text\/html|application\/xhtml\+xml/i.test(headers.get('content-type')??''))return {status,location:headers.get('location'),html:''};
  let body=bytes.slice(end+4);
  if(/chunked/i.test(headers.get('transfer-encoding')??'')){
    const parts:Uint8Array[]=[];let cursor=0,total=0;
    while(cursor<body.length){
      let boundary=cursor;while(boundary<body.length-1&&!(body[boundary]===13&&body[boundary+1]===10))boundary++;
      const length=parseInt(new TextDecoder().decode(body.slice(cursor,boundary)).split(';')[0],16);
      if(!Number.isFinite(length)||length<0)throw new Error('Invalid HTTP chunks');
      if(boundary+2+length>body.length){if(!truncated)throw new Error('Invalid HTTP chunks');const tail=body.slice(boundary+2);parts.push(tail);total+=tail.length;break;}
      if(length===0)break;
      parts.push(body.slice(boundary+2,boundary+2+length));total+=length;cursor=boundary+2+length+2;
    }
    body=new Uint8Array(total);let offset=0;for(const part of parts){body.set(part,offset);offset+=part.length;}
  }
  return {status,html:new TextDecoder().decode(body)};
}
// Connect to the validated address, then validate TLS against the original host.
// Supabase's Node HTTP shim does not implement custom DNS lookup callbacks.
export async function page(url:URL,userAgent="Mozilla/5.0 (compatible; LimeNote/1.0)"):Promise<{status:number;location?:string;html:string}> {
  const addresses=await lookup(url.hostname,{all:true});
  if(!addresses.length||addresses.some(item=>!publicAddress(item.address)))throw new Error('Private address');
  // These domains are operated by the platforms themselves, with no user-managed DNS.
  // Use the platform HTTP stack for their HTTP/2 compatibility; redirects remain manual.
  if(/(^|\.)(pixiv\.net|booth\.pm|fanbox\.cc)$/.test(url.hostname)){
    const response=await fetch(url,{headers:{'User-Agent':userAgent,'Accept':'text/html,application/xhtml+xml','Accept-Language':'ja-JP,ja;q=0.9,en;q=0.5'},redirect:'manual',signal:AbortSignal.timeout(10000)});
    if(response.status!==200||!/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type')??'')){await response.body?.cancel();return {status:response.status,location:response.headers.get('location')??undefined,html:''};}
    const reader=response.body!.getReader(),chunks:Uint8Array[]=[];let size=0;
    try{while(true){const {value,done}=await reader.read();if(done)break;const part=value.subarray(0,LIMIT-size);chunks.push(part);size+=part.length;if(size>=LIMIT)break;}}finally{await reader.cancel();}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return {status:200,html:new TextDecoder().decode(bytes)};
  }
  let connection:Deno.Conn|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const operation=(async()=>{
    const tcp=await Deno.connect({hostname:addresses[0].address,port:Number(url.port||(url.protocol==='https:'?443:80))});
    connection=tcp;
    if(url.protocol==='https:')connection=await Deno.startTls(tcp,{hostname:url.hostname});
    const message=new TextEncoder().encode(`GET ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.host}\r\nUser-Agent: ${userAgent}\r\nAccept: text/html,application/xhtml+xml\r\nAccept-Encoding: identity\r\nAccept-Language: ja-JP,ja;q=0.9,en;q=0.5\r\nConnection: close\r\n\r\n`);
    let written=0;while(written<message.length)written+=await connection.write(message.subarray(written));
    const parts:Uint8Array[]=[];let length=0,truncated=false;
    while(true){const buffer=new Uint8Array(16384),count=await connection.read(buffer);if(count===null)break;const part=buffer.slice(0,Math.min(count,LIMIT-length));length+=part.length;parts.push(part);if(length>=LIMIT){truncated=true;break;}}
    const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
    return decodeHttp(bytes,truncated);
  })();
  try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{try{connection?.close();}catch{/* Closed */}reject(new Error('Timeout'));},10000);})]);}
  finally{clearTimeout(timer);try{connection?.close();}catch{/* Closed */}}
}
