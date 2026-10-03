import { useQuery } from '@tanstack/react-query';
import { getTrendRanking } from '@/api/trends';

// Both views observe one snapshot, including refreshes and requests in flight.
export function useTrends() {
  return useQuery({
    queryKey: ['trend-ranking'], queryFn: getTrendRanking,
    staleTime: 5 * 60 * 1000, retry: 1,
  });
}
