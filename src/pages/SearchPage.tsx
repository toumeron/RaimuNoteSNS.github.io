import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Search, X, Clock, Loader2, TrendingUp, Newspaper } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PostCard } from '@/components/feed/PostCard';
import UserCard from '@/components/search/UserCard';
import { supabase } from '@/lib/supabase';
import type { User, PostWithAuthor } from '@/types';
// @ts-ignore - tiny-segmenter has no bundled types
import TinySegmenter from 'tiny-segmenter';
import { useSearchParams, useNavigate } from 'react-router-dom';

const segmenter = new TinySegmenter();

const kataToHira = (s: string) =>
  s.replace(/[\u30a1-\u30f6]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0x60)
  );

const normalize = (s: string) => {
  if (!s) return '';
  let n = s.normalize('NFKC').toLowerCase();
  n = kataToHira(n);
  return n;
};

const tokenizeQuery = (q: string): string[] => {
  const norm = normalize(q);
  if (!norm.trim()) return [];
  return norm.split(/[\s\u3000]+/).filter(Boolean);
};

const buildUserHaystack = (u: User): string =>
  normalize(`${u.displayName} ${u.username} @${u.username} ${u.bio || ''}`);

const HISTORY_KEY = 'search:recent';
const HISTORY_MAX = 8;

const loadHistory = (): string[] => {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, HISTORY_MAX) : [];
  } catch { return []; }
};
const saveHistory = (list: string[]) => {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
  } catch { /* noop */ }
};

const RowSkeleton = () => (
  <div className="flex gap-3 px-4 py-3 border-b border-black/[0.03] dark:border-white/[0.05] animate-pulse bg-transparent">
    <div className="w-10 h-10 rounded-full bg-black/5 dark:bg-white/10 shrink-0" />
    <div className="flex-1 space-y-2 pt-1">
      <div className="h-3 w-1/3 bg-black/5 dark:bg-white/10 rounded" />
      <div className="h-3 w-5/6 bg-black/5 dark:bg-white/10 rounded" />
    </div>
  </div>
);

// トレンドアイテムの型定義
type TrendItem = {
  title: string;
  traffic: string;
};

// ニュースアイテムの型定義
type NewsItem = {
  id: string;
  title: string;
  content: string;
  category: string;
  created_at: string;
};

