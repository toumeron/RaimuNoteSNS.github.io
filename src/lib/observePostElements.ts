

// observePostElements
/** Track only changed subtrees, rather than rescanning the entire document
 * whenever a counter, icon, spinner or video control updates. */
function observePostElements(attribute:string,onAdd:(element:Element)=>void,onRemove:(element:Element)=>void){
 const selector=`[${attribute}]`,tracked=new Set<Element>();
 const collect=(node:Node,visit:(element:Element)=>void)=>{
  if(!(node instanceof Element))return;
  if(node.matches(selector))visit(node);
  node.querySelectorAll(selector).forEach(visit);
 };
 const add=(element:Element)=>{tracked.add(element);onAdd(element);};
 const remove=(element:Element)=>{if(tracked.delete(element))onRemove(element);};
 document.querySelectorAll(selector).forEach(add);
 const observer=new MutationObserver(records=>{
  for(const record of records){
   if(record.type==='attributes'){
    const element=record.target as Element;
    if(element.matches(selector))add(element);else remove(element);
   }else{
    record.removedNodes.forEach(node=>collect(node,element=>{if(!element.isConnected)remove(element);}));
    record.addedNodes.forEach(node=>collect(node,element=>{if(!tracked.has(element))add(element);}));
   }
  }
 });
 observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:[attribute]});
 return()=>{observer.disconnect();tracked.forEach(onRemove);tracked.clear();};
}

// observeDocumentHeight
/** Measure document growth, not every scroll event (which can force layout). */
function observeDocumentHeight(onHeight:(height:number)=>void){
 let frame=0;
 const measure=()=>{frame=0;onHeight(document.documentElement.scrollHeight);};
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
 const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(schedule);
 observer?.observe(document.documentElement);
 if(document.body)observer?.observe(document.body);
 window.addEventListener('resize',schedule,{passive:true});
 measure();
 return()=>{observer?.disconnect();window.removeEventListener('resize',schedule);if(frame)cancelAnimationFrame(frame);};
}

// sharedBrowserStore
/** One native subscription and one snapshot for all mounted consumers. */
function sharedBrowserStore<T>(read:()=>T,listen:(update:(value:T)=>void)=>()=>void,equal:(a:T,b:T)=>boolean=Object.is){
 let initialized=false,snapshot:T,stop:(()=>void)|undefined;
 const listeners=new Set<()=>void>();
 const getSnapshot=()=>{if(!initialized){snapshot=read();initialized=true;}return snapshot;};
 const update=(value:T)=>{if(initialized&&equal(snapshot,value))return;snapshot=value;initialized=true;listeners.forEach(notify=>notify());};
 const subscribe=(notify:()=>void)=>{
  listeners.add(notify);
  if(!stop){stop=listen(update);update(read());}
  return()=>{listeners.delete(notify);if(!listeners.size){stop?.();stop=undefined;initialized=false;}};
 };
 return {getSnapshot,subscribe};
}
const noBrowserSubscription=()=>()=>{};

export { observePostElements };
export { observeDocumentHeight };
export { sharedBrowserStore };
export { noBrowserSubscription };
