import {useQuery} from '@tanstack/react-query';
import {getLatestSearchNews} from '@/api/search-news';

export function useSearchNews(viewerId:string|null) {
  return useQuery({
    queryKey:['search-news',viewerId],
    queryFn:getLatestSearchNews,
    staleTime:60000,
    gcTime:300000,
    refetchOnWindowFocus:false,
  });
}
