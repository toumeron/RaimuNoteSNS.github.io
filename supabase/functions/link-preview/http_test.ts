import {decodeHttp} from './http.ts';
import {loadPreview} from './load.ts';
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
  for(const url of ['https://www.pixiv.net/','https://mozzs.booth.pm/','https://mozzs.booth.pm/?utm_source=booth&utm_medium=email_0006']){
    const preview=await loadPreview(url);assert(preview?.image&&preview.title,`${url}: missing preview`);
  }
}});
