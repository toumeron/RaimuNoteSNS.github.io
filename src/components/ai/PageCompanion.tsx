import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Settings2, X, Sparkles } from "lucide-react";
import { BUILTIN_MODELS, inferModelFormat, type ModelSource, getModel, listModels, type StoredModel } from "@/lib/avatarModels";
import { useCompanion, updateCompanion } from "@/lib/companionPreferences";
import { useTheme } from "next-themes";
import { type StageStatus } from "@/components/ai/AvatarStage";
import { Switch, Button, Label } from "@/components/ui/button";

// PageCompanion
const Stage=lazy(()=>import('./CompanionStage'));
class StageBoundary extends Component<{children:ReactNode;onError:()=>void},{failed:boolean}>{
 state={failed:false};static getDerivedStateFromError(){return{failed:true};}componentDidCatch(){this.props.onError();}render(){return this.state.failed?null:this.props.children;}
}
function PageCompanion({userId}:{userId:string}){
 const prefs=useCompanion(userId);
 return prefs.enabled?<Companion userId={userId}/>:null;
}
function Companion({userId}:{userId:string}){
 const prefs=useCompanion(userId),{resolvedTheme}=useTheme();
 const [source,setSource]=useState<ModelSource|null>(null),[status,setStatus]=useState<StageStatus>({state:'loading',progress:0});
 const [viewport,setViewport]=useState({width:window.innerWidth,height:window.innerHeight}),[position,setPosition]=useState<{x:number;y:number}|null>(null);
 const frame=useRef<number>();
 const queuedPosition=useRef<{x:number;y:number}|null>(null);
 useEffect(()=>()=>{if(frame.current)cancelAnimationFrame(frame.current);},[]);
 const drag=useRef<{id:number;x:number;y:number;originX:number;originY:number}|null>(null);
 useEffect(()=>{const update=()=>setViewport({width:window.innerWidth,height:window.innerHeight});window.addEventListener('resize',update);return()=>window.removeEventListener('resize',update);},[]);
 useEffect(()=>{setPosition(null);},[prefs.x,prefs.y,prefs.side]);
 useEffect(()=>{
  let active=true;setSource(null);setStatus({state:'loading',progress:0});
  const builtin=BUILTIN_MODELS.find(m=>m.id===prefs.modelId);
  if(builtin)setSource({kind:'url',url:`${import.meta.env.BASE_URL}models/${builtin.file}`,name:builtin.name,format:builtin.format});
  else getModel(prefs.modelId).then(model=>{if(!active)return;if(!model)throw new Error('モデルが見つかりません。設定でモデルを選び直してください。');setSource({kind:'blob',blob:model.blob,name:model.name,format:model.format??inferModelFormat(model.name)});}).catch(e=>{if(active)setStatus({state:'error',message:e instanceof Error?e.message:'モデルを読み込めませんでした'});});
  return()=>{active=false;};
 },[prefs.modelId]);
 const width=Math.min(prefs.size,viewport.width-24),height=Math.min(width*1.45,viewport.height-120);
 const resting=useMemo(()=>({x:prefs.x===null?(prefs.side==='left'?12:viewport.width-width-12):prefs.x*viewport.width/(prefs.viewportWidth??viewport.width),y:prefs.y===null?viewport.height-height-100:prefs.y*viewport.height/(prefs.viewportHeight??viewport.height)}),[prefs.x,prefs.y,prefs.side,prefs.viewportWidth,prefs.viewportHeight,width,height,viewport.width,viewport.height]);
 const point=position??resting;
 const move=(e:ReactPointerEvent<HTMLDivElement>)=>{
  const g=drag.current;if(!g||g.id!==e.pointerId)return;
  queuedPosition.current={x:g.originX+e.clientX-g.x,y:g.originY+e.clientY-g.y};
  if(!frame.current)frame.current=requestAnimationFrame(()=>{frame.current=undefined;setPosition(queuedPosition.current);});
 };
 const finish=(e:ReactPointerEvent<HTMLDivElement>)=>{
  const g=drag.current;if(!g||g.id!==e.pointerId)return;
  if(frame.current)cancelAnimationFrame(frame.current);frame.current=undefined;
  const next={x:g.originX+e.clientX-g.x,y:g.originY+e.clientY-g.y};drag.current=null;setPosition(next);
  updateCompanion(userId,{...next,viewportWidth:viewport.width,viewportHeight:viewport.height});
 };
 return createPortal(<aside aria-label="LimeAI キャラクター" data-lime-page-companion style={{position:'fixed',left:point.x,top:point.y,width,height,zIndex:140,pointerEvents:'none'}} className="group">
  <div className="absolute inset-0 pointer-events-auto touch-none cursor-grab active:cursor-grabbing" data-lime-companion-stage
    onPointerDown={e=>{if(drag.current||e.button>0)return;e.preventDefault();if(e.isTrusted)e.currentTarget.setPointerCapture(e.pointerId);drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,originX:point.x,originY:point.y};}}
    onPointerMove={move} onPointerUp={finish} onPointerCancel={()=>{if(frame.current)cancelAnimationFrame(frame.current);frame.current=undefined;drag.current=null;setPosition(null);}}>

   {source&&<StageBoundary key={prefs.modelId} onError={()=>setStatus({state:'error',message:'3Dモデルを表示できませんでした。別のモデルを選んでください。'})}><Suspense fallback={null}><Stage source={source} night={resolvedTheme==='dark'} onStatus={setStatus}/></Suspense></StageBoundary>}
  </div>
  {status.state==='loading'&&<p role="status" className="absolute bottom-10 left-0 right-0 rounded-xl bg-background/80 p-2 text-center text-xs text-muted-foreground backdrop-blur">キャラクターを読み込み中…</p>}
  {status.state==='error'&&<p role="alert" className="absolute bottom-10 rounded-xl bg-background/90 p-3 text-xs text-destructive shadow-sm">{status.message}</p>}
  <div className="absolute bottom-0 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border/60 bg-background/75 p-1 shadow-sm backdrop-blur-md pointer-events-auto sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity">
   <Link to="/settings" aria-label="キャラクターの設定" className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-muted"><Settings2 className="h-4 w-4"/></Link>
   <button aria-label="キャラクターを非表示" className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-muted" onClick={()=>updateCompanion(userId,{enabled:false})}><X className="h-4 w-4"/></button>
  </div>
 </aside>,document.body);
}

