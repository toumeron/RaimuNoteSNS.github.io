import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {Sparkles} from 'lucide-react';
import {BUILTIN_MODELS} from '@/lib/avatarModels';
import {listModels,type StoredModel} from '@/lib/avatarModelStore';
import {useCompanion,updateCompanion} from '@/lib/companionPreferences';
import {Switch} from '@/components/ui/switch';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
export function CompanionSettings({userId}:{userId:string}){
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
