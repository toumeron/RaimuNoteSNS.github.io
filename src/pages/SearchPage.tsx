import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Search, X, Clock, Loader2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PostCard } from '@/components/feed/PostCard';
import UserCard from '@/components/search/UserCard';
import { supabase } from '@/lib/supabase';
import type { User, PostWithAuthor } from '@/types';
// @ts-ignore - tiny-segmenter has no bundled types
import TinySegmenter from 'tiny-segmenter';

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
  normalize(`${u.displayName} ${u.username} ${u.bio || ''}`);

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

export default function SearchPage() {
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

  const inputRef = useRef<HTMLInputElement>(null);
  const suggestBoxRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const lastElementRef = useRef<HTMLDivElement>(null);

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
      const from = targetPage * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, error } = await supabase
        .from('posts')
        .select(`id, content, image_urls, created_at, user_id, likes_count, reposts_count`)
        .ilike('content', `%${q}%`)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;

      if (data) {
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
            likedByMe: false,
            repostedByMe: false,
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
    const q = normalize(inputValue.trim());
    if (!q) return [];
    return allUsers
      .map((u) => {
        const dn = normalize(u.displayName);
        const un = normalize(u.username);
        let score = 0;
        if (dn === q || un === q) score = 100;
        else if (dn.startsWith(q) || un.startsWith(q)) score = 50;
        else if (dn.includes(q) || un.includes(q)) score = 20;
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
      let score = 0;
      let allMatch = true;
      for (const t of queryTokens) {
        if (!hay.includes(t)) { allMatch = false; break; }
        if (dn === t || un === t) score += 5;
        else if (dn.startsWith(t) || un.startsWith(t)) score += 3;
        else score += 1;
      }
      return allMatch ? { u, score } : null;
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.score - a.score)
    .map((x: any) => x.u) as User[];
  }, [searchQuery, queryTokens, allUsers]);

  const suggestionRows = useMemo(() => {
    const rows: { type: 'search' | 'user'; value: string; user?: User }[] = [];
    if (inputValue.trim()) {
      rows.push({ type: 'search', value: inputValue.trim() });
      for (const u of liveSuggestions) rows.push({ type: 'user', value: u.username, user: u });
    } else {
      for (const h of history) rows.push({ type: 'search', value: h });
    }
    return rows;
  }, [inputValue, liveSuggestions, history]);

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
      commitSearch(suggestionRows[activeSuggestIdx].value);
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

  return (
    <div className="min-h-screen bg-transparent text-[rgb(15,20,25)] dark:text-white">
      <div className={`sticky top-0 z-50 transition-all duration-300 w-full h-16 flex items-center ${
        isScrolled 
          ? 'max-sm:bg-[#fbf9f2]/70 dark:max-sm:bg-[#000000]/70 max-sm:backdrop-blur-md border-b border-black/[0.03] dark:border-white/[0.05]' 
          : 'bg-transparent'
      }`}>
        <div className="max-w-3xl mx-auto w-full px-4">
          <form onSubmit={(e) => { e.preventDefault(); commitSearch(inputValue); }} className="relative">
            <div className={`relative flex items-center h-11 rounded-full transition-all ${
              isInputFocused 
                ? 'bg-white dark:bg-black ring-2 ring-[#1d9bf0]' 
                : 'bg-black/5 dark:bg-white/10'
            }`}>
              <Search className={`absolute left-4 w-[18px] h-[18px] ${isInputFocused ? 'text-[#1d9bf0]' : 'text-[rgb(83,100,113)] dark:text-gray-400'}`} />
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
                <button type="button" onClick={() => { setInputValue(''); inputRef.current?.focus(); }} className="absolute right-3 w-5 h-5 flex items-center justify-center bg-[#1d9bf0] rounded-full">
                  <X className="w-3 h-3 text-white" strokeWidth={3} />
                </button>
              )}
            </div>

            {isInputFocused && suggestionRows.length > 0 && (
              <div ref={suggestBoxRef} className="absolute left-0 right-0 mt-2 bg-white/95 dark:bg-[#15202b]/95 backdrop-blur-xl rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.1)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.3)] border border-black/5 dark:border-white/10 overflow-hidden max-h-[420px] overflow-y-auto">
                {!inputValue.trim() && history.length > 0 && (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="font-bold text-[15px]">最近の検索</span>
                    <button type="button" onClick={clearHistory} className="text-[#1d9bf0] text-[13px] hover:underline">すべて消去</button>
                  </div>
                )}
                {suggestionRows.map((row, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); commitSearch(row.value); }}
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
                        {row.user?.avatarUrl ? <img src={row.user.avatarUrl} className="w-10 h-10 rounded-full object-cover" /> : <div className="w-10 h-10 rounded-full bg-black/5 dark:bg-white/10" />}
                        <div className="flex flex-col text-left truncate ml-3">
                          <span className="font-bold text-[15px]">{row.user?.displayName}</span>
                          <span className="text-[13px] text-[rgb(83,100,113)] dark:text-gray-400">@{row.user?.username}</span>
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

      <div className="max-w-3xl mx-auto">
        <Tabs defaultValue="posts" className="w-full">
          <TabsList className="w-full h-[53px] bg-transparent border-b border-black/[0.03] dark:border-white/[0.05] rounded-none p-0 grid grid-cols-2 relative z-20">
            <TabsTrigger value="posts" className="relative h-full bg-transparent text-[15px] font-medium text-[rgb(83,100,113)] dark:text-gray-400 data-[state=active]:text-[rgb(15,20,25)] dark:data-[state=active]:text-white data-[state=active]:font-bold data-[state=active]:bg-transparent data-[state=active]:shadow-none hover:bg-black/[0.03] dark:hover:bg-white/5 transition-colors data-[state=active]:after:content-[''] data-[state=active]:after:absolute data-[state=active]:after:bottom-0 data-[state=active]:after:left-1/2 data-[state=active]:after:-translate-x-1/2 data-[state=active]:after:w-16 data-[state=active]:after:h-1 data-[state=active]:after:rounded-full data-[state=active]:after:bg-[#1d9bf0]">
              ポスト
            </TabsTrigger>
            <TabsTrigger value="users" className="relative h-full bg-transparent text-[15px] font-medium text-[rgb(83,100,113)] dark:text-gray-400 data-[state=active]:text-[rgb(15,20,25)] dark:data-[state=active]:text-white data-[state=active]:font-bold data-[state=active]:bg-transparent data-[state=active]:shadow-none hover:bg-black/[0.03] dark:hover:bg-white/5 transition-colors data-[state=active]:after:content-[''] data-[state=active]:after:absolute data-[state=active]:after:bottom-0 data-[state=active]:after:left-1/2 data-[state=active]:after:-translate-x-1/2 data-[state=active]:after:w-16 data-[state=active]:after:h-1 data-[state=active]:after:rounded-full data-[state=active]:after:bg-[#1d9bf0]">
              アカウント
            </TabsTrigger>
          </TabsList>

          <TabsContent value="posts" className="mt-4 bg-transparent border-none outline-none">
            {!searchQuery ? <EmptyHint title="LimeSearch (ベータ版) " desc="キーワードを入力して、ポストやアカウントを見つけましょう。" /> :
             isPostsLoading && page === 0 ? <div>{Array.from({ length: 5 }).map((_, i) => <RowSkeleton key={i} />)}</div> :
             searchedPosts.length === 0 ? <EmptyHint title={`"${searchQuery}" に一致する結果はありません`} desc="キーワードを変えてみてください。" /> :
             <div className="flex flex-col gap-4">
               {searchedPosts.map((post: PostWithAuthor) => (
                 <div key={post.id} className="rounded-xl overflow-hidden hover:bg-black/[0.01] dark:hover:bg-white/[0.02] transition-colors">
                   <PostCard post={post} />
                 </div>
               ))}
               
               <div ref={lastElementRef} className="h-20 flex items-center justify-center">
                 {hasMore && searchQuery && <Loader2 className="w-6 h-6 text-[#1d9bf0] animate-spin" />}
               </div>
             </div>}
          </TabsContent>

          <TabsContent value="users" className="mt-4 bg-transparent border-none outline-none">
            {!searchQuery ? <EmptyHint title="アカウントを探す" desc="名前または @ユーザー名 で検索できます。" /> :
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
    <div className="px-8 py-16 text-center max-w-[450px] mx-auto bg-transparent">
      <h2 className="text-[31px] leading-tight font-extrabold text-[rgb(15,20,25)] dark:text-white mb-2">{title}</h2>
      <p className="text-[15px] text-[rgb(83,100,113)] dark:text-gray-400">{desc}</p>
    </div>
  );
}