// CompanionSettings
function CompanionSettings({userId}:{userId:string}){
 const prefs=useCompanion(userId),[models,setModels]=useState<StoredModel[]>([]),[error,setError]=useState(false);
 useEffect(()=>{let active=true;listModels().then(value=>{if(active)setModels(value);}).catch(()=>{if(active)setError(true);});return()=>{active=false;};},[]);
 return <section className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft" data-lime-companion-settings>
 <div className="flex items-center gap-3"><Sparkles className="h-5 w-5 shrink-0 text-primary"/><h2 className="flex-1 font-display text-base font-bold">キャラクター</h2><Switch aria-label="全ページにキャラクターを表示" checked={prefs.enabled} onCheckedChange={enabled=>updateCompanion(userId,{enabled})}/></div>
 <div className="mt-4 space-y-4">
 <div className="space-y-2"><Label htmlFor="companion-model">モデル</Label><select id="companion-model" className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm" value={prefs.modelId} onChange={e=>updateCompanion(userId,{modelId:e.target.value})}>
 {BUILTIN_MODELS.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}{models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select>
 {error&&<p role="alert" className="text-sm text-destructive">保存済みモデルを読み込めませんでした。</p>}
 <Link to="/chat" className="inline-block text-sm text-primary hover:underline">LimeAIでモデルを追加</Link></div>
 <div className="space-y-2"><Label htmlFor="companion-size">大きさ</Label><input id="companion-size" aria-label="キャラクターの大きさ" type="range" min="120" max="360" step="10" value={prefs.size} onChange={e=>updateCompanion(userId,{size:Number(e.target.value)})} className="block w-full accent-primary"/></div>
 <div className="flex flex-wrap items-center gap-2"><Label htmlFor="companion-side">配置</Label><select id="companion-side" className="h-9 rounded-xl border border-input bg-background px-3 text-sm" value={prefs.side} onChange={e=>updateCompanion(userId,{side:e.target.value as 'left'|'right',x:null,y:null})}><option value="right">右下</option><option value="left">左下</option></select><Button size="sm" variant="outline" className="rounded-full" onClick={()=>updateCompanion(userId,{x:null,y:null})}>位置を戻す</Button></div>
 </div></section>;
}

export { PageCompanion };
export { CompanionSettings };
