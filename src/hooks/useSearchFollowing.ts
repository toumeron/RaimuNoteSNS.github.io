import {useQuery} from '@tanstack/react-query';
import {useAuth} from './useAuth';
import {getSearchFollowingUsers} from '@/api/users';

export function useSearchFollowing(enabled=true){
 const {user}=useAuth();
 return useQuery({queryKey:['follow-list','search-priority',user?.id],queryFn:({signal})=>getSearchFollowingUsers(user!.id,signal),enabled:enabled&&!!user?.id,staleTime:60_000,refetchOnWindowFocus:false});
}
