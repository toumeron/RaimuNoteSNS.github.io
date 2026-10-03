import { useCallback, useEffect, useState } from 'react';

export const SEARCH_EXPLORE_TABS = [
  {value: 'explore', label: '話題を検索'},
  {value: 'trends', label: 'トレンド'},
  {value: 'sports', label: 'スポーツ'},
  {value: 'entertainment', label: 'エンターテインメント'},
] as const;
export type SearchExploreTab = typeof SEARCH_EXPLORE_TABS[number]['value'];
const eventName = 'lime-search-explore-tab-changed';
const storageKey = 'lime_search_explore_tab';
function readTab(): SearchExploreTab {
  let stored: string | null = null;
  try { stored = localStorage.getItem(storageKey); } catch { /* Storage can be unavailable in private browsing. */ }
  return SEARCH_EXPLORE_TABS.find(tab => tab.value === stored)?.value ?? 'explore';
}
export function useSearchExploreTab() {
  const [tab, setTab] = useState<SearchExploreTab>(readTab);
  useEffect(() => {
    const update = (event: Event) => { const value = (event as CustomEvent<SearchExploreTab>).detail; setTab(SEARCH_EXPLORE_TABS.some(tab => tab.value === value) ? value : readTab()); };
    window.addEventListener(eventName, update);
    return () => window.removeEventListener(eventName, update);
  }, []);
  const changeTab = useCallback((value: SearchExploreTab) => {
    try { localStorage.setItem(storageKey, value); } catch { /* Keep tabs usable without storage. */ }
    setTab(value);
    window.dispatchEvent(new CustomEvent(eventName, {detail: value}));
  }, []);
  return [tab, changeTab] as const;
}
