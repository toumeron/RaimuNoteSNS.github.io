import { useQuery } from '@tanstack/react-query';
import { getNewsStory } from '@/api/search-news';

export function useNewsStory(storyId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['news-story', storyId],
    enabled,
    queryFn: () => getNewsStory(storyId),
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });
}
