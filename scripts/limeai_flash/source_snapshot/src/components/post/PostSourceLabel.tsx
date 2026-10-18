import {createContext,useContext} from 'react';
export const PostSourceLabelVisibility=createContext(true);
import {Globe} from 'lucide-react';
export function PostSourceLabel({post,small=false}:{post:{id:string;source?:string};small?:boolean}){
 const visible=useContext(PostSourceLabelVisibility);
 if(!visible)return null;
 const label=post.source==='x'||post.id.startsWith('x:')?'twitter':post.source==='misskey'||post.id.startsWith('misskey:')?'Misskey':post.source==='bluesky'||post.id.startsWith('bsky:')?'Bluesky':null;
 if(!label)return null;
 return <div data-lime-post-provider className="mt-1.5 flex items-center gap-1 text-muted-foreground/70"><Globe className="h-3.5 w-3.5"/><span className={small?'text-[13px] font-medium':'text-[15px] font-medium'}>{label}</span></div>;
}
