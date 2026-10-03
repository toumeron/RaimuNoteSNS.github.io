import { useNavigate } from 'react-router-dom';
import { useTrends } from '@/hooks/useTrends';
import { useHiddenTrends } from '@/hooks/useHiddenTrends';
import { useAuth } from '@/hooks/useAuth';
import { TrendSection } from '@/components/search/TrendSection';

export function DesktopTimelineSidebar() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data = [], isPending } = useTrends();
  const [hidden] = useHiddenTrends(user?.id ?? null);
  const visible = data.filter(item => !hidden.has(item.title)).slice(0, 6);
  return (
    <aside className="lime-desktop-discover" aria-label="トレンド">
      <TrendSection items={visible} loading={isPending} onSelect={title => navigate(`/search?q=${encodeURIComponent(title)}`)} />
    </aside>
  );
}
