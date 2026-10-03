import { SEARCH_EXPLORE_TABS, useSearchExploreTab } from '@/hooks/useSearchExploreTab';
import { SearchTabIndicator } from './SearchTabIndicator';

export function SearchExploreTabs() {
  const [active, change] = useSearchExploreTab();
  return <div data-lime-search-explore-tabs role="tablist" aria-label="話題を検索" className="relative flex w-full overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    {SEARCH_EXPLORE_TABS.map(tab => <button key={tab.value} type="button" role="tab" aria-selected={active === tab.value} aria-controls="search-explore-content" onClick={() => change(tab.value)} className={`relative flex h-12 flex-1 shrink-0 items-center justify-center whitespace-nowrap px-3 text-sm transition-colors hover:bg-muted/40 ${active === tab.value ? 'font-bold text-foreground' : 'font-medium text-muted-foreground'}`}>
      <span data-lime-tab-label className="relative flex h-full items-center">{tab.label}</span>
    </button>)}
    <SearchTabIndicator active={active} />
  </div>;
}
