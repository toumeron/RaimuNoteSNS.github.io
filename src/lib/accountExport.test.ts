import {Blob as NodeBlob} from 'node:buffer';
import {describe,it,expect,vi} from 'vitest';
vi.mock('./supabase',()=>({supabase:{auth:{getSession:async()=>({data:{session:{user:{id:'owner'},access_token:'session'}}})}}}));
import {accountZip,archiveAssetUrls,exportLocalPreferences,offlineArchiveHtml,redactExport,createAccountExport} from './accountExport';

describe('private offline account export',()=>{
 vi.stubGlobal('Blob',NodeBlob);
 it('omits other accounts and nested serialized credentials',()=>{
  localStorage.clear();
  localStorage.setItem('limeai:owner:settings',JSON.stringify({language:'ja',apiKey:'secret'}));
  localStorage.setItem('limeai:other:settings','private');
  localStorage.setItem('sb-project-auth-token','session');
  localStorage.setItem('lime_saved_accounts:project:v1','sessions');
  localStorage.setItem('lime_account_integrations:project:owner',JSON.stringify({lime_bluesky_session:JSON.stringify({handle:'alice',accessJwt:'secret',refreshJwt:'secret'})}));
  const output=exportLocalPreferences('owner');
  expect(output['limeai:owner:settings']).toEqual({language:'ja'});
  expect(Object.keys(output)).not.toContain('limeai:other:settings');
  expect(Object.keys(output)).not.toContain('sb-project-auth-token');
  expect(JSON.stringify(output)).not.toContain('secret');
 });
 it('collects directly into a local ZIP without upload requests when device caching is unavailable',async()=>{
  const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({userId:'owner',createdAt:'2026-10-08',expiresAt:'2026-10-15',snapshot:{version:1,userId:'owner',createdAt:'2026-10-08',expiresAt:'2026-10-15',account:{},tables:{},related:{},uploads:[],unavailable:[]}})});
  vi.stubGlobal('fetch',fetcher);
  const job=await createAccountExport('owner','confirmation',()=>{},new AbortController().signal);
  expect(job.cached).toBe(false);expect(job.zip.size).toBeGreaterThan(1000);expect(job.cacheWarning).toBeTruthy();expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({action:'collect',password:'confirmation'});
  expect(job).not.toHaveProperty('downloadUrl');
  vi.unstubAllGlobals();vi.stubGlobal('Blob',NodeBlob);
 });
 it('does not download anything when password confirmation fails',async()=>{
  const fetcher=vi.fn().mockResolvedValue({ok:false,json:async()=>({error:'パスワードが正しくありません'})});vi.stubGlobal('fetch',fetcher);
  await expect(createAccountExport('owner','wrong',()=>{},new AbortController().signal)).rejects.toThrow('パスワードが正しくありません');
  expect(fetcher).toHaveBeenCalledTimes(1);vi.unstubAllGlobals();vi.stubGlobal('Blob',NodeBlob);
 });
 it('redacts authentication while retaining complete content and user metadata',()=>{
  expect(redactExport({content:'password in my post',user_metadata:{nickname:'cat'},nested:{refresh_token:'secret',password:'secret',authorization:'secret',messages:['hi']}})).toEqual({content:'password in my post',user_metadata:{nickname:'cat'},nested:{messages:['hi']}});
 });
 it('collects attachments and images but never fetches arbitrary post URLs',()=>{
  expect(archiveAssetUrls({content:'https://site.test',link_preview:{url:'https://site.test',image:'https://cdn.test/preview.jpg'},image_urls:['https://cdn.test/1.jpg'],attachments:[{url:'https://cdn.test/file.mp4'}],avatarUrl:'https://cdn.test/a.jpg'})).toEqual(['https://cdn.test/preview.jpg','https://cdn.test/1.jpg','https://cdn.test/file.mp4','https://cdn.test/a.jpg']);
 });
 it('creates a valid stored ZIP with exact bytes, UTF8 flags, offsets, CRC and central directory',async()=>{
  const zip=await accountZip([{name:'index.html',blob:new Blob(['hello'])},{name:'assets/picture.bin',blob:new Blob([new Uint8Array([0,255,10,100])])}]);
  const bytes=new Uint8Array(await zip.arrayBuffer()),view=new DataView(bytes.buffer);
  expect(view.getUint32(0,true)).toBe(0x04034b50);expect(view.getUint16(6,true)).toBe(0x800);
  expect(view.getUint32(14,true)).toBe(0x3610a686);expect(new TextDecoder().decode(bytes.slice(40,45))).toBe('hello');
  const end=bytes.length-22;expect(view.getUint32(end,true)).toBe(0x06054b50);expect(view.getUint16(end+10,true)).toBe(2);
  const central=view.getUint32(end+16,true);expect(view.getUint32(central,true)).toBe(0x02014b50);expect(view.getUint32(central+42,true)).toBe(0);
 });
 it('rejects unsafe paths and obeys cancellation',async()=>{
  await expect(accountZip([{name:'../private',blob:new Blob(['a'])}])).rejects.toThrow('Invalid archive path');
  const controller=new AbortController();controller.abort();await expect(accountZip([{name:'data.json',blob:new Blob(['a'])}],controller.signal)).rejects.toThrow();
 });
 it('viewer uses local assets only and compiles without remote or application credentials',()=>{
  const html=offlineArchiveHtml();expect(html).toContain("connect-src 'none'");expect(html).not.toContain('fetch(');expect(html).not.toContain('supabase');
  const script=html.split('<script>')[1].split('</script>')[0];expect(()=>new Function(script)).not.toThrow();
  expect(html).toContain('data.js');expect(html).not.toContain('<pre>');expect(html).toContain('s.host_id===D.userId');expect(html).toContain('lucide-message-circle');
 });
});
