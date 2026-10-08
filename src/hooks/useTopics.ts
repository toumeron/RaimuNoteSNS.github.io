import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {useAuth} from './useAuth';
import {getTopicPreferences,topicsKey,updateTopicPreferences} from '@/api/topics';
import type {TopicId} from '@/lib/topics';
export function useTopics() {
 const {user}=useAuth(),client=useQueryClient();
 const query=useQuery({queryKey:topicsKey(user?.id),queryFn:()=>getTopicPreferences(user!.id),enabled:!!user,staleTime:0});
 const mutation=useMutation({mutationFn:({ids,status}:{ids:TopicId[];status:'follow'|'dismiss'|'clear'})=>updateTopicPreferences(ids,status),onSuccess:async()=>{
   await Promise.all([client.invalidateQueries({queryKey:topicsKey(user?.id)}),client.invalidateQueries({queryKey:['feed','recommended']}),client.invalidateQueries({queryKey:['recommendation-preferences',user?.id??null]})]);
 }});
 return {...query,mutation};
}
