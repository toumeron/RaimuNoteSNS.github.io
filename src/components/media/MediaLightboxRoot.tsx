import {Component,lazy,Suspense,useEffect,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {useLocation} from 'react-router-dom';
import {useAuth} from '@/hooks/useAuth';
import {OfflineBookmarkContext} from '@/components/stickers/Stickers';
import {MEDIA_VIEWER_EVENT,type MediaViewerSelection} from './openMediaViewer';
const Viewer=lazy(()=>import('./MediaLightbox').then(module=>({default:module.MediaLightbox})));
function Loading({onClose,failed=false}:{onClose:()=>void;failed?:boolean}){
 return createPortal(<div role="status" className="fixed inset-0 z-[2147483500] flex items-center justify-center bg-black text-white"><span>{failed?'画像・動画の画面を読み込めませんでした':'読み込み中…'}</span><button type="button" onClick={onClose} aria-label="メディアを閉じる" className="absolute right-4 top-[max(16px,env(safe-area-inset-top))] rounded-full bg-white/15 px-4 py-2">閉じる</button></div>,document.body);
}
class ViewerBoundary extends Component<{children:ReactNode;onClose:()=>void},{failed:boolean}>{
 state={failed:false};static getDerivedStateFromError(){return{failed:true};}
 render(){return this.state.failed?<Loading failed onClose={this.props.onClose}/>:this.props.children;}
}
/** Keep the event listener ready, but load viewer UI only on an actual open. */
export function MediaLightboxRoot(){
 const [selection,setSelection]=useState<MediaViewerSelection|null>(null);
 const location=useLocation(),{user}=useAuth();
 useEffect(()=>{const open=(event:Event)=>setSelection((event as CustomEvent<MediaViewerSelection>).detail);window.addEventListener(MEDIA_VIEWER_EVENT,open);return()=>window.removeEventListener(MEDIA_VIEWER_EVENT,open);},[]);
 useEffect(()=>setSelection(null),[location.key,user?.id]);
 if(!selection)return null;
 const close=()=>setSelection(null);
 return <ViewerBoundary key={`${selection.post?.id??selection.postId}:${selection.url}`} onClose={close}><Suspense fallback={<Loading onClose={close}/>}><OfflineBookmarkContext.Provider value={selection.offline??null}><Viewer selection={selection} onClose={close}/></OfflineBookmarkContext.Provider></Suspense></ViewerBoundary>;
}
