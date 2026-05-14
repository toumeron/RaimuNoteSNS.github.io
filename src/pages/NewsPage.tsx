import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatRelative } from '@/lib/format';
import { History, X } from 'lucide-react';
import { PostCard } from '@/components/feed/PostCard'; // PostCardをインポート


export default function NewsPage() {
  const [news, setNews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    async function fetchAllNews() {
      const { data, error } = await supabase
        .from('news_summaries')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (!error) setNews(data || []);
      setLoading(false);
    }
    fetchAllNews();
  }, []);

  if (loading) return <div className="min-h-screen bg-transparent flex items-center justify-center text-gray-500 font-bold">読み込み中...</div>;

  const latest = news[0];
  const historyItems = news.slice(1);

  return (
    <div className="min-h-screen bg-transparent text-black dark:text-white pb-20">
      <div className="max-w-2xl mx-auto p-4 flex flex-col gap-4">
        
        {/* 最新の1件：カード形式 */}
        {latest ? (
          <div className="animate-in fade-in duration-500">
            <div className="p-6 rounded-[32px] bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 mb-4">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-[10px] font-black px-1.5 py-0.5 bg-[#1d9bf0]/20 text-[#1d9bf0] rounded uppercase tracking-tighter">
                  LimeNote
                </span>
                <span className="text-xs text-gray-500 font-medium">
                  {formatRelative(latest.created_at)}
                </span>
              </div>

              <h1 className="text-2xl font-black mb-4 leading-tight text-black dark:text-white">
                {latest.title}
              </h1>

              <div className="text-[16px] leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap mb-6">
                {latest.content}
              </div>

              <p className="text-[12px] leading-snug text-gray-500 dark:text-gray-600 mb-8">
                このストーリーは、LimeNoteのポストの要約であり、時間の経過とともに新しくなります。AIは間違えることがあるため、アウトプットが事実かどうかを確認してください
              </p>

              {/* 関連ポストセクション */}
              {latest.related_posts && (
                <div className="pt-6 border-t border-black/5 dark:border-white/5 flex flex-col gap-4">
                  <h3 className="text-xs font-bold text-gray-500 px-2 uppercase tracking-widest">Related Posts</h3>
                  <div className="flex flex-col gap-3">
                    {/* related_postsがID配列やオブジェクト配列である前提 */}
                    {latest.related_posts.map((post: any) => (
                      <PostCard key={post.id} post={post} />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 小さく配置した履歴ボタン */}
            {!showHistory && news.length > 1 && (
              <div className="flex justify-center">
                <button 
                  onClick={() => setShowHistory(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-full border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 transition-all text-[13px] font-bold text-gray-500"
                >
                  <History className="w-3.5 h-3.5" />
                  履歴を見る
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="py-20 text-center text-gray-500">ニュースがありません。</div>
        )}

        {/* 履歴リスト（展開時） */}
        {showHistory && (
          <div className="mt-2 animate-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center justify-between mb-4 px-2">
              <span className="text-sm font-bold text-gray-500 dark:text-gray-400">過去のニュース</span>
              <button 
                onClick={() => setShowHistory(false)} 
                className="p-1.5 hover:bg-black/10 dark:hover:bg-white/10 rounded-full transition-colors"
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            
            <div className="flex flex-col gap-3">
              {historyItems.map((item) => (
                <div 
                  key={item.id} 
                  className="p-5 rounded-[24px] bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5"
                >
                  <div className="text-[11px] text-gray-500 mb-1">
                    {new Date(item.created_at).toLocaleDateString('ja-JP')}
                  </div>
                  <h3 className="text-md font-bold mb-1 tracking-tight text-black dark:text-white">{item.title}</h3>
                  <p className="text-xs text-gray-600 dark:text-gray-400 leading-normal">
                    {item.content}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}