type SuggestionRow =
  | { type: 'search'; value: string }
  | { type: 'user'; value: string; user: User };

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [searchedPosts, setSearchedPosts] = useState<PostWithAuthor[]>([]);
  const [isUsersLoading, setIsUsersLoading] = useState(false);
  const [isPostsLoading, setIsPostsLoading] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const [activeSuggestIdx, setActiveSuggestIdx] = useState<number>(-1);
  const [isScrolled, setIsScrolled] = useState(false);
  
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  // トレンド用ステート
  const [trends, setTrends] = useState<TrendItem[]>([]);
  const [isTrendsLoading, setIsTrendsLoading] = useState(false);

  // ニュース用ステート
  const [latestNews, setLatestNews] = useState<NewsItem | null>(null);
  const [isNewsLoading, setIsNewsLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const suggestBoxRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const lastElementRef = useRef<HTMLDivElement>(null);

  // ニュース取得用Effect
  useEffect(() => {
    async function fetchLatestNews() {
      setIsNewsLoading(true);
      try {
        const { data, error } = await supabase
          .from('news_summaries')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (error && error.code !== 'PGRST116') throw error; // PGRST116はデータなしエラー
        if (data) setLatestNews(data);
      } catch (err) {
        console.error('Failed to fetch news:', err);
      } finally {
        setIsNewsLoading(false);
      }
    }
    fetchLatestNews();
  }, []);

  // トレンド取得用Effect
  useEffect(() => {
    async function fetchTrends() {
      setIsTrendsLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke('get-trends', {
          method: 'POST',
          body: {}, 
        });

        if (error) throw error;

        if (Array.isArray(data)) {
          setTrends(data);
        } else if (data && data.error) {
          console.error('Function returned error:', data.error);
          setTrends([]);
        }
      } catch (err) {
        console.error('Failed to fetch trends:', err);
        setTrends([]);
      } finally {
        setIsTrendsLoading(false);
      }
    }
    fetchTrends();
  }, []);

  // Realtime同期用のEffect
  useEffect(() => {
    if (!searchQuery) return;

    const channel = supabase
      .channel('search_likes_sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'likes' },
        () => {
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [searchQuery]);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 90);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchUsers() {
      setIsUsersLoading(true);
      try {
        const { data, error } = await supabase.from('profiles').select('*');
        if (error) throw error;
        if (cancelled) return;
        setAllUsers((data || []).map((u: any) => ({
          id: u.id,
          username: u.username,
          displayName: u.display_name || u.displayName || 'User',
          avatarUrl: u.avatar_url || u.avatarUrl || '',
          coverUrl: u.cover_url || '',
          createdAt: u.created_at || '',
          bio: u.bio || '',
          isOfficial: !!(u.is_official || u.isOfficial),
        })));
      } catch (err) { console.error(err); }
      finally { if (!cancelled) setIsUsersLoading(false); }
    }
    fetchUsers();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (suggestBoxRef.current && !suggestBoxRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setIsInputFocused(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const fetchPosts = useCallback(async (q: string, targetPage: number) => {
    if (!q.trim()) return;
    if (targetPage === 0) setIsPostsLoading(true);

    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const from = targetPage * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let conditions = ['visibility.eq.public'];
      if (currentUser) {
        conditions.push(`user_id.eq.${currentUser.id}`);

        const { data: followedByData } = await supabase
          .from('follows')
          .select('follower_id')
          .eq('followee_id', currentUser.id);
        
        const authorsWhoFollowMe = followedByData?.map(f => f.follower_id) || [];
        if (authorsWhoFollowMe.length > 0) {
          conditions.push(`user_id.in.(${authorsWhoFollowMe.join(',')})`);
        }
      }

      const { data, error } = await supabase
        .from('posts')
        .select(`id, content, image_urls, created_at, user_id, likes_count, reposts_count, visibility`)
        .ilike('content', `%${q}%`)
        .or(conditions.join(','))
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;

      if (data) {
        let myLikes: string[] = [];
        if (currentUser) {
          const { data: likesData } = await supabase
            .from('likes')
            .select('post_id')
            .eq('user_id', currentUser.id)
            .in('post_id', data.map(p => p.id));
          if (likesData) myLikes = likesData.map(l => l.post_id);
        }

        let myReposts: string[] = [];
        if (currentUser) {
          const { data: repostsData } = await supabase
            .from('reposts')
            .select('post_id')
            .eq('user_id', currentUser.id)
            .in('post_id', data.map(p => p.id));
          if (repostsData) myReposts = repostsData.map(r => r.post_id);
        }

        const formatted: PostWithAuthor[] = data.map((p: any) => {
          const user = allUsers.find(u => u.id === p.user_id);
          return {
            id: p.id,
            userId: p.user_id,
            authorId: p.user_id,
            content: p.content,
            imageUrl: p.image_urls?.[0] || null,
            imageUrls: p.image_urls || [],
            createdAt: p.created_at,
            likesCount: p.likes_count || 0,
            repostsCount: p.reposts_count || 0,
            commentsCount: 0,
            likedByMe: myLikes.includes(p.id),
            repostedByMe: myReposts.includes(p.id),
            visibility: p.visibility,
            author: {
              id: user?.id || p.user_id,
              username: user?.username || 'unknown',
              displayName: user?.displayName || 'User',
              avatarUrl: user?.avatarUrl || '',
              coverUrl: user?.coverUrl || '',
              createdAt: user?.createdAt || p.created_at,
              bio: user?.bio || '',
              isOfficial: user?.isOfficial || false
            }
          };
        });

        if (targetPage === 0) {
          setSearchedPosts(formatted);
        } else {
          setSearchedPosts(prev => [...prev, ...formatted]);
        }
        
        setHasMore(data.length === PAGE_SIZE);
      }
    } catch (err) {
      console.error('Search query failed:', err);
    } finally {
      setIsPostsLoading(false);
    }
  }, [allUsers]);

  const commitSearch = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (!q) return;

    setInputValue(q);
    setSearchQuery(q);
    setIsInputFocused(false);
    setActiveSuggestIdx(-1);
    setPage(0);
    setHasMore(true);

    setHistory((prev) => {
      const next = [q, ...prev.filter((h) => h !== q)].slice(0, HISTORY_MAX);
      saveHistory(next);
      return next;
    });

    await fetchPosts(q, 0);
    inputRef.current?.blur();
  }, [fetchPosts]);

  useEffect(() => {
    const queryParam = searchParams.get('q');
    if (queryParam) {
      commitSearch(queryParam);
    }
  }, [searchParams, commitSearch]);

  useEffect(() => {
    if (isPostsLoading) return;
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && searchQuery) {
        const nextPage = page + 1;
        setPage(nextPage);
        fetchPosts(searchQuery, nextPage);
      }
    });

    if (lastElementRef.current) {
      observerRef.current.observe(lastElementRef.current);
    }

    return () => observerRef.current?.disconnect();
  }, [isPostsLoading, hasMore, page, searchQuery, fetchPosts]);

  const liveSuggestions = useMemo(() => {
    const raw = inputValue.trim();
    const normalizedRaw = normalize(raw);
    const queryCandidates = Array.from(
      new Set([normalizedRaw, normalizedRaw.replace(/^@+/, '')].filter(Boolean))
    );

    if (queryCandidates.length === 0) return [];

    return allUsers
      .map((u) => {
        const dn = normalize(u.displayName);
        const un = normalize(u.username);
        const handle = normalize(`@${u.username}`);
        const fields = [dn, un, handle];
        let score = 0;

        if (queryCandidates.some((q) => fields.includes(q))) score = 100;
        else if (queryCandidates.some((q) => fields.some((field) => field.startsWith(q)))) score = 50;
        else if (queryCandidates.some((q) => fields.some((field) => field.includes(q)))) score = 20;

        return { user: u, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((x) => x.user);
  }, [inputValue, allUsers]);

  const queryTokens = useMemo(() => tokenizeQuery(searchQuery), [searchQuery]);

  const filteredUsers = useMemo(() => {
    if (!searchQuery || queryTokens.length === 0) return [];

    return allUsers.map((u) => {
      const hay = buildUserHaystack(u);
      const dn = normalize(u.displayName);
      const un = normalize(u.username);
      const handle = normalize(`@${u.username}`);
      let score = 0;
      let allMatch = true;
      for (const t of queryTokens) {
        const tokenCandidates = Array.from(new Set([t, t.replace(/^@+/, '')].filter(Boolean)));
        if (!tokenCandidates.some((token) => hay.includes(token))) { allMatch = false; break; }
        if (tokenCandidates.some((token) => dn === token || un === token || handle === token)) score += 5;
        else if (tokenCandidates.some((token) => dn.startsWith(token) || un.startsWith(token) || handle.startsWith(token))) score += 3;
        else score += 1;
      }
      return allMatch ? { u, score } : null;
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.score - a.score)
    .map((x: any) => x.u) as User[];
  }, [searchQuery, queryTokens, allUsers]);

  const suggestionRows = useMemo<SuggestionRow[]>(() => {
    const rows: SuggestionRow[] = [];
    if (inputValue.trim()) {
      rows.push({ type: 'search', value: inputValue.trim() });
      for (const u of liveSuggestions) rows.push({ type: 'user', value: u.username, user: u });
    } else {
      for (const h of history) rows.push({ type: 'search', value: h });
    }
    return rows;
  }, [inputValue, liveSuggestions, history]);

  const handleSuggestionSelect = useCallback((row: SuggestionRow) => {
    if (row.type === 'user') {
      setIsInputFocused(false);
      setActiveSuggestIdx(-1);
      inputRef.current?.blur();
      navigate(`/u/${row.user.username}`);
      return;
    }

    commitSearch(row.value);
  }, [commitSearch, navigate]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isInputFocused) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestIdx((i) => Math.min(suggestionRows.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestIdx((i) => Math.max(-1, i - 1));
    } else if (e.key === 'Enter' && activeSuggestIdx >= 0) {
      e.preventDefault();
      handleSuggestionSelect(suggestionRows[activeSuggestIdx]);
    }
  };

  const removeHistoryItem = (item: string) => {
    setHistory((prev) => {
      const next = prev.filter((h) => h !== item);
      saveHistory(next);
      return next;
    });
  };

  const clearHistory = () => {
    setHistory([]);
    saveHistory([]);
  };

  const renderSearchHomeSections = () => (
    <div className="flex flex-col gap-6">
      {/* 最新ニュースセクション */}
      <div className="px-4">
        <div className="bg-primary/10 dark:bg-primary/5 rounded-2xl border border-primary/20 dark:border-primary/10 overflow-hidden">
          <div className="px-4 py-3 border-b border-primary/20 dark:border-primary/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Newspaper className="w-5 h-5 text-primary" />
              <h2 className="font-extrabold text-xl">ニュース</h2>
            </div>
            {latestNews && (
               <button 
                 onClick={() => navigate('/news')}
                 className="text-[11px] font-bold bg-primary text-white px-2 py-0.5 rounded-full uppercase hover:opacity-80 transition-opacity"
               >
                 NEW
               </button>
            )}
          </div>
          
          {isNewsLoading ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : latestNews ? (
            <div 
              className="p-4 flex flex-col gap-2 cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
              onClick={() => navigate('/news')}
            >
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-bold text-primary px-2 py-0.5 bg-primary/10 rounded-md">
                  {latestNews.category}
                </span>
                <span className="text-[12px] text-[rgb(83,100,113)] dark:text-gray-400">
                  {new Date(latestNews.created_at).toLocaleDateString()}
                </span>
              </div>
              <h3 className="font-bold text-[17px] leading-tight hover:underline">
                {latestNews.title}
              </h3>
              <p className="text-[14px] text-[rgb(83,100,113)] dark:text-gray-300 leading-normal line-clamp-3">
                {latestNews.content}
              </p>
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-[rgb(83,100,113)] dark:text-gray-400 text-[14px]">
              現在、表示できるニュースはありません
            </div>
          )}
        </div>
      </div>

      {/* トレンドセクション */}
      <div className="px-4">
        <div className="bg-black/[0.02] dark:bg-white/[0.03] rounded-2xl border border-black/[0.03] dark:border-white/[0.05] overflow-hidden">
          <div className="px-4 py-3 border-b border-black/[0.03] dark:border-white/[0.05] flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            <h2 className="font-extrabold text-xl">トレンド</h2>
          </div>
          
          {isTrendsLoading ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="flex flex-col">
              {trends.length > 0 ? (
                trends.map((trend, idx) => (
                  <button
                    key={idx}
                    onClick={() => commitSearch(trend.title)}
                    className="px-4 py-3 text-left hover:bg-black/[0.03] dark:hover:bg-white/[0.05] transition-colors border-b last:border-none border-black/[0.03] dark:border-white/[0.05] flex flex-col gap-0.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] text-[rgb(83,100,113)] dark:text-gray-400">{idx + 1} · トレンド</span>
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
    </div>
  );

  return (
    <div className="min-h-screen bg-transparent text-[rgb(15,20,25)] dark:text-white">
      <div
        className={`sticky top-0 z-50 transition-all duration-300 w-full h-16 flex items-center ${
          isScrolled 
            ? 'max-sm:bg-[#fbf9f2]/70 dark:max-sm:bg-[#000000]/70 max-sm:backdrop-blur-md border-b border-black/[0.03] dark:border-white/[0.05]' 
            : 'bg-transparent'
        }`}
        style={{ position: 'sticky', top: 0 }}
      >
        <div className="max-w-3xl mx-auto w-full px-4">
          <form onSubmit={(e) => { e.preventDefault(); commitSearch(inputValue); }} className="relative">
            <div className={`relative flex items-center h-11 rounded-full transition-all ${
              isInputFocused 
                ? 'bg-white dark:bg-black ring-2 ring-primary' 
                : 'bg-black/5 dark:bg-white/10'
            }`}>
              <Search className={`absolute left-4 w-[18px] h-[18px] ${isInputFocused ? 'text-primary' : 'text-[rgb(83,100,113)] dark:text-gray-400'}`} />
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => { setInputValue(e.target.value); setActiveSuggestIdx(-1); }}
                onFocus={() => setIsInputFocused(true)}
                onKeyDown={onKeyDown}
                placeholder="検索"
                className="w-full h-full bg-transparent border-none pl-11 pr-11 text-[15px] outline-none dark:placeholder-gray-500"
              />
              {inputValue && (
                <button type="button" onClick={() => { setInputValue(''); inputRef.current?.focus(); }} className="absolute right-3 w-5 h-5 flex items-center justify-center bg-primary rounded-full">
                  <X className="w-3 h-3 text-white" strokeWidth={3} />
                </button>
              )}
            </div>

            {isInputFocused && suggestionRows.length > 0 && (
              <div ref={suggestBoxRef} className="absolute left-0 right-0 mt-2 bg-white/95 dark:bg-[#15202b]/95 backdrop-blur-xl rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.1)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.3)] border border-black/5 dark:border-white/10 overflow-hidden max-h-[420px] overflow-y-auto">
                {!inputValue.trim() && history.length > 0 && (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="font-bold text-[15px]">最近の検索</span>
                    <button type="button" onClick={clearHistory} className="text-primary text-[13px] hover:underline">すべて消去</button>
                  </div>
                )}
                {suggestionRows.map((row, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); handleSuggestionSelect(row); }}
                    className={`w-full flex items-center gap-3 px-4 py-3 transition-colors ${
                      idx === activeSuggestIdx 
                        ? 'bg-black/5 dark:bg-white/10' 
                        : 'hover:bg-black/[0.03] dark:hover:bg-white/5'
                    }`}
                  >
                    {row.type === 'search' ? (
                      <>
                        {!inputValue.trim() 
                          ? <Clock className="w-[18px] h-[18px] text-[rgb(83,100,113)] dark:text-gray-400" /> 
                          : <Search className="w-[18px] h-[18px] text-[rgb(83,100,113)] dark:text-gray-400" />
                        }
                        <span className="flex-1 text-[15px] truncate text-left ml-3">{row.value}</span>
                        {!inputValue.trim() && (
                          <span role="button" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); removeHistoryItem(row.value); }} className="p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/20">
                            <X className="w-4 h-4 text-[rgb(83,100,113)] dark:text-gray-400" />
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        {row.user.avatarUrl ? (
                          <img
                            src={row.user.avatarUrl}
                            alt={row.user.displayName}
                            className="w-10 h-10 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-black/5 dark:bg-white/10" />
                        )}
                        <div className="min-w-0 flex flex-col text-left">
                          <span className="flex min-w-0 items-center gap-1">
                            <span className="truncate font-bold text-[15px]">{row.user.displayName}</span>
                            {row.user.isOfficial && (
                              <img
                                src={`${import.meta.env.BASE_URL}verified.png`}
                                alt="Official"
                                className="h-4 w-4 shrink-0 translate-y-[0.5px]"
                                loading="eager"
                              />
                            )}
                          </span>
                          <span className="truncate text-[13px] text-[rgb(83,100,113)] dark:text-gray-400">@{row.user.username}</span>
                        </div>
                      </>
                    )}
                  </button>
                ))}
              </div>
            )}
          </form>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 max-sm:relative max-sm:left-1/2 max-sm:w-screen max-sm:max-w-none max-sm:-translate-x-1/2">
        <Tabs defaultValue="posts" className="w-full">
          <TabsList className="w-full h-[53px] bg-transparent border-b border-black/[0.03] dark:border-white/[0.05] rounded-none p-0 grid grid-cols-2 relative z-20">
            <TabsTrigger value="posts" className="relative h-full bg-transparent text-[15px] font-medium text-[rgb(83,100,113)] dark:text-gray-400 data-[state=active]:text-[rgb(15,20,25)] dark:data-[state=active]:text-white data-[state=active]:font-bold data-[state=active]:bg-transparent data-[state=active]:shadow-none hover:bg-black/[0.03] dark:hover:bg-white/5 transition-colors data-[state=active]:after:content-[''] data-[state=active]:after:absolute data-[state=active]:after:bottom-0 data-[state=active]:after:left-1/2 data-[state=active]:after:-translate-x-1/2 data-[state=active]:after:w-16 data-[state=active]:after:h-1 data-[state=active]:after:rounded-full data-[state=active]:after:bg-primary">
              ポスト
            </TabsTrigger>
            <TabsTrigger value="users" className="relative h-full bg-transparent text-[15px] font-medium text-[rgb(83,100,113)] dark:text-gray-400 data-[state=active]:text-[rgb(15,20,25)] dark:data-[state=active]:text-white data-[state=active]:font-bold data-[state=active]:bg-transparent data-[state=active]:shadow-none hover:bg-black/[0.03] dark:hover:bg-white/5 transition-colors data-[state=active]:after:content-[''] data-[state=active]:after:absolute data-[state=active]:after:bottom-0 data-[state=active]:after:left-1/2 data-[state=active]:after:-translate-x-1/2 data-[state=active]:after:w-16 data-[state=active]:after:h-1 data-[state=active]:after:rounded-full data-[state=active]:after:bg-primary">
              アカウント
            </TabsTrigger>
          </TabsList>

          <TabsContent value="posts" className="mt-4 bg-transparent border-none outline-none">
            {!searchQuery ? renderSearchHomeSections() :
             isPostsLoading && page === 0 ? <div>{Array.from({ length: 5 }).map((_, i) => <RowSkeleton key={i} />)}</div> :
             searchedPosts.length === 0 ? <EmptyHint title={`"${searchQuery}" に一致する結果はありません`} desc="キーワードを変えてみてください。" /> :
             <div className="flex flex-col gap-4 bg-transparent max-sm:gap-0">
               {searchedPosts.map((post: PostWithAuthor) => (
                 <div key={post.id} className="bg-transparent sm:rounded-xl sm:overflow-hidden sm:hover:bg-black/[0.01] sm:dark:hover:bg-white/[0.02] sm:transition-colors">
                   <PostCard post={post} />
                 </div>
               ))}
               
               <div ref={lastElementRef} className="h-20 flex items-center justify-center">
                 {hasMore && searchQuery && <Loader2 className="w-6 h-6 text-primary animate-spin" />}
               </div>
             </div>}
          </TabsContent>

          <TabsContent value="users" className="mt-4 bg-transparent border-none outline-none">
            {!searchQuery ? renderSearchHomeSections() :
             isUsersLoading ? <div>{Array.from({ length: 5 }).map((_, i) => <RowSkeleton key={i} />)}</div> :
             filteredUsers.length === 0 ? <EmptyHint title={`"${searchQuery}" に一致するアカウントはありません`} desc="別のキーワードでお試しください。" /> :
             <div className="flex flex-col gap-2 px-4">
               {filteredUsers.map((user) => (
                 <div key={user.id} className="rounded-xl overflow-hidden hover:bg-black/[0.01] dark:hover:bg-white/[0.02] transition-colors">
                   <UserCard user={user} />
                 </div>
               ))}
             </div>}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function EmptyHint({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="px-8 pt-16 pb-8 text-center max-w-[450px] mx-auto bg-transparent">
      <h2 className="text-[31px] leading-tight font-extrabold text-[rgb(15,20,25)] dark:text-white mb-2">{title}</h2>
      <p className="text-[15px] text-[rgb(83,100,113)] dark:text-gray-400">{desc}</p>
    </div>
  );
}