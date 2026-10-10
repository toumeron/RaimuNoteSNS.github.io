import {useCallback,useEffect,useState} from 'react';
const DATABASE='lime-chat-backgrounds',STORE='backgrounds';
const keyFor=(userId:string,chatId:string)=>JSON.stringify([userId,chatId]);
type StoredBackground={bytes:ArrayBuffer;type:string};
async function store<T>(mode:IDBTransactionMode,operation:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(DATABASE,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode),r=operation(tx.objectStore(STORE));let result:T;r.onsuccess=()=>{result=r.result;};tx.oncomplete=()=>{db.close();resolve(result)};tx.onabort=()=>{db.close();reject(tx.error??r.error??new Error('背景を保存できませんでした'))};tx.onerror=()=>{db.close();reject(tx.error??r.error)}});
}
export function useChatBackground(userId?:string,chatId?:string){
 const key=userId&&chatId?keyFor(userId,chatId):'';const [revision,setRevision]=useState(0);const [state,setState]=useState({key:'',url:''});const [error,setError]=useState('');
 useEffect(()=>{let cancelled=false,url='';setError('');if(!key){setState({key:'',url:''});return;}
 void store<StoredBackground|undefined>('readonly',s=>s.get(key)).then(value=>{if(cancelled)return;if(value?.bytes instanceof ArrayBuffer)url=URL.createObjectURL(new Blob([value.bytes],{type:value.type}));setState({key,url});}).catch(()=>{if(!cancelled)setError('保存した背景を読み込めませんでした。');});
 return()=>{cancelled=true;if(url)URL.revokeObjectURL(url)};
 },[key,revision]);
 const save=useCallback(async(blob:Blob|null)=>{if(!key)throw new Error('会話を選択してください');const value=blob?{bytes:await blob.arrayBuffer(),type:blob.type}:null;await store('readwrite',s=>value?s.put(value,key):s.delete(key));setRevision(value=>value+1);},[key]);
 return {url:state.key===key?state.url:'',save,error};
}
export async function prepareChatBackground(file:File):Promise<Blob>{
 if(!['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(file.type)||file.size>10485760)throw new Error('画像はPNG・JPEG・WebP・GIF・AVIF形式、10MB以内にしてください');
 const url=URL.createObjectURL(file);
 try{const img=new Image();img.src=url;await img.decode();const scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));const ctx=canvas.getContext('2d');if(!ctx)throw new Error('背景画像を読み込めませんでした');ctx.drawImage(img,0,0,canvas.width,canvas.height);return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('背景画像を読み込めませんでした')),'image/webp',.85));}
 finally{URL.revokeObjectURL(url)}
}
