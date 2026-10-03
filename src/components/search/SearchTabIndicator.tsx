import { useLayoutEffect, useRef, useState } from 'react';
import './search-tabs.css';

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
