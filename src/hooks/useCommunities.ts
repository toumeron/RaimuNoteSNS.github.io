import {useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {communityKeys,getMyCommunities} from '@/api/communities';

export function useMyCommunities(owner?:string){
 return useQuery({queryKey:communityKeys.mine(owner??''),queryFn:getMyCommunities,enabled:!!owner,staleTime:30000});
}
export function useJoinedCommunities(owner?:string){
 const query=useMyCommunities(owner);
 const communities=(query.data?.communities??[]).filter(c=>query.data?.memberships.some(m=>m.community_id===c.id&&m.status==='active'));
 return {...query,communities,pinned:communities.filter(c=>query.data?.memberships.some(m=>m.community_id===c.id&&m.pinned&&m.status==='active'))};
}

export function usePostCommunityDestination(owner?:string,defaultId?:string,quotedCommunityId?:string){
 const joined=useJoinedCommunities(owner);
 const [selectedId,setCommunityId]=useState<string|undefined>(defaultId);
 const previousDefault=useRef(defaultId);
 useEffect(()=>{if(previousDefault.current!==defaultId){previousDefault.current=defaultId;setCommunityId(defaultId);}},[defaultId]);
 const communityId=quotedCommunityId??selectedId;
 return {communityId,setCommunityId,communities:joined.communities,communityName:joined.communities.find(c=>c.id===communityId)?.name??'コミュニティ',resetCommunity:()=>setCommunityId(defaultId)};
}
