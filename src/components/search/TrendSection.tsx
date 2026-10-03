import { Loader2, TrendingUp } from 'lucide-react';

export type TrendItem = { title: string; traffic: string; rank?: number };

// Shared existing search UI, also used in the desktop timeline sidebar.
export function TrendSection({ items, loading, onSelect }: {
  items: TrendItem[];
  loading: boolean;
  onSelect: (title: string) => void;
}) {
  return (
<div className="px-4">
        <div className="bg-black/[0.02] dark:bg-white/[0.03] rounded-2xl border border-black/[0.03] dark:border-white/[0.05] overflow-hidden">
          <div className="px-4 py-3 border-b border-black/[0.03] dark:border-white/[0.05] flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            <h2 className="font-extrabold text-xl">トレンド</h2>
          </div>

          {loading ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="flex flex-col">
              {items.length > 0 ? (
                items.map((trend, idx) => (
                  <button
                    key={idx}
                    data-lime-sidebar-trend-title={trend.title}
                    data-lime-trend-rank={trend.rank ?? idx + 1}
                    onClick={() => onSelect(trend.title)}
                    className="px-4 py-3 text-left hover:bg-black/[0.03] dark:hover:bg-white/[0.05] transition-colors border-b last:border-none border-black/[0.03] dark:border-white/[0.05] flex flex-col gap-0.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] text-[rgb(83,100,113)] dark:text-gray-400">{trend.rank ?? idx + 1} · トレンド</span>
                    </div>
                    <div className="font-bold text-[15px]">{trend.title}</div>
                  </button>
                ))
              ) : (
                <div className="px-4 py-8 text-center text-[rgb(83,100,113)] dark:text-gray-400 text-[14px]">
                  現在、トレンドを取得できません
                </div>
              )}
            </div>
          )}
        </div>
      </div>
  );
}
