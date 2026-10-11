import {useQuery,useInfiniteQuery,useQueryClient} from '@tanstack/react-query';
import {useAuth} from './useAuth';
import {getList,getLists,getListCatalog,listsKey} from '@/api/lists';
import {getListNativePosts} from '@/api/posts';
import {fetchBlueskyAuthorFeed} from '@/lib/bluesky';
import {createTimelineCursor,loadTimelinePage} from '@/lib/timelinePaging';
const uuid=/^[0-9a-f-]{36}$/i;
export function useListCatalog(owner?:string){return useQuery({queryKey:['list-catalog',owner??null],queryFn:()=>getListCatalog(owner!),enabled:!!owner,staleTime:60000,refetchOnWindowFocus:false});}
export function useLists(owner?:string){return useQuery({queryKey:listsKey(owner),queryFn:()=>getLists(owner),enabled:!!owner,staleTime:60000,refetchOnWindowFocus:false});}
export function useList(id?:string){const {user}=useAuth();return useQuery({queryKey:['user-list',user?.id??null,id],queryFn:()=>getList(id!),enabled:!!id,staleTime:60000,refetchOnWindowFocus:false});}
export function useListFeed(id?:string){
 const {user}=useAuth();const list=useList(id);const members=list.data?.members??[];
 const native=members.filter(member=>uuid.test(member.id)).map(member=>member.id);
 const external=members.filter(member=>!uuid.test(member.id)).map(member=>member.id.startsWith('misskey-user:')?member.username:member.id);
 const query=useInfiniteQuery({queryKey:['feed','list',user?.id??null,id,list.data?.updated_at],enabled:!!id&&!!list.data,
 initialPageParam:createTimelineCursor(external),queryFn:({pageParam,signal})=>loadTimelinePage(pageParam,{lime:(page,limit,before)=>getListNativePosts(native,page,limit,before,signal),bluesky:(actor,cursor,limit)=>fetchBlueskyAuthorFeed({actor,cursor,limit,signal})}),getNextPageParam:page=>page.next,staleTime:60000,refetchOnWindowFocus:false,retry:false});
 return {...query,isLoading:list.isLoading||query.isLoading,isError:list.isError||query.isError,error:list.error??query.error,refetch:async()=>{await list.refetch();return query.refetch();}};
}
export function useInvalidateLists(){const client=useQueryClient();return async()=>{await Promise.all([client.invalidateQueries({queryKey:['list-catalog']}),client.invalidateQueries({queryKey:['user-lists']}),client.invalidateQueries({queryKey:['user-list']}),client.invalidateQueries({queryKey:['feed','list']})]);};}
