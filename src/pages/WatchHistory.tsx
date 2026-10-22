import {useEffect,useRef,useState} from 'react';
import {useParams,Link,Navigate} from 'react-router-dom';
import {useInfiniteQuery,useQuery,useQueryClient} from '@tanstack/react-query';
import {Search,Trash2} from 'lucide-react';
import {useAuth} from '@/hooks/useAuth';
import { useProfile } from "@/hooks/useFeed";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { PrivateAccountBadge, ProviderVerificationBadge } from "@/components/ui/avatar";
import { displayUsername } from "@/lib/utils";
import {Button} from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/button";
import {toast} from 'sonner';
import {useInView} from 'react-intersection-observer';
import {externalRead} from '@/lib/utils';
import {ANIME_HISTORY_CHANGED,animeHistoryKey,animeArtworkUrl,groupAnimeHistory,fetchAnimeArtwork,fetchAnimeYouTubeId,animeYouTubeUrl,getAnimeHistory,changeAnimeHistory,searchAnimeWorks,getAnimeEpisodes,saveAnimeViewing,resolveAnimeImport,saveAnimeImport,scanAnimePosts,parseAnimeImport,importWorkTitle,type AnimeHistoryState,type AnimeWork,type AnimeImportItem,type AnimeImportResolution} from "@/api/topics";

