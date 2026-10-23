import {DropdownMenuItem} from '@/components/ui/button';
import {CommunityIcon} from './CommunityIcon';
import type {Community} from '@/api/communities';

export function CommunityAudienceItems({communities,onSelect,quotedCommunityId}:{communities:Community[];onSelect:(id:string)=>void;quotedCommunityId?:string}){
 return communities.map(c=><DropdownMenuItem key={c.id} disabled={!!quotedCommunityId&&quotedCommunityId!==c.id} className="gap-2 focus:bg-muted/40 focus:text-foreground" onSelect={()=>onSelect(c.id)}><CommunityIcon className="mr-2 h-4 w-4 shrink-0"/>{c.name}</DropdownMenuItem>);
}
