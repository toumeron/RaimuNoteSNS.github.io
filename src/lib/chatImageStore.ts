type ImageRecord={account:string;bytes:ArrayBuffer;type:string;savedAt:number};
const key=(account:string,url:string)=>JSON.stringify([account,url]);
async function database(){return await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('lime-chat-images',1);r.onupgradeneeded=()=>r.result.createObjectStore('images').createIndex('age',['account','savedAt']);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});}
export async function readChatImage(account:string,url:string):Promise<Blob|undefined>{
 const db=await database();return await new Promise((resolve,reject)=>{const tx=db.transaction('images','readonly'),r=tx.objectStore('images').get(key(account,url));let record:ImageRecord|undefined;r.onsuccess=()=>{record=r.result};tx.oncomplete=()=>{db.close();resolve(record?new Blob([record.bytes],{type:record.type}):undefined)};tx.onabort=()=>{db.close();reject(tx.error)}});
}
export async function writeChatImage(account:string,url:string,blob:Blob){
 const record:ImageRecord={account,bytes:await blob.arrayBuffer(),type:blob.type,savedAt:Date.now()};const db=await database();return await new Promise<void>((resolve,reject)=>{const tx=db.transaction('images','readwrite'),s=tx.objectStore('images');s.put(record,key(account,url));const keys=s.index('age').getAllKeys(IDBKeyRange.bound([account,0],[account,Number.MAX_SAFE_INTEGER]));keys.onsuccess=()=>{for(const k of keys.result.slice(0,Math.max(0,keys.result.length-64)))s.delete(k)};tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>{db.close();reject(tx.error)}});
}
