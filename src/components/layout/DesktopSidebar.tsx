import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { TrendSection, type TrendItem } from '@/components/search/TrendSection';

export function DesktopTimelineSidebar() {
  const navigate = useNavigate();
  const { data = [], isLoading } = useQuery({
    queryKey: ['desktop-timeline-trends'],
    queryFn: async (): Promise<TrendItem[]> => {
      const { data, error } = await supabase.functions.invoke('get-trends', { method: 'POST', body: {} });
      if (error) throw error;
      return Array.isArray(data) ? data.filter((item): item is TrendItem => typeof item?.title === 'string').slice(0, 6) : [];
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  return (
    <aside className="lime-desktop-discover" aria-label="トレンド">
      <TrendSection items={data} loading={isLoading} onSelect={title => navigate(`/search?q=${encodeURIComponent(title)}`)} />
    </aside>
  );
}