const importKey=(item:AnimeImportItem)=>JSON.stringify([item.source,item.sourceUrl,item.title,item.episodeText]);
const dateLabel=(value:string|null)=>value?new Intl.DateTimeFormat('ja-JP',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'視聴日時不明';
function AnimeImage({work,title}:{work:AnimeWork;title:string}){
 const {ref,inView}=useInView({triggerOnce:true,rootMargin:'200px'});
 const [failed,setFailed]=useState<string[]>([]);
 const original=[work.image,...(work.imageFallbacks??[])].filter(animeArtworkUrl);
 const remaining=original.filter(url=>!failed.includes(url));
 const artwork=useQuery({queryKey:['anime-artwork-v2',work.id,work.title,work.season],queryFn:({signal})=>externalRead(()=>fetchAnimeArtwork(work),signal),enabled:inView&&!remaining.length,staleTime:query=>query.state.data?.imageFallbacks?.length?24*60*60000:60000,gcTime:30*60000,retry:false});
 const src=[...remaining,...(artwork.data?.imageFallbacks??[])].find(url=>animeArtworkUrl(url)&&!failed.includes(url));
 return <div ref={ref} className="anime-history-image">{src?<img src={src} alt={title} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(previous=>[...previous,src])}/>:<span aria-label="画像なし"/>}</div>;
}
export default function WatchHistory(){
 const {user,loading}=useAuth();const {username}=useParams();
 if(!username){if(loading)return <p className="p-8">読み込み中…</p>;return user?<Navigate to={`/u/${encodeURIComponent(user.username)}/watch-history`} replace/>:<section className="anime-history"><h1>視聴履歴</h1><Link to="/auth">自分の履歴を開くにはログインしてください</Link></section>;}
 return <History key={`${username}:${user?.id??'guest'}`} username={username} owner={user?.username===username?user.id:null}/>;
}
function History({username,owner}:{username:string;owner:string|null}){
 const profile=useProfile(owner?undefined:username);
 const queries=useQueryClient();const key=[...animeHistoryKey(username),owner];
 const history=useQuery({queryKey:key,queryFn:({signal})=>getAnimeHistory(username,signal),staleTime:30000,retry:false});
 const [filter,setFilter]=useState('');
 const [addOpen,setAddOpen]=useState(false),[search,setSearch]=useState(''),[work,setWork]=useState<AnimeWork|null>(null),[episodeId,setEpisodeId]=useState('');
 const [watchedAt,setWatchedAt]=useState(''),[manualImport,setManualImport]=useState<AnimeImportItem|undefined>();
 const [busy,setBusy]=useState(false);
 const [importOpen,setImportOpen]=useState(false),[importRows,setImportRows]=useState<AnimeImportResolution[]>([]),[selected,setSelected]=useState<Set<string>>(new Set()),[importProgress,setImportProgress]=useState(''),[importError,setImportError]=useState('');
 const [searchFocused,setSearchFocused]=useState(false);
 const searchInput=useRef<HTMLInputElement>(null);
 const initialScan=useRef(false),alive=useRef(true),transferTimer=useRef<ReturnType<typeof setTimeout>>();
 const [transferPending,setTransferPending]=useState(false);
 const requestTransfer=()=>{
  if(transferPending)return;setTransferPending(true);
  transferTimer.current=setTimeout(()=>{if(alive.current){setTransferPending(false);toast.error('拡張機能を有効にして、このページを再読み込みしてください。');}},3000);
  window.postMessage({type:'LIME_ANIME_REQUEST_TRANSFER',version:1},window.location.origin);
 };
 useEffect(()=>()=>clearTimeout(transferTimer.current),[]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const update=(state:AnimeHistoryState)=>queries.setQueryData(key,state);
 useEffect(()=>{const changed=(event:Event)=>{const detail=(event as CustomEvent).detail;if(detail?.owner===owner&&detail.state)update(detail.state);};window.addEventListener(ANIME_HISTORY_CHANGED,changed);return()=>window.removeEventListener(ANIME_HISTORY_CHANGED,changed);},[owner,queries]);
 const scan=async(cursor?:string)=>{
  try{const result=await scanAnimePosts(owner,cursor);if(alive.current)update(result.state);}
  catch{/* A later public post or page visit can attempt detection again. */}
 };
 useEffect(()=>{if(owner&&history.data?.autoAdd&&!initialScan.current){initialScan.current=true;void scan();}},[history.data?.autoAdd]);
 const results=useQuery({queryKey:['anime-catalog',owner,search],queryFn:({signal})=>searchAnimeWorks(owner,search,signal),enabled:!!owner&&searchFocused&&search.length>=2,staleTime:5*60000,retry:false});
 const episodes=useInfiniteQuery({queryKey:['anime-episodes',owner,work?.id],queryFn:({pageParam,signal})=>getAnimeEpisodes(owner,work!.id,pageParam,signal),initialPageParam:1,getNextPageParam:page=>page.nextPage??undefined,enabled:addOpen&&!!work,staleTime:5*60000,retry:false});
 useEffect(()=>{const timer=setTimeout(()=>setSearch(filter.trim()),350);return()=>clearTimeout(timer);},[filter]);
 const openAdd=(item?:AnimeImportItem)=>{setImportOpen(false);setManualImport(item);setFilter(item?importWorkTitle(item):'');setSearch(item?importWorkTitle(item):'');setSearchFocused(true);requestAnimationFrame(()=>searchInput.current?.focus());};
 const chooseWork=(row:AnimeWork)=>{
  setWork(row);setEpisodeId('');setWatchedAt(manualImport?.watchedAt?new Date(Date.parse(manualImport.watchedAt)-new Date(manualImport.watchedAt).getTimezoneOffset()*60000).toISOString().slice(0,16):manualImport?'':new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16));setSearchFocused(false);setAddOpen(true);
 };
 const save=async()=>{
  if(!work)return;setBusy(true);
  try{const result=await saveAnimeViewing(owner,work.id,episodeId?Number(episodeId):null,watchedAt?new Date(watchedAt).toISOString():null,manualImport);update(result.state);setAddOpen(false);setFilter('');setSearch('');if(manualImport){setImportRows(rows=>rows.filter(row=>row.item!==manualImport));setImportOpen(true);}setManualImport(undefined);toast.success('視聴履歴に追加しました');}
  catch(error){toast.error((error as Error).message);}finally{setBusy(false);}
 };
 const acceptTransfer=async(items:unknown)=>{
  if(!owner)return;
  setAddOpen(false);setImportOpen(true);setImportError('');setImportProgress('照合中…');setImportRows([]);setSelected(new Set());setBusy(true);
  try{
   const parsed=parseAnimeImport({format:'limenote-anime-history',version:1,items});let rows:AnimeImportResolution[]=[];
   for(let i=0;i<parsed.length;i+=10){if(!alive.current)return;const result=await resolveAnimeImport(owner,parsed.slice(i,i+10));rows=[...rows,...result.rows];setImportRows(rows);setSelected(new Set(rows.flatMap(row=>row.work?[importKey(row.item)]:[])));setImportProgress(`${Math.min(i+10,parsed.length)} / ${parsed.length}`);}
   if(!parsed.length)setImportError('移行する履歴がありません');
  }catch(error){setImportError((error as Error).message);}finally{if(alive.current){setBusy(false);setImportProgress('');}}
 };
 useEffect(()=>{
  if(!owner)return;
  const receive=(event:MessageEvent)=>{
   if(event.source!==window||event.origin!==window.location.origin)return;
   if(event.data?.type==='LIME_ANIME_HELLO')window.postMessage({type:'LIME_ANIME_READY',version:1},window.location.origin);
   if(event.data?.type==='LIME_ANIME_TRANSFER'&&event.data.version===1&&!busy){clearTimeout(transferTimer.current);setTransferPending(false);void acceptTransfer(event.data.items);}
  };
  window.addEventListener('message',receive);window.postMessage({type:'LIME_ANIME_READY',version:1},window.location.origin);return()=>window.removeEventListener('message',receive);
 },[owner,busy]);
 const importSelected=async()=>{
  const rows=importRows.filter((row,index)=>row.work&&selected.has(importKey(row.item)));if(!rows.length)return;setBusy(true);setImportError('');let saved=0;
  try{for(let i=0;i<rows.length;i+=10){if(!alive.current)return;const chunk=rows.slice(i,i+10),result=await saveAnimeImport(owner,chunk);update(result.state);saved+=chunk.length;setImportProgress(`${saved} / ${rows.length}`);setImportRows(previous=>previous.filter(row=>!chunk.includes(row)));}setSelected(new Set());if(importRows.every(row=>rows.includes(row)))setImportOpen(false);toast.success(`${saved}件の履歴を取り込みました`);}
  catch(error){setSelected(new Set());setImportError(`${saved}件保存済み。${(error as Error).message}`);}finally{if(alive.current){setBusy(false);setImportProgress('');}}
 };
 const removeWork=async(workId:number)=>{
  if(!owner||busy)return;setBusy(true);
  try{update(await changeAnimeHistory(owner,'delete_work',{record_id:String(workId)}));toast.success('履歴を削除しました');}
  catch(error){toast.error((error as Error).message);}finally{setBusy(false);}
 };
 const entries=(history.data?.entries??[]).filter(entry=>`${entry.work.title} ${entry.work.aliases.join(' ')} ${entry.episodeText}`.normalize('NFKC').toLowerCase().includes(filter.normalize('NFKC').toLowerCase()));
 const groups=groupAnimeHistory(entries);
 return <section className="anime-history" aria-label="アニメの視聴履歴">
  {owner?<form className="anime-history-search" role="search" onSubmit={e=>{e.preventDefault();setSearch(filter.trim());setSearchFocused(true);}} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setSearchFocused(false);}}>
   <button type="submit" aria-label="アニメを検索"><Search size={25}/></button><input ref={searchInput} aria-label="アニメのタイトルを検索" placeholder="タイトルを検索" value={filter} maxLength={100} onFocus={()=>setSearchFocused(true)} onChange={e=>{setFilter(e.target.value);if(!manualImport)setManualImport(undefined);}}/>
   {owner&&searchFocused&&filter.trim().length>=2&&<div className="anime-history-suggestions">{(results.isFetching||search!==filter.trim())&&<p role="status">作品を検索中…</p>}{results.isError&&<p role="alert">{(results.error as Error).message}</p>}{results.data?.works.map(row=><button type="button" key={row.id} className="anime-history-suggestion" onClick={()=>chooseWork(row)}><AnimeImage work={row} title={row.title}/><span>{row.title}<small>{row.season}</small></span></button>)}{!results.isFetching&&results.data?.works.length===0&&<p>作品が見つかりません。</p>}</div>}

  </form>:<Link className="anime-history-profile" to={`/u/${encodeURIComponent(profile.data?.username??username)}`} aria-label={`${profile.data?.displayName??username}のプロフィール`}>
   <Avatar className="anime-history-profile-avatar"><AvatarImage src={profile.data?.avatarUrl} alt={profile.data?.displayName??username}/><AvatarFallback>{(profile.data?.displayName||username).slice(0,1)}</AvatarFallback></Avatar>
   <div className="anime-history-profile-identity"><div className="anime-history-profile-name"><h1>{profile.data?.displayName??username}</h1>{profile.data?.isPrivate&&<PrivateAccountBadge className="anime-history-profile-badge"/>}<ProviderVerificationBadge verification={profile.data?.providerVerification} className="anime-history-profile-badge"/>{profile.data?.isOfficial&&<img className="anime-history-profile-badge" src={`${import.meta.env.BASE_URL}verified.png`} alt="認証済み"/>}</div><p>@{displayUsername(profile.data?.username??username)}</p></div>
  </Link>}
  {owner&&<div className="anime-history-heading"><h1>視聴履歴</h1></div>}

  {history.isPending?<p role="status" className="anime-history-empty">読み込み中…</p>:history.isError?<p role="alert" className="anime-history-empty">{(history.error as Error).message}</p>:groups.length?<ol className="anime-history-list">{groups.map(group=><AnimeHistoryRow key={group.work.id} group={group} removable={!!owner} deleting={busy} onRemove={()=>void removeWork(group.work.id)}/>)}</ol>:<div className="anime-history-empty"><p>{filter?'一致する履歴がありません':'まだ視聴履歴がありません。'}</p></div>}
  {owner&&<footer className="anime-history-tools"><a href={`${import.meta.env.BASE_URL}extensions/anime-history.zip`} download="LimeNote-anime-history.zip">拡張機能をダウンロード</a><button type="button" disabled={busy||transferPending} onClick={requestTransfer}>{transferPending?'接続中…':'取り込み'}</button></footer>}
  <Dialog open={addOpen} onOpenChange={open=>{if(!busy){setAddOpen(open);if(!open&&manualImport){setManualImport(undefined);setImportOpen(true);}}}}><DialogContent aria-describedby={undefined} className="anime-history-dialog anime-history-add-screen" overlayClassName="anime-history-add-backdrop"><DialogTitle>{work?.title??'視聴履歴に追加'}</DialogTitle>{work&&<><label className="anime-history-field">エピソード<select aria-label="エピソード" value={episodeId} onChange={e=>setEpisodeId(e.target.value)}><option value="">作品全体（話数指定なし）</option>{episodes.data?.pages.flatMap(page=>page.episodes).map(e=><option key={e.id} value={e.id}>{e.number} {e.title}</option>)}</select></label>{episodes.isError&&<p role="alert">エピソードを取得できませんでした。</p>}{episodes.hasNextPage&&<button type="button" className="text-sm underline" disabled={episodes.isFetchingNextPage} onClick={()=>void episodes.fetchNextPage()}>続きのエピソードを表示</button>}<label className="anime-history-field">視聴日時<input aria-label="視聴日時" type="datetime-local" value={watchedAt} disabled={!!manualImport} onChange={e=>setWatchedAt(e.target.value)}/></label><Button onClick={()=>void save()} disabled={busy}>{busy?'保存中…':'視聴履歴に追加'}</Button></>}</DialogContent></Dialog>
  <Dialog open={importOpen} onOpenChange={open=>{if(!busy)setImportOpen(open);}}><DialogContent aria-describedby={undefined} className="anime-history-dialog anime-history-add-screen anime-history-import-screen" overlayClassName="anime-history-add-backdrop"><DialogTitle>取り込み</DialogTitle>{importProgress&&<p role="status" className="anime-history-import-progress">{importProgress}</p>}{importError&&<p role="alert">{importError}</p>}<div className="anime-history-import">{importRows.map((row,index)=><div key={`${row.item.sourceUrl}:${index}`}>
   {row.work?<label><input type="checkbox" disabled={busy} aria-label={`${row.work.title}を取り込む`} checked={selected.has(importKey(row.item))} onChange={e=>setSelected(previous=>{const next=new Set(previous);if(e.target.checked)next.add(importKey(row.item));else next.delete(importKey(row.item));return next;})}/><span>{row.work.title}{row.item.episodeText&&<small>{row.item.episodeText}</small>}</span></label>:<><span>{importWorkTitle(row.item)||row.item.title}</span><button type="button" className="text-sm underline" aria-label={`${row.item.title}の作品を選ぶ`} disabled={busy} onClick={()=>openAdd(row.item)}>選ぶ</button></>}
  </div>)}</div><Button disabled={busy||!importRows.some(row=>row.work&&selected.has(importKey(row.item)))} onClick={()=>void importSelected()}>取り込む</Button></DialogContent></Dialog>

 </section>;
}

