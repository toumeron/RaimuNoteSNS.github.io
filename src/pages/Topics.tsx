import {useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {Check,CheckCircle2,Hash,Loader2,Plus,X} from 'lucide-react';
import {useTopics} from '@/hooks/useTopics';
import {TOPICS,EMPTY_TOPIC_PREFERENCES,type TopicId} from '@/lib/topics';
import {Button} from '@/components/ui/button';
export default function Topics() {
 const query=useTopics(),[params,setParams]=useSearchParams(),[selected,setSelected]=useState<TopicId[]>([]);
 const active=params.get('tab')==='recommended'?'recommended':params.get('tab')==='dismissed'?'dismissed':'followed';
 const preferences=query.data??EMPTY_TOPIC_PREFERENCES;
 const save=(ids:TopicId[],status:'follow'|'dismiss'|'clear')=>query.mutation.mutate({ids,status},{onSuccess:()=>setSelected([])});
 const available=TOPICS.filter(topic=>!preferences.followed.includes(topic.id)&&!preferences.dismissed.includes(topic.id));
 if(query.isPending)return <div role="status" className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin"/><span className="sr-only">トピックを読み込み中</span></div>;
 if(query.isError)return <div className="p-6"><p role="alert">トピックを読み込めませんでした。</p><Button variant="outline" className="mt-3" onClick={()=>query.refetch()}>再試行</Button></div>;
 const selecting=active==='followed'&&preferences.followed.length===0;
 const rows=TOPICS.filter(topic=>active==='dismissed'?preferences.dismissed.includes(topic.id):preferences.followed.includes(topic.id));
 return <div id="topic-content" role="tabpanel" aria-labelledby={selecting?undefined:`topic-tab-${active}`} aria-label={selecting?'トピックの選択':undefined} data-lime-topics>
 {query.mutation.isError&&<p role="alert" className="px-4 py-3 text-sm text-destructive">保存に失敗しました。もう一度お試しください。</p>}
 {selecting?<section className="px-5 pt-8 sm:px-8">
  <h2 className="text-2xl font-extrabold leading-tight sm:text-3xl">興味のあるトピックを選択してください</h2>
  <div className="my-7 grid grid-cols-2 gap-3 min-[390px]:grid-cols-3 sm:gap-4">
   {available.map(topic=><button key={topic.id} type="button" aria-pressed={selected.includes(topic.id)} disabled={query.mutation.isPending} onClick={()=>setSelected(current=>current.includes(topic.id)?current.filter(id=>id!==topic.id):[...current,topic.id])} className={`relative flex min-h-28 items-end rounded-2xl border px-3 py-4 text-left text-sm font-bold transition-colors min-[390px]:text-xs sm:min-h-32 sm:p-4 sm:text-base ${selected.includes(topic.id)?'border-primary bg-primary text-primary-foreground':'border-border hover:bg-muted/30'}`}>
    {selected.includes(topic.id)&&<CheckCircle2 className="absolute right-3 top-3 h-5 w-5"/>}{topic.name}
   </button>)}
  </div>
  {!available.length&&<p className="py-6 text-sm text-muted-foreground">すべてのトピックが「興味なし」に設定されています。下のボタンから管理できます。</p>}
  {!!preferences.dismissed.length&&<Button variant="link" className="mb-4 px-0" onClick={()=>setParams({tab:'dismissed'})}>興味なしのトピックを管理</Button>}
  <div className="sticky bottom-[var(--lime-bottom-nav-height,64px)] -mx-5 flex items-center justify-between gap-3 border-t border-border bg-background px-5 py-4 md:bottom-0 sm:-mx-8 sm:px-8">
   <span className="text-sm text-muted-foreground">{selected.length}件選択済み</span><Button className="rounded-full px-8" disabled={!selected.length||query.mutation.isPending} onClick={()=>save(selected,'follow')}>{query.mutation.isPending?'保存中…':'次へ'}</Button>
  </div>
 </section>:<>
  {active!=='recommended'&&rows.map(topic=><div key={topic.id} data-lime-topic-row className="flex items-center gap-3 px-4 py-4">
   <Hash className="h-7 w-7 shrink-0 rounded-full bg-primary p-1.5 text-primary-foreground"/><div className="min-w-0 flex-1"><h2 className="text-sm font-bold">{topic.name}</h2><p className="mt-0.5 text-xs text-muted-foreground">{topic.description}</p></div>
   <Button variant="outline" disabled={query.mutation.isPending} className="h-8 shrink-0 rounded-full px-4 text-xs" aria-label={active==='followed'?`${topic.name}をフォロー解除`:`${topic.name}の興味なしを解除`} onClick={()=>save([topic.id],'clear')}>{active==='followed'?<><Check className="mr-1 h-3 w-3"/>フォロー中</>:'解除する'}</Button>
  </div>)}
  {active==='dismissed'&&!rows.length&&<p className="p-6 text-sm text-muted-foreground">「興味なし」に設定したトピックはありません。</p>}
  {active!=='dismissed'&&<section className="border-b border-border px-4 py-6">
   <h2 className="text-xl font-bold">おすすめトピック</h2><p className="mt-1 text-sm text-muted-foreground">気になるトピックをフォローしましょう。</p>
   <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 min-[1280px]:grid-cols-3">{available.map(topic=><div key={topic.id} className="flex min-w-0 items-center rounded-full border border-border">
    <span className="min-w-0 flex-1 px-3 text-sm font-semibold">{topic.name}</span><button type="button" aria-label={`${topic.name}をフォローする`} disabled={query.mutation.isPending} onClick={()=>save([topic.id],'follow')} className="flex h-11 w-9 shrink-0 items-center justify-center rounded-full text-primary hover:bg-muted disabled:opacity-50"><Plus className="h-4 w-4"/></button>
    <button type="button" aria-label={`${topic.name}に興味なし`} disabled={query.mutation.isPending} onClick={()=>save([topic.id],'dismiss')} className="flex h-11 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-50"><X className="h-4 w-4"/></button>
   </div>)}</div>
   {!available.length&&<p className="mt-4 text-sm text-muted-foreground">追加できるトピックはありません。</p>}
  </section>}
 </>}
 </div>;
}
