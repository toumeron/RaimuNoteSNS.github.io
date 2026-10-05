import {fetchLinkPreview,singlePreviewUrl,type LinkPreview} from '@/lib/linkPreview';
import {spaceLinkIn} from '@/lib/spaceLinks';
import {spaceRpc} from '@/api/spaces';
import type {OfflineSpaceCard} from '@/lib/offlineBookmarks';
import {useEffect,useRef,useState} from 'react';
import {toast} from 'sonner';
import {getBookmarkPage} from '@/api/bookmarks';
import {supabase} from '@/lib/supabase';
import {splitStickers,stickerUrl,type CustomSticker} from '@/lib/stickers';
import {bookmarkAssetUrls,deleteOfflineBookmarks,downloadBookmarkAssets,isInstalledPwa,openOfflineBookmarks,readOfflineBookmarks,writeOfflineBookmarks} from '@/lib/offlineBookmarks';

export function useOfflineBookmarks(userId?:string) {
  const [pwa,setPwa]=useState(isInstalledPwa);
  const [online,setOnline]=useState(navigator.onLine);
  const [saved,setSaved]=useState<ReturnType<typeof openOfflineBookmarks>|null>(null);
  const [checking,setChecking]=useState(true);
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState('');
  const owner=useRef(userId);owner.current=userId;
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    const update=()=>{setOnline(navigator.onLine);setPwa(isInstalledPwa());};
    const display=window.matchMedia('(display-mode: standalone)');
    window.addEventListener('online',update);window.addEventListener('offline',update);display.addEventListener?.('change',update);
    return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);display.removeEventListener?.('change',update);};
  },[]);
  useEffect(()=>{
    let live=true,opened:ReturnType<typeof openOfflineBookmarks>|null=null;
    setSaved(null);setChecking(!!(pwa&&userId));setBusy(false);setProgress('');
    if(pwa&&userId)void readOfflineBookmarks(userId).then(value=>{
      if(!live)return;if(value)opened=openOfflineBookmarks(value);setSaved(opened);
    }).catch(()=>{if(live)toast.error('オフライン保存データを読み込めませんでした');}).finally(()=>{if(live)setChecking(false);});
    return()=>{live=false;opened?.release();};
  },[pwa,userId]);
  // New downloads are owned by this mounted account; never publish a previous
  // account's snapshot into the next account's page.
  const visibleSaved=saved?.userId===userId?saved:null;
  const current=(id:string)=>mounted.current&&owner.current===id;
  const toggle=async()=>{
    if(!pwa||!userId||busy||checking)return;
    const id=userId;setBusy(true);
    try{
      if(visibleSaved){
        await deleteOfflineBookmarks(id);
        if(current(id)){visibleSaved.release();setSaved(null);toast.success('オフライン保存データを削除しました');}
      }else{
        if(!navigator.onLine)throw new Error('オンラインでブックマークを保存してください');
        const posts=[];
        for(let offset=0;;){
          const page=await getBookmarkPage(id,offset);
          if(!current(id))return;
          posts.push(...page.posts);setProgress(`${posts.length}件取得中`);
          if(page.next===undefined)break;offset=page.next;
        }
        const unique=[...new Map(posts.map(post=>[post.id,post])).values()];
        const contents:string[]=[],nativeContents:string[]=[];
        const visit=(post:typeof unique[number])=>{contents.push(post.content);if(post.source!=='bluesky'&&!post.id.startsWith('bsky:'))nativeContents.push(post.content);if(post.parentPost)visit(post.parentPost);};unique.forEach(visit);
        const names=new Set(contents.flatMap(text=>[...splitStickers(text).flatMap(part=>part.name?[part.name]:[]),...[...text.matchAll(/:([\w-]+):/g)].map(match=>match[1])]));
        let emojis:CustomSticker[]=[];
        if(names.size){const {data,error}=await supabase.from('custom_emojis').select('*');if(error)throw error;emojis=(data??[]).filter(emoji=>names.has(emoji.name));}
        const spaces:Record<string,OfflineSpaceCard|null>={};
        for(const spaceId of new Set(contents.flatMap(text=>{const link=spaceLinkIn(text);return link?[link.id]:[];})))spaces[spaceId]=await spaceRpc<OfflineSpaceCard|null>('get_space_card',{p_space_id:spaceId});
        const linkPreviews:Record<string,LinkPreview|null>={};
        const linkUrls=[...new Set(nativeContents.flatMap(text=>{const url=singlePreviewUrl(text);return url?[url]:[];}))];
        for(let start=0;start<linkUrls.length;start+=4)await Promise.all(linkUrls.slice(start,start+4).map(async url=>{linkPreviews[url]=await fetchLinkPreview(url);}));
        const urls=[...new Set([...bookmarkAssetUrls([...unique,...Object.values(spaces).filter(Boolean),...Object.values(linkPreviews).filter(Boolean)] as typeof unique),...emojis.flatMap(emoji=>{const url=stickerUrl(emoji);return url?[url]:[];})])];
        const assets=await downloadBookmarkAssets(urls,(done,total)=>{if(current(id))setProgress(`画像 ${done}/${total}`);});
        if(!current(id))return;
        if(!navigator.onLine)throw new Error('通信が切れたため保存できませんでした。もう一度お試しください');
        const value={userId:id,savedAt:new Date().toISOString(),posts:unique,emojis,spaces,linkPreviews,assets};
        await writeOfflineBookmarks(value);
        void navigator.storage?.persist?.().catch(()=>false);
        if(current(id)){setSaved(openOfflineBookmarks(value));toast.success(`${unique.length}件のブックマークをオフラインに保存しました`);}
      }
    }catch(error){if(current(id))toast.error(error instanceof Error?error.message:'オフライン保存に失敗しました');}
    finally{if(current(id)){setBusy(false);setProgress('');}}
  };
  // Release object URLs allocated by a save action as well as those from a read.
  useEffect(()=>()=>saved?.release(),[saved]);
  return {pwa,online,saved:visibleSaved,checking,busy,progress,toggle};
}
