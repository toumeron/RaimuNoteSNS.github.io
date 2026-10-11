import { useQuery } from "@tanstack/react-query";
import { getLatestSearchNews, getNewsStory } from "@/api/search-news";

export function useSearchNews(viewerId:string|null) {
  return useQuery({
    queryKey:['search-news',viewerId],
    queryFn:getLatestSearchNews,
    staleTime:60000,
    gcTime:300000,
    refetchOnWindowFocus:false,
  });
}

export function useNewsStory(storyId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['news-story', storyId],
    enabled,
    queryFn: () => getNewsStory(storyId),
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });
}
