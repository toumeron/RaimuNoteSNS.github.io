/** Inventory by default. --apply copies legacy limited media to private storage.
 * Cloudinary originals still need deletion and CDN invalidation after review.
 * Environment values are read locally and are never printed or written to logs.
 */
import {createClient} from '@supabase/supabase-js';
import {randomUUID} from 'node:crypto';
const apply=process.argv.includes('--apply');
const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY,cloud=process.env.CLOUDINARY_CLOUD_NAME;
if(!url||!key)throw Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your local environment');
if(apply&&!cloud)throw Error('Set CLOUDINARY_CLOUD_NAME to allowlist the legacy image host');
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
async function all(table,select,configure=query=>query) {
 const rows=[];
 for(let offset=0;;offset+=500) {
  const {data,error}=await configure(db.from(table).select(select)).order('id').range(offset,offset+499);
  if(error)throw Error(`Could not read ${table}`);
  rows.push(...data);if(data.length<500)return rows;
 }
}
const posts=await all('posts','id,user_id,visibility,image_urls',q=>q.neq('visibility','public'));
const comments=[];
for(let start=0;start<posts.length;start+=100) comments.push(...await all('comments','id,user_id,image_urls',q=>q.in('post_id',posts.slice(start,start+100).map(row=>row.id))));
const work=[...posts.map(row=>({kind:'posts',row})),...comments.map(row=>({kind:'comments',row}))].filter(({row})=>(row.image_urls||[]).some(ref=>!ref.startsWith('storage://post-media/')));
console.log(`${work.length} restricted post/reply attachment sets need migration; ${apply?'apply':'inventory'} mode.`);
if(!apply)process.exit(0);
const extensions={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/avif':'avif'};
let migrated=0,failed=0;
for(const {kind,row} of work) {
 const staged=[];
 try {
  const refs=[];
  for(const original of row.image_urls||[]) {
   if(original.startsWith('storage://post-media/')) {refs.push(original);continue;}
   const source=new URL(original);
   if(source.protocol!=='https:'||source.hostname!=='res.cloudinary.com'||source.port||source.username||source.password||!source.pathname.startsWith(`/${cloud}/image/upload/`))throw Error('Manual migration required for a non-allowlisted image');
   const response=await fetch(source,{redirect:'error',signal:AbortSignal.timeout(20000)});
   const type=(response.headers.get('content-type')||'').split(';')[0];
   if(!response.ok||!extensions[type]||!response.body)throw Error('Unsupported or unavailable image');
   const reader=response.body.getReader(),chunks=[];let size=0;
   try {for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>10485760)throw Error('Image exceeds private storage limit');chunks.push(value);}} finally {await reader.cancel();}
   const file=new Blob(chunks,{type}),path=`${row.user_id}/${row.id}/${randomUUID()}.${extensions[type]}`;
   const {error}=await db.storage.from('post-media').upload(path,file,{contentType:type,cacheControl:'0',upsert:false});
   if(error)throw Error('Private upload failed');staged.push(path);refs.push(`storage://post-media/${path}`);
  }
  const {data,error}=await db.rpc('replace_legacy_private_media',{p_kind:kind,p_id:row.id,p_original:row.image_urls,p_replacement:refs});
  if(error||data!==true)throw Error('Record changed or permission validation failed');
  migrated++;
  // Report IDs only. These identify originals requiring provider-side deletion.
  console.log(`Migrated ${kind}/${row.id}; original provider objects still require deletion and invalidation.`);
 } catch(error) {
  if(staged.length)await db.storage.from('post-media').remove(staged);
  failed++;console.error(`Needs review: ${kind}/${row.id}: ${error.message}`);
 }
}
console.log(`Copied ${migrated}; needs review ${failed}. Provider deletion/invalidation is NOT performed by this script.`);
process.exitCode=failed?1:0;
