import {useEffect,useCallback} from 'react';
import {useInfiniteQuery,useQueryClient} from '@tanstack/react-query';
import {useAuth} from './useAuth';
import {type TopicId} from '@/lib/topics';
import {createTopicCursor,getTopicPage} from '@/api/topic-feed';
import {createRecommendationFeedback,dismissRecommendation} from '@/api/recommendation-feedback';
import {recommendationIsDismissed} from '@/lib/recommendations';
import type {PostWithAuthor} from '@/types';
export function useTopicFeed(topic?:TopicId) {
 const {user,loading}=useAuth(),client=useQueryClient();
 const queryKey=['feed','topic',user?.id??null,topic??null,'twitter-v1'];
 const query=useInfiniteQuery({queryKey,enabled:!!topic&&!loading,initialPageParam:topic?createTopicCursor(topic):undefined,
  queryFn:({pageParam,signal})=>getTopicPage(pageParam!,user?.id??null,signal),getNextPageParam:page=>page.next,
  retry:false,gcTime:60000,staleTime:60000,refetchOnWindowFocus:false,refetchOnMount:false});
 const count=query.data?.pages.reduce((sum,page)=>sum+page.posts.length,0)??0;
 const automaticPaused=!!query.data?.pages.at(-1)?.automaticPaused;
 const isFilling=!!topic&&!automaticPaused&&count<6&&!!query.hasNextPage&&!query.isError&&!query.isFetchNextPageError&&(query.data?.pages.length??0)<4;
 useEffect(()=>{if(isFilling&&!query.isFetching)void query.fetchNextPage({cancelRefetch:false});},[isFilling,query.isFetching,query.data?.pages.length]);
 const dismiss=useCallback(async(post:PostWithAuthor)=>{
  await dismissRecommendation(post);
  const feedback=createRecommendationFeedback(post);
  client.setQueryData<typeof query.data>(queryKey,data=>data?{...data,pages:data.pages.map(page=>{
   const preferences={...page.preferences,feedback:[feedback,...(page.preferences.feedback??[])]};
   return {...page,preferences,posts:page.posts.filter(row=>!recommendationIsDismissed(row,preferences)),next:page.next?{...page.next,preferences}:undefined};
  })}:data);
 },[client,user?.id,topic]);
 return {...query,automaticPaused,isFilling,dismiss};
}
