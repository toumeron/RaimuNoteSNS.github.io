import {useLayoutEffect,useRef,useState} from 'react';
import {flushPostDrafts} from '@/lib/postDrafts';
import type {PwaReloadPreparation} from '@/lib/pwaReload';
import {toast} from 'sonner';
import {draftEmojiCharacter,serializeDraftEmojis} from '@/lib/utils';
import {hasPostDraft,loadPostDraft,postDraftFingerprint,readPostDraftText,removePostDraft,revokeDraftMediaUrl,savePostDraft,savePostDraftText,type PostDraft} from '@/lib/postDrafts';

const serialise=(draft:PostDraft)=>({...draft,content:serializeDraftEmojis(draft.content)});
const restoreText=(text:string)=>text.replace(/\[\[emoji:([^\]]+)\]\]/g,(token,name)=>{try{return draftEmojiCharacter(decodeURIComponent(name));}catch{return token;}});
function release(draft:PostDraft){
 const urls=new Set([...draft.previews,...draft.originals,...(draft.poll?.options.flatMap(o=>o.image?[o.image]:[])??[]),...(draft.video?[draft.video.url]:[])]);
 urls.forEach(revokeDraftMediaUrl);
}
/** Local-only drafts: no network, cloud images or additional Supabase tables. */
export function usePostDraft(key:string|null,state:PostDraft,apply:(value:PostDraft)=>void,initial:Partial<PostDraft>={}){
 const previousKey=useRef<string|null|undefined>(undefined);
 const initialRef=useRef(initial);initialRef.current=initial;
 const latest=useRef(state);latest.current=state;
 const applyRef=useRef(apply);applyRef.current=apply;
 const session=useRef<{key:string|null;ready:boolean;suppress:boolean;failed:boolean;edited:boolean;lastFingerprint?:string}>({key:null,ready:false,suppress:false,failed:false,edited:false});
 const [ready,setReady]=useState(false);
 const readyRef=useRef(false);
 const warned=useRef(false);
 const persist=(target= session.current)=>{
  if(!target.key||target.suppress)return;
  if(!target.ready){if(target.edited)savePostDraftText(target.key,serialise(latest.current));return;}
  const fingerprint=postDraftFingerprint(latest.current);if(target.lastFingerprint===fingerprint&&!target.failed)return;target.lastFingerprint=fingerprint;
  const value=serialise(latest.current);
  const operation=hasPostDraft(value)?savePostDraft(target.key,value):removePostDraft(target.key);
  void operation.then(()=>{target.failed=false;},()=>{target.failed=true;target.lastFingerprint=undefined;if(!warned.current&&typeof indexedDB!=='undefined'){warned.current=true;toast.error('下書きを端末に保存できません。送信するまで画面を閉じないでください。');}});
 };
 useLayoutEffect(()=>{
  let cancelled=false;
  const target:{key:string|null;ready:boolean;suppress:boolean;failed:boolean;edited:boolean;lastFingerprint?:string}={key,ready:false,suppress:false,failed:false,edited:false};session.current=target;readyRef.current=false;setReady(false);
  const changed=previousKey.current!==undefined&&previousKey.current!==key;previousKey.current=key;
  const baseline:PostDraft=changed?{content:'',previews:[],originals:[],sticker:null,poll:null,scheduledAt:null,visibility:'public',quotedPost:null,video:null,communityId:initialRef.current.communityId}:latest.current;
  if(changed){release(latest.current);latest.current=baseline;applyRef.current(baseline);}
  if(!key){target.ready=true;readyRef.current=true;setReady(true);return;}
  // Recover the latest text immediately; image Blobs are restored from IDB.
  const text=readPostDraftText(key);
  if(text&& !baseline.content)applyRef.current({...baseline,...text,content:restoreText(text.content??'')});
  void loadPostDraft(key).then(saved=>{
   if(cancelled){if(saved)release(saved);return;}
   if(saved){
    const current=latest.current;
    const restored=restoreText(saved.content);
    const content=target.edited?current.content:current.content!==baseline.content&&current.content!==restored?current.content:baseline.content&&!restored.startsWith(baseline.content)?baseline.content+'\n'+restored:restored;
    const next={...saved,content,quotedPost:baseline.quotedPost??current.quotedPost??saved.quotedPost};
    if(!target.edited&&content===restored&&next.quotedPost?.id===saved.quotedPost?.id)target.lastFingerprint=postDraftFingerprint(next);
    applyRef.current(next);
   }else target.lastFingerprint=postDraftFingerprint(baseline);
  }).catch(()=>{target.failed=true;target.lastFingerprint=postDraftFingerprint(baseline);}).finally(()=>{
   if(cancelled)return;target.ready=true;readyRef.current=true;setReady(true);
  });
  return()=>{cancelled=true;persist(target);};
 // Context changes remount the composer; content updates must not restart hydration.
 },[key]);
 useLayoutEffect(()=>{
  const target=session.current;
  if(target.key!==key)return;
  if(target.suppress){if(!hasPostDraft(state))target.suppress=false;return;}
  persist(target);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key,ready,state.content,state.previews,state.originals,state.poll,state.video,state.sticker,state.scheduledAt,state.visibility,state.communityId,state.quotedPost]);
 useLayoutEffect(()=>{
  const save=()=>persist();
  const beforeUnload=(event:BeforeUnloadEvent)=>{save();if(session.current.failed&&hasPostDraft(latest.current)){event.preventDefault();event.returnValue='';}};
  const update=(event:Event)=>{
   const target=session.current;
   persist(target);
   (event as CustomEvent<PwaReloadPreparation>).detail.waitUntil(flushPostDrafts().then(()=>{
    if(target.failed||!target.ready&&target.edited)throw new Error('Draft is not committed yet');
   }));
  };
  window.addEventListener('lime-pwa-before-reload',update);
  window.addEventListener('pagehide',save);window.addEventListener('beforeunload',beforeUnload);document.addEventListener('visibilitychange',save);
  return()=>{window.removeEventListener('lime-pwa-before-reload',update);window.removeEventListener('pagehide',save);window.removeEventListener('beforeunload',beforeUnload);document.removeEventListener('visibilitychange',save);};
 },[]);
 const beginSubmission=()=>{persist();return postDraftFingerprint(latest.current);};
 const completeSubmission=async(token:string)=>{
  const target=session.current;
  if(token!==postDraftFingerprint(latest.current))return false;
  target.suppress=true;
  if(target.key)await removePostDraft(target.key).catch(()=>{target.failed=true;});
  if(token!==postDraftFingerprint(latest.current)){target.suppress=false;persist(target);return false;}
  return true;
 };
 return {ready,readyRef,beginSubmission,completeSubmission,markEdited:()=>{session.current.edited=true;}};
}
