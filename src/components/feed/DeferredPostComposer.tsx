import {Component,lazy,Suspense,type ComponentProps,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import type {PostOverlay as Overlay,PostComposer as Composer} from './OverlayPostComposer';
const LazyOverlay=lazy(()=>import('./OverlayPostComposer').then(module=>({default:module.PostOverlay})));
const LazyComposer=lazy(()=>import('./OverlayPostComposer').then(module=>({default:module.PostComposer})));
function Pending({onClose,failed=false}:{onClose?:()=>void;failed?:boolean}){
 return <div role="status" className="flex items-center gap-4 bg-background p-6 text-foreground"><span>{failed?'投稿画面を読み込めませんでした':'読み込み中…'}</span>{onClose&&<button type="button" onClick={onClose} className="underline">閉じる</button>}</div>;
}
class Boundary extends Component<{children:ReactNode;onClose?:()=>void},{failed:boolean}>{
 state={failed:false};static getDerivedStateFromError(){return{failed:true};}
 render(){return this.state.failed?<Pending failed onClose={this.props.onClose}/>:this.props.children;}
}
export function PostOverlay(props:ComponentProps<typeof Overlay>){
 if(!props.isOpen)return null;
 const fallback=createPortal(<div className="fixed inset-0 z-[2147483000] flex items-start justify-center bg-black/20 pt-[max(16px,env(safe-area-inset-top))]"><Pending onClose={props.onClose}/></div>,document.body);
 return <Boundary onClose={props.onClose}><Suspense fallback={fallback}><LazyOverlay {...props}/></Suspense></Boundary>;
}
export function PostComposer(props:ComponentProps<typeof Composer>){
 return <Boundary onClose={props.onCancel}><Suspense fallback={<Pending onClose={props.onCancel}/>}><LazyComposer {...props}/></Suspense></Boundary>;
}
