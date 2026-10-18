import {isLocalGemmaSession} from './localGemmaConfig';
export type LocalGemmaSession={id:string;title:string;messages:{id:string;role:'user'|'assistant';content:string}[];updatedAt:number};
const STORE='sessions';
function transaction<T>(mode:IDBTransactionMode,run:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{
 return new Promise((resolve,reject)=>{
  const opening=indexedDB.open('limenote-local-chats',1);
  opening.onupgradeneeded=()=>opening.result.createObjectStore(STORE,{keyPath:['owner','id']});
  opening.onerror=()=>reject(opening.error);
  opening.onsuccess=()=>{
   const db=opening.result,tx=db.transaction(STORE,mode),request=run(tx.objectStore(STORE));let result:T;
   request.onsuccess=()=>{result=request.result;};
   tx.oncomplete=()=>{db.close();resolve(result);};
   tx.onabort=tx.onerror=()=>{db.close();reject(tx.error??request.error??new Error('端末内に履歴を保存できませんでした'));};
  };
 });
}
export async function listLocalGemmaSessions(owner:string):Promise<LocalGemmaSession[]>{
 const rows=await transaction<any[]>('readonly',store=>store.getAll(IDBKeyRange.bound([owner,''],[owner,'\uffff'])));
 return rows.filter(row=>isLocalGemmaSession(row.id)).map(({owner:_,...session})=>session).sort((a,b)=>b.updatedAt-a.updatedAt);
}
export function saveLocalGemmaSession(owner:string,session:LocalGemmaSession){
 if(!isLocalGemmaSession(session.id))throw new Error('ローカルチャットではありません');
 return transaction('readwrite',store=>store.put({owner,...session}));
}
export const deleteLocalGemmaSession=(owner:string,id:string)=>transaction('readwrite',store=>store.delete([owner,id]));
