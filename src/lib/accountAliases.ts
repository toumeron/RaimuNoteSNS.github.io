const cache=new Map<string,{until:number;handles:string[]}>();
/** Wikibase label/alias search -> current P2002 claims; never guess an account handle. */
export async function searchAccountAliasHandles(query:string,signal?:AbortSignal):Promise<string[]>{
 const term=query.normalize('NFKC').trim();
 if(term.length<2||term.length>100||term.startsWith('@')||/https?:\/\/|@|\b(?:from|to|source):/i.test(term))return [];
 if(signal?.aborted)throw signal.reason;
 const key=term.toLocaleLowerCase(),saved=cache.get(key);if(saved&&saved.until>Date.now())return saved.handles;
 const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);
 signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>controller.abort(),2500);
 const read=async(params:Record<string,string>,origin='https://www.wikidata.org')=>{
  const response=await fetch(`${origin}/w/api.php?${new URLSearchParams({format:'json',origin:'*',...params})}`,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
  if(!response.ok)throw new Error('Alias search unavailable');return response.json();
 };
 try{
  const lookups=await Promise.allSettled([
   read({action:'wbsearchentities',search:term,language:/[ぁ-んァ-ヶ一-龯]/.test(term)?'ja':'en',uselang:'ja',type:'item',limit:'3'}),
   read({action:'query',titles:term,redirects:'1',prop:'pageprops',ppprop:'wikibase_item'},'https://ja.wikipedia.org'),
  ]);
  if(controller.signal.aborted)throw controller.signal.reason;
  const matches=lookups[0].status==='fulfilled'?lookups[0].value:{},pages=lookups[1].status==='fulfilled'?lookups[1].value?.query?.pages??{}:{};
  const ids=[...new Set([...Object.values(pages).map((page:any)=>page.pageprops?.wikibase_item),...(matches.search??[]).map((item:{id?:string})=>item.id)].filter((id:unknown):id is string=>typeof id==='string'&&/^Q\d+$/.test(id)))].slice(0,3);
  let handles:string[]=[];
  if(ids.length){
   const data=await read({action:'wbgetentities',ids:ids.join('|'),props:'claims'});
   for(const id of ids){
    const claims=data.entities?.[id]?.claims?.P2002??[];
    const active=claims.filter((claim:any)=>claim.rank!=='deprecated'&&!claim.qualifiers?.P582);
    const preferred=active.filter((claim:any)=>claim.rank==='preferred');
    handles.push(...(preferred.length?preferred:active).map((claim:any)=>claim.mainsnak?.datavalue?.value).filter((handle:unknown):handle is string=>typeof handle==='string'&&/^[A-Za-z0-9_]{1,15}$/.test(handle)));
   }
  }
  handles=[...new Set(handles)].slice(0,3);
  if(cache.size>=100)cache.delete(cache.keys().next().value!);
  cache.set(key,{until:Date.now()+600_000,handles});return handles;
 }catch(error){if(signal?.aborted)throw error;return [];}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
