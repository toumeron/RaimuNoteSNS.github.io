import {Link} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {CommunityIcon} from './CommunityIcon';
import {Avatar,AvatarFallback,AvatarImage} from '@/components/ui/avatar';
import {getCommunitySpotlight,getCommunityMembers} from '@/api/communities';
const href=(id:string)=>`/communities/${id}`;
export function CommunitySpotlight({userId}:{userId:string}){
 const query=useQuery({queryKey:['community-spotlight',userId],queryFn:()=>getCommunitySpotlight(userId),enabled:/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId),staleTime:60000});
 const community=query.data;
 const members=useQuery({queryKey:['communities','preview',community?.id],queryFn:({signal})=>getCommunityMembers(community!.id,0,'all','',signal),enabled:!!community,staleTime:60000});
 return community?<section className="community-spotlight-section"><h3>コミュニティ</h3><Link className="community-spotlight" to={href(community.id)}>{community.cover_url?<img className="community-spotlight-cover" src={community.cover_url} alt="" loading="lazy"/>:<div className="community-spotlight-cover community-cover-empty"><CommunityIcon/></div>}<div className="community-spotlight-content"><strong>{community.name}</strong>{community.description&&<p>{community.description}</p>}<div className="community-spotlight-members"><span className="community-avatar-stack">{members.data?.slice(0,5).map(member=><Avatar key={member.user.id} userId={member.user.id}><AvatarImage src={member.user.avatarUrl}/><AvatarFallback>{member.user.displayName[0]}</AvatarFallback></Avatar>)}</span><span><b>{community.member_count.toLocaleString()}</b> 人のメンバー</span></div></div></Link></section>:null;
}
