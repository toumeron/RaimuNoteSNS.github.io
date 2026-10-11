import { SEARCH_EXPLORE_TABS, useSearchExploreTab } from "@/hooks/useSearchExploreTab";
import { useLayoutEffect, useRef, useState } from "react";
import "@/components/search/search-tabs.css";

export function SearchExploreTabs() {
  const [active, change] = useSearchExploreTab();
  return <div data-lime-search-explore-tabs role="tablist" aria-label="話題を検索" className="relative flex w-full overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    {SEARCH_EXPLORE_TABS.map(tab => <button key={tab.value} type="button" role="tab" aria-selected={active === tab.value} aria-controls="search-explore-content" onClick={() => change(tab.value)} className={`relative flex h-12 flex-1 shrink-0 items-center justify-center whitespace-nowrap px-3 text-sm transition-colors hover:bg-muted/40 ${active === tab.value ? 'font-bold text-foreground' : 'font-medium text-muted-foreground'}`}>
      <span data-lime-tab-label className="relative flex h-full items-center">{tab.label}</span>
    </button>)}
    <SearchTabIndicator active={active} />
  </div>;
}

/** One underline follows the selected label instead of remounting on each tab. */
export function SearchTabIndicator({ active }: { active: string }) {
  const marker = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const root = marker.current?.parentElement;
    if (!root) return;
    const measure = () => {
      const tab = root.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      const label = tab?.querySelector<HTMLElement>('[data-lime-tab-label]') || tab;
      if (!label) return;
      const box = label.getBoundingClientRect(), parent = root.getBoundingClientRect();
      if (box.width) setPosition({ left: box.left - parent.left + root.scrollLeft, width: box.width });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    root.querySelectorAll('[data-lime-tab-label]').forEach(label => observer.observe(label));
    document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [active]);
  return <span ref={marker} aria-hidden="true" data-lime-search-tab-indicator className="lime-search-tab-indicator pointer-events-none absolute bottom-0 left-0 h-1 rounded-full bg-primary" style={{ width: position?.width || 0, transform: `translateX(${position?.left || 0}px)` }} />;
}
