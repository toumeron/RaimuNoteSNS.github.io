import { useQuery } from "@tanstack/react-query";
import { getTrendRanking } from "@/api/trends";
import { useCallback, useMemo, useSyncExternalStore, useEffect, useState } from "react";
import { getLatestSearchNews, getNewsStory } from "@/api/search-news";

// useTrends
// Both views observe one snapshot, including refreshes and requests in flight.
function useTrends() {
  return useQuery({
    queryKey: ['trend-ranking'], queryFn: getTrendRanking,
    staleTime: 5 * 60 * 1000, retry: 1,
  });
}

const eventName = 'lime-hidden-trends-changed';
const memory = new Map<string, string>();
function read(key: string): string {
  if (memory.has(key)) return memory.get(key)!;
  try { return localStorage.getItem(key) ?? '[]'; } catch { return '[]'; }
}
function subscribe(callback: () => void) {
  const storageChanged = (event: StorageEvent) => {
    if (event.key === null) memory.clear();
    else if (event.key.startsWith('lime_hidden_trends:')) memory.delete(event.key);
    else return;
    callback();
  };
  window.addEventListener(eventName, callback);
  window.addEventListener('storage', storageChanged);
  return () => {
    window.removeEventListener(eventName, callback);
    window.removeEventListener('storage', storageChanged);
  };
}
function useHiddenTrends(viewerId: string | null) {
  const key = `lime_hidden_trends:${viewerId ?? 'guest'}`;
  const snapshot = useSyncExternalStore(subscribe, useCallback(() => read(key), [key]), () => '[]');
  const hidden = useMemo(() => {
    try {
      const value = JSON.parse(snapshot);
      return new Set<string>(Array.isArray(value) ? value.filter(item => typeof item === 'string') : []);
    } catch { return new Set<string>(); }
  }, [snapshot]);
  const hide = useCallback((title: string) => {
    const value = JSON.stringify([...new Set([...hidden, title])].slice(-200));
    memory.set(key, value);
    try { localStorage.setItem(key, value); } catch { /* Keep both views synchronized without storage. */ }
    window.dispatchEvent(new Event(eventName));
  }, [key, hidden]);
  return [hidden, hide] as const;
}

// useSearchNews
function useSearchNews(viewerId:string|null) {
  return useQuery({
    queryKey:['search-news',viewerId],
    queryFn:getLatestSearchNews,
    staleTime:60000,
    gcTime:300000,
    refetchOnWindowFocus:false,
  });
}

function useNewsStory(storyId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['news-story', storyId],
    enabled,
    queryFn: () => getNewsStory(storyId),
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });
}

// useSearchExploreTab
const SEARCH_EXPLORE_TABS = [
  {value: 'explore', label: '話題を検索'},
  {value: 'trends', label: 'トレンド'},
  {value: 'sports', label: 'スポーツ'},
  {value: 'entertainment', label: 'エンターテインメント'},
] as const;
type SearchExploreTab = typeof SEARCH_EXPLORE_TABS[number]['value'];
const useSearchExploreTabEventName = 'lime-search-explore-tab-changed';
const storageKey = 'lime_search_explore_tab';
function readTab(): SearchExploreTab {
  let stored: string | null = null;
  try { stored = localStorage.getItem(storageKey); } catch { /* Storage can be unavailable in private browsing. */ }
  return SEARCH_EXPLORE_TABS.find(tab => tab.value === stored)?.value ?? 'explore';
}
function useSearchExploreTab() {
  const [tab, setTab] = useState<SearchExploreTab>(readTab);
  useEffect(() => {
    const update = (event: Event) => { const value = (event as CustomEvent<SearchExploreTab>).detail; setTab(SEARCH_EXPLORE_TABS.some(tab => tab.value === value) ? value : readTab()); };
    window.addEventListener(useSearchExploreTabEventName, update);
    return () => window.removeEventListener(useSearchExploreTabEventName, update);
  }, []);
  const changeTab = useCallback((value: SearchExploreTab) => {
    try { localStorage.setItem(storageKey, value); } catch { /* Keep tabs usable without storage. */ }
    setTab(value);
    window.dispatchEvent(new CustomEvent(useSearchExploreTabEventName, {detail: value}));
  }, []);
  return [tab, changeTab] as const;
}

export { useTrends };
export { useHiddenTrends };
export { useSearchNews };
export { useNewsStory };
export { useSearchExploreTab };
export { SEARCH_EXPLORE_TABS };
export type { SearchExploreTab };
