import { supabase } from '@/lib/supabase';
import { trendSearchVolume } from '@/lib/trend-categories';
import type { ExploreTrend } from '@/lib/search-trends';

export async function getTrendRanking(): Promise<ExploreTrend[]> {
  const { data, error } = await supabase.functions.invoke('get-trends', {
    method: 'POST', body: { explore: true },
  });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('トレンドの取得に失敗しました');
  const seen = new Set<string>();
  return data.filter((item): item is ExploreTrend => {
    if (typeof item?.title !== 'string' || typeof item?.traffic !== 'string' || seen.has(item.title)) return false;
    seen.add(item.title);
    return true;
  }).sort((a, b) => trendSearchVolume(b.traffic) - trendSearchVolume(a.traffic))
    .map((item, index) => ({...item, rank: index + 1}));
}
