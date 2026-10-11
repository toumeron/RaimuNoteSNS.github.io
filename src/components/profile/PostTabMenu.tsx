import { ChevronRight } from 'lucide-react';
import { cloneElement, useRef, useState, type ReactElement } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
export type PostTabFilter = 'all' | 'posts';
export type PostTabSort = 'latest' | 'popular';
export function postTabMenuOffsets(button: { left: number; bottom: number }, label: { left: number; top: number }, viewport: { width: number; height: number }) {
  const left = Math.max(12, Math.min(label.left - 24, viewport.width - 156));
  const top = Math.max(12, Math.min(label.top, viewport.height - 174));
  return { alignOffset: left - button.left, sideOffset: top - button.bottom };
}
export function PostTabMenu({ children, filter, sort, onFilterChange, onSortChange }: {
  children: ReactElement; filter: PostTabFilter; sort: PostTabSort;
  onFilterChange: (filter: PostTabFilter) => void; onSortChange: (sort: PostTabSort) => void;
}) {
  const [open, setOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const [offsets, setOffsets] = useState({ alignOffset: 0, sideOffset: 0 });
  const changeOpen = (value: boolean) => {
    if (value && anchor.current) {
      const button = anchor.current.getBoundingClientRect();
      const label = anchor.current.querySelector('[data-lime-tab-label]')?.getBoundingClientRect() ?? { left: button.left + 28, top: button.top + button.height / 2 - 8 };
      setOffsets(postTabMenuOffsets(button, label, { width: window.innerWidth, height: window.innerHeight }));
    }
    setOpen(value);
    if (!value) setSortOpen(false);
  };
  const ios = typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  if (ios) return <span className={`relative flex h-full flex-1 items-stretch ${children.props.className?.includes('min-w-max') ? 'min-w-max shrink-0' : 'min-w-0'}`}>
    {cloneElement(children, { className: `${children.props.className ?? ''} w-full h-full` })}
    <select aria-label="ポストの表示" value={filter}
      className="absolute inset-0 z-10 h-full w-full cursor-pointer text-base opacity-0"
      onChange={event => onFilterChange(event.target.value as PostTabFilter)}>
      <option value="all">すべて</option>
      <option value="posts">ポスト</option>
    </select>
  </span>;
  return <DropdownMenu open={open} onOpenChange={changeOpen}>
    <DropdownMenuTrigger asChild>{cloneElement(children, { ref: anchor, 'data-lime-post-tab-menu-anchor': '', 'data-state': 'active', 'aria-haspopup': 'menu', 'aria-expanded': open, onPointerDown: (event: React.PointerEvent) => { event.preventDefault(); }, onClick: () => changeOpen(!open) })}</DropdownMenuTrigger>
    <DropdownMenuContent align="start" side="bottom" {...offsets} avoidCollisions={false}
      className="relative overflow-visible w-[144px] rounded-[12px] border-0 bg-popover p-0 shadow-[0_1px_14px_rgba(0,0,0,0.18)]"
      onEscapeKeyDown={event => { if (sortOpen) { event.preventDefault(); setSortOpen(false); } }}>
      <DropdownMenuItem className="min-h-10 justify-between rounded-none px-[14px] py-2.5 text-sm font-bold first:rounded-t-[12px]" disabled={sortOpen} onSelect={() => { if (!sortOpen) onFilterChange('all'); }}>すべて{filter === 'all' && <span className="text-primary" aria-label="選択中">✓</span>}</DropdownMenuItem>
      <DropdownMenuItem className="min-h-10 justify-between rounded-none px-[14px] py-2.5 text-sm font-bold" disabled={sortOpen} onSelect={() => { if (!sortOpen) onFilterChange('posts'); }}>ポスト{filter === 'posts' && <span className="text-primary" aria-label="選択中">✓</span>}</DropdownMenuItem>
      <DropdownMenuSeparator className="m-0 bg-border/60" />
      <DropdownMenuItem disabled={sortOpen} aria-expanded={sortOpen} aria-haspopup="menu" className="min-h-10 justify-between rounded-none rounded-b-[12px] px-[14px] py-2.5 text-sm font-bold"
        onSelect={event => { event.preventDefault(); setSortOpen(value => !value); }}>並び替え<ChevronRight className="h-5 w-5" aria-hidden="true" /></DropdownMenuItem>
      {sortOpen && <div role="group" aria-label="並び替え" ref={element => { (element?.firstElementChild as HTMLElement | null)?.focus(); }} className="absolute -left-[5px] top-[calc(100%-41px)] z-10 w-[156px] overflow-hidden rounded-[12px] bg-popover shadow-[0_1px_14px_rgba(0,0,0,0.18)]">
        <DropdownMenuItem className="min-h-10 justify-between rounded-none px-[14px] py-2.5 text-sm font-bold" onSelect={() => onSortChange('latest')}>新しい順{sort === 'latest' && <span className="text-primary" aria-label="選択中">✓</span>}</DropdownMenuItem>
        <DropdownMenuItem className="min-h-10 justify-between rounded-none px-[14px] py-2.5 text-sm font-bold" onSelect={() => onSortChange('popular')}>人気順{sort === 'popular' && <span className="text-primary" aria-label="選択中">✓</span>}</DropdownMenuItem>
      </div>}
    </DropdownMenuContent>
  </DropdownMenu>;
}