function AnimeHistoryRow({group,removable,deleting,onRemove}:{group:ReturnType<typeof groupAnimeHistory>[number];removable:boolean;deleting:boolean;onRemove:()=>void}){
 const row=useRef<HTMLLIElement>(null),pointer=useRef('');const [touched,setTouched]=useState(false);
 useEffect(()=>{if(!touched)return;const outside=(event:PointerEvent)=>{if(!row.current?.contains(event.target as Node))setTouched(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[touched]);
 const {ref,inView}=useInView({triggerOnce:true,rootMargin:'200px'});
 const trailer=useQuery({queryKey:['anime-youtube',group.work.id,group.work.title,group.work.season],queryFn:({signal})=>externalRead(()=>fetchAnimeYouTubeId(group.work),signal),enabled:inView,staleTime:24*60*60000,gcTime:30*60000,retry:false});
 const entry=group.entries[0],multiple=group.entries.length>1;
 const href=animeYouTubeUrl(group.work,trailer.data);
 return <li ref={element=>{row.current=element;ref(element);}} className={`anime-history-item${touched?' anime-history-touched':''}`}><a onPointerDown={event=>{pointer.current=event.pointerType;}} onClick={event=>{if(removable&&pointer.current==='touch'&&!touched&&event.detail!==0){event.preventDefault();setTouched(true);}}} className={`anime-history-row${multiple?' anime-history-group':''}`} href={href} aria-label={`${group.work.title}をYouTubeで開く`}><div className={multiple?'anime-history-stack':''}><AnimeImage work={group.work} title={group.work.title}/></div><div className="anime-history-details">{!multiple&&entry.episodeText&&<p className="anime-history-series">{group.work.title}</p>}<h2>{multiple?group.work.title:entry.episodeText||group.work.title}</h2>{!multiple&&entry.watchedAt&&<p className="anime-history-date">{dateLabel(entry.watchedAt)}</p>}</div></a>{removable&&<button type="button" className="anime-history-delete" aria-label={`${group.work.title}を視聴履歴から削除`} disabled={deleting} onClick={event=>{event.preventDefault();event.stopPropagation();onRemove();}}><Trash2 size={24} aria-hidden="true"/></button>}</li>;
}
