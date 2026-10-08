import { useInfiniteQuery } from '@tanstack/react-query';
import { useRecommendationImpressions } from './useRecommendationImpressions';
import { useAuth } from './useAuth';
import { createRecommendationCursor, getRecommendationPage } from '@/api/recommendations';
import { getConfiguredExternalHandles } from '@/lib/bluesky';
export function useRecommendedFeed(enabled:boolean) {
  const {user,loading}=useAuth();
  const handles=getConfiguredExternalHandles();
  useRecommendationImpressions(enabled && !loading,user?.id ?? null);
  return useInfiniteQuery({
    queryKey:['feed','recommended','scoring-v3',user?.id ?? null,handles],
    initialPageParam:createRecommendationCursor(handles),
    queryFn:({pageParam,signal})=>getRecommendationPage(pageParam,user?.id ?? null,signal),
    getNextPageParam:page=>page.next,
    enabled:enabled && !loading,
    staleTime:0,
  });
}
