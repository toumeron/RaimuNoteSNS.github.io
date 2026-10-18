// Keep actual views across refreshes, independently for each local account.
const memory=new Map<string,Set<string>>();
const serialized=new Map<string,string|null>();
const key=(viewerId:string|null)=>`lime_trend_views:${viewerId??'guest'}`;
export function readTrendViews(viewerId:string|null):Set<string>{
 const scope=key(viewerId),views=new Set(memory.get(scope));
 try{
  const raw=localStorage.getItem(scope);
  if(!serialized.has(scope)||serialized.get(scope)!==raw){
   const stored:unknown=JSON.parse(raw??'[]');
   if(Array.isArray(stored))for(const id of stored)if(typeof id==='string')views.add(id);
   serialized.set(scope,raw);
  }
 }catch{/* Keep browsing if storage is unavailable. */}
 memory.set(scope,views);return new Set(views);
}
export function recordTrendView(id:string,viewerId:string|null):void{
 recordTrendDeliveries([id],viewerId);
}
/** Suppress already delivered cards even after a fast scroll or a refresh. */
export function recordTrendDeliveries(ids:Iterable<string>,viewerId:string|null):void{
 const views=readTrendViews(viewerId),before=views.size;for(const id of ids)views.add(id);
 if(views.size===before)return;
 memory.set(key(viewerId),views);
 try{const raw=JSON.stringify([...views]);localStorage.setItem(key(viewerId),raw);serialized.set(key(viewerId),raw);}catch{/* Retain session history if storage is full. */}
}
