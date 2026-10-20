const cache=new Map<string,string[]>();
/** Public title completion: return related phrases only, never invented fillers. */
export async function searchTermSuggestions(query:string,signal?:AbortSignal):Promise<string[]>{
 const q=query.normalize('NFKC').trim();
 if(!q||q.length>100||/[@:$]|https?:\/\//i.test(q))return [];
 if(cache.has(q))return cache.get(q)!;
 const response=await fetch(`https://ja.wikipedia.org/w/api.php?${new URLSearchParams({action:'opensearch',search:q,limit:'8',namespace:'0',format:'json',origin:'*'})}`,{signal,credentials:'omit',referrerPolicy:'no-referrer'});
 if(!response.ok)throw new Error('検索候補を取得できませんでした');
 const data=await response.json();
 const normalize=(value:string)=>value.normalize('NFKC').toLocaleLowerCase().replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));
 const terms=Array.isArray(data?.[1])?data[1]:[];
 const result=[...new Set<string>(terms.filter((value:unknown):value is string=>typeof value==='string'&&value.length<=100&&normalize(value)!==normalize(q)&&normalize(value).startsWith(normalize(q))))].slice(0,2);
 if(cache.size>=100)cache.delete(cache.keys().next().value!);cache.set(q,result);
 return result;
}
