import {isInstalledPwa} from './utils';
const caches=new Set<{sweep:()=>void}>();
/** Bounded LRU for disposable API results. Drafts and offline storage stay separate. */
export class TransientCache<K,V>{
 private records=new Map<K,{value:V;until:number}>();
 constructor(private ttlMs:number,private browserLimit=64,private pwaLimit=24){caches.add(this);}
 get size(){return this.records.size;}
 clear(){this.records.clear();}
 dispose(){this.clear();caches.delete(this);}
 get(key:K):V|undefined{
  const entry=this.records.get(key);if(!entry)return;
  if(entry.until<=Date.now()){this.records.delete(key);return;}
  this.records.delete(key);this.records.set(key,entry);return entry.value;
 }
 set(key:K,value:V){
  this.sweep();this.records.delete(key);this.records.set(key,{value,until:Date.now()+this.ttlMs});
  const limit=isInstalledPwa()?this.pwaLimit:this.browserLimit;
  while(this.records.size>limit)this.records.delete(this.records.keys().next().value!);
  return this;
 }
 sweep(){const now=Date.now();for(const [key,entry]of this.records)if(entry.until<=now)this.records.delete(key);}
}
export function sweepTransientCaches(){caches.forEach(cache=>cache.sweep());}
