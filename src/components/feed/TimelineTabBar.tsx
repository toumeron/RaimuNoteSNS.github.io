import { setSavedList } from "@/api/users";
import { useInvalidateLists, useListCatalog } from "@/hooks/useTopics";
import { toast } from "sonner";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Plus, X, GripHorizontal, ArrowLeft, ArrowRight, Hash, ChevronDown, TrendingUp, Landmark, Volleyball, BriefcaseBusiness, Atom, Cpu, Brain, Palette, Pencil, Film, Gamepad2, Bitcoin, Plane, Tv, Utensils, GraduationCap, Cat, Music, Paintbrush, Shirt, Smile, HeartPulse } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/button";
import { TOPICS, isTopicId, type TopicId } from "@/lib/topics";

// timelineTabs
type FeedTabValue = 'all'|'following'|'trending'|`topic:${TopicId}`|`list:${string}`;
const TIMELINE_TABS: {value:FeedTabValue;label:string}[] = [
  {value:'all',label:'最新'},{value:'following',label:'フォロー中'},{value:'trending',label:'トレンド'},
];
const TOPIC_TIMELINE_TABS = TOPICS.map(topic=>({value:`topic:${topic.id}` as FeedTabValue,label:topic.name}));
const AVAILABLE_TIMELINE_TABS=[...TIMELINE_TABS,...TOPIC_TIMELINE_TABS];
function feedTabTopic(value:string):TopicId|undefined { const id=value.startsWith('topic:')?value.slice(6):undefined;return isTopicId(id)?id:undefined; }
function isFeedTabValue(value:unknown):value is FeedTabValue {return typeof value==='string'&&(AVAILABLE_TIMELINE_TABS.some(tab=>tab.value===value)||/^list:[0-9a-f-]{36}$/i.test(value));}
const EVENT='lime-timeline-tabs-changed';
const key=(owner?:string)=>`lime_timeline_tabs:${owner??'guest'}:v1`;
function normalizeTimelineTabs(input:unknown):FeedTabValue[] {
  const result=Array.isArray(input)?[...new Set(input.filter((id):id is FeedTabValue=>isFeedTabValue(id)))]:[];
  return result.length?result:TIMELINE_TABS.map(t=>t.value);
}
function saveTimelineTabs(owner:string|undefined, ids:FeedTabValue[]) {
  localStorage.setItem(key(owner),JSON.stringify(normalizeTimelineTabs(ids)));
  window.dispatchEvent(new Event(EVENT));
}
function useAvailableTimelineTabs(owner?:string){const lists=useListCatalog(owner);return [...AVAILABLE_TIMELINE_TABS,...(lists.data??[]).map(list=>({value:`list:${list.id}` as FeedTabValue,label:list.name}))];}
function useTimelineTabs(owner?:string) {
  const available=useAvailableTimelineTabs(owner);
  const raw=useSyncExternalStore(listener=>{
    const storage=(e:StorageEvent)=>{if(e.key===key(owner)||e.key===null)listener();};
    window.addEventListener(EVENT,listener);window.addEventListener('storage',storage);
    return()=>{window.removeEventListener(EVENT,listener);window.removeEventListener('storage',storage);};
  },()=>{try{return localStorage.getItem(key(owner));}catch{return null;}},()=>null);
  let value:unknown;try{value=JSON.parse(raw??'null');}catch{value=null;}
  return normalizeTimelineTabs(value).map(id=>available.find(t=>t.value===id)??{value:id,label:'リスト'});
}

// TimelineTabBar
const topicIcons:Record<string,typeof Hash>={economy:TrendingUp,politics:Landmark,sports:Volleyball,business:BriefcaseBusiness,science:Atom,technology:Cpu,ai:Brain,art:Palette,'digital-illustration':Pencil,film:Film,games:Gamepad2,crypto:Bitcoin,travel:Plane,anime:Tv,food:Utensils,career:GraduationCap,pets:Cat,music:Music,design:Paintbrush,fashion:Shirt,memes:Smile,fitness:HeartPulse};
function TopicIcon({value}:{value:FeedTabValue}) {const Icon=topicIcons[value.slice(6)]??Hash;return <Icon className="h-6 w-6"/>;}

type Tab = typeof TIMELINE_TABS[number];
type Drag = { value: FeedTabValue; startY: number; startIndex: number; height: number; delta: number };
const reorder = (tabs: Tab[], value: FeedTabValue, to: number) => {
  const from = tabs.findIndex(tab => tab.value === value);
  if (from < 0 || to < 0 || to >= tabs.length) return tabs;
  const result = [...tabs];
  result.splice(from, 1);
  result.splice(to, 0, tabs[from]);
  return result;
};

function TimelineTabBar({ tabs, active, owner, onSelect, onDoubleClick, variant = 'mobile' }: {
  tabs: Tab[]; active: FeedTabValue; owner?: string;
  onSelect: (value: FeedTabValue) => void;
  onDoubleClick: (value: FeedTabValue) => void;
  variant?: 'mobile' | 'desktop';
}) {
  const available=useAvailableTimelineTabs(owner);
  const invalidateLists=useInvalidateLists();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [topicsOpen,setTopicsOpen]=useState(true);
  const editor = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Tab[] | null>(null);
  const [dragging, setDragging] = useState<Drag | null>(null);
  const drag = useRef<Drag | null>(null);
  const draftRef = useRef<Tab[] | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const tabContent = useRef<HTMLDivElement>(null);
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false });
  const labels = useRef(new Map<FeedTabValue, HTMLSpanElement>());
  const rows = useRef(new Map<FeedTabValue, HTMLDivElement>());
  const positions = useRef(new Map<FeedTabValue, number>());
  const [underline, setUnderline] = useState({ left: 0, width: 64 });
  const shown = draft ?? tabs;
  const tabOrder = tabs.map(tab => tab.value).join(',');
  const rowOrder = shown.map(tab => tab.value).join(',');

  useLayoutEffect(() => {
    const measure = () => {
      const label = labels.current.get(active);
      const button = label?.parentElement;
      if (label && button) setUnderline({ left: button.offsetLeft + button.offsetWidth / 2, width: label.offsetWidth + 20 });
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (scroller.current) observer?.observe(scroller.current);
    window.addEventListener('resize', measure);
    let cancelled = false;
    document.fonts?.ready.then(() => { if (!cancelled) measure(); });
    return () => { cancelled = true; observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [active, tabOrder]);

  useEffect(() => {
    scroller.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [active, tabOrder]);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => {
      const left = element.scrollLeft > 1;
      const right = element.scrollWidth - element.clientWidth - element.scrollLeft > 1;
      setScrollEdges(previous => previous.left === left && previous.right === right ? previous : { left, right });
    };
    measure();
    element.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    if (tabContent.current) observer?.observe(tabContent.current);
    let cancelled = false;
    document.fonts?.ready.then(() => { if (!cancelled) measure(); });
    return () => {
      cancelled = true;
      observer?.disconnect();
      element.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [tabOrder]);

  useEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;
    const measure = () => {
      editor.current?.style.setProperty('--timeline-editor-height', `${viewport?.height ?? window.innerHeight}px`);
      editor.current?.style.setProperty('--timeline-editor-top', `${viewport?.offsetTop ?? 0}px`);
    };
    measure();
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    const mobile = window.matchMedia('(max-width: 767px)').matches;
    const scrollY = window.scrollY;
    const bodyStyle = { position: document.body.style.position, top: document.body.style.top, width: document.body.style.width, overflow: document.body.style.overflow };
    const htmlOverflow = document.documentElement.style.overflow;
    if (mobile) {
      Object.assign(document.body.style, { position: 'fixed', top: `${-scrollY}px`, width: '100%', overflow: 'hidden' });
      document.documentElement.style.overflow = 'hidden';
    }
    return () => {
      viewport?.removeEventListener('resize', measure);
      viewport?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      if (mobile) {
        Object.assign(document.body.style, bodyStyle);
        document.documentElement.style.overflow = htmlOverflow;
        window.scrollTo(0, scrollY);
      }
    };
  }, [open]);

  const scrollTabs = (direction: number) => {
    const element = scroller.current;
    if (!element) return;
    element.scrollBy({ left: direction * Math.max(80, element.clientWidth * .75), behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };

  // FLIP keeps surrounding rows sliding into their new positions during a drag.
  useLayoutEffect(() => {
    const next = new Map<FeedTabValue, number>();
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    rows.current.forEach((row, value) => {
      const top = row.offsetTop;
      const previous = positions.current.get(value);
      if (previous !== undefined && previous !== top && drag.current?.value !== value && !reduced) {
        row.getAnimations?.().forEach(animation => animation.cancel());
        row.animate?.([{ transform: `translateY(${previous - top}px)` }, { transform: 'translateY(0)' }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
      next.set(value, top);
    });
    positions.current = next;
  }, [rowOrder, open, search, dragging?.value]);

  const save = (next: Tab[]) => saveTimelineTabs(owner, next.map(tab => tab.value));
  const move = (value: FeedTabValue, to: number) => save(reorder(tabs, value, to));
  const toggle = async (value: FeedTabValue) => {
    const ids = tabs.map(tab => tab.value);
    if(value.startsWith('list:')&&!ids.includes(value)){try{await setSavedList(value.slice(5),true);await invalidateLists();}catch{toast.error('リストを追加できませんでした');return;}}
    saveTimelineTabs(owner, ids.includes(value) ? ids.length > 1 ? ids.filter(id => id !== value) : ids : [...ids, value]);
  };
  const matches = (tab: Tab) => tab.label.includes(search.trim());
  const endDrag = (commit: boolean) => {
    const current = drag.current;
    if (!current) return;
    const row = rows.current.get(current.value);
    const transform = row?.style.transform;
    if (commit) save(draftRef.current ?? tabs);
    drag.current = null;
    draftRef.current = null;
    setDragging(null);
    setDraft(null);
    if (transform && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      row?.animate?.([{ transform }, { transform: 'translateY(0)' }], { duration: 180, easing: 'ease-out' });
    }
  };

  return <>
    <div data-lime-timeline-tabs className={variant === 'desktop' ? 'flex w-full max-w-[360px]' : 'mx-auto flex max-w-5xl px-2 sm:px-4'}>
      <div className="group/timeline-scroll relative min-w-0 flex-1">
      <div ref={scroller} role="tablist" aria-label="タイムライン" onKeyDown={event => {
        const index = tabs.findIndex(tab => tab.value === active);
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault(); onSelect(tabs[next].value);
        scroller.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
      }} className={`relative flex h-10 w-full overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${variant === 'desktop' ? 'items-center rounded-2xl bg-muted/50 p-1' : 'items-stretch rounded-none bg-transparent p-0 shadow-none'}`}>
        <div ref={tabContent} className="relative flex min-w-full shrink-0 gap-6 pl-3 sm:gap-2 sm:pl-2" style={{ width: '100%' }}>
          {variant === 'mobile' && <span aria-hidden="true" className="pointer-events-none absolute bottom-0 h-[3px] -translate-x-1/2 rounded-full bg-primary transition-[left,width] duration-300 ease-out" style={underline} />}
          {tabs.map(tab => <button key={tab.value} role="tab" aria-selected={active === tab.value} tabIndex={active === tab.value ? 0 : -1} data-state={active === tab.value ? 'active' : 'inactive'} type="button" onClick={() => onSelect(tab.value)} onDoubleClick={() => onDoubleClick(tab.value)} style={{ flexBasis: `${100 / tabs.length}%`, minWidth: 'max-content' }} className={variant === 'desktop'
            ? 'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-xl px-3 py-1.5 text-sm font-bold text-muted-foreground transition-all data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:shadow-sm data-[state=inactive]:bg-transparent data-[state=inactive]:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            : 'feed-tabs-trigger relative h-10 shrink-0 flex-1 rounded-none border-0 bg-transparent px-0 py-1.5 text-base max-[360px]:text-sm leading-none shadow-none outline-none transition-colors duration-150 hover:bg-transparent focus-visible:ring-0 data-[state=active]:bg-transparent data-[state=active]:shadow-none'}>
            <span ref={element => { if (element) labels.current.set(tab.value, element); else labels.current.delete(tab.value); }} className="whitespace-nowrap">{tab.label}</span>
          </button>)}
        </div>
      </div>
      {scrollEdges.left && <button type="button" aria-label="タブを左にスクロール" className="absolute left-1 top-1/2 z-20 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-foreground/10 text-foreground hover:bg-foreground/20 sm:flex opacity-0 pointer-events-none group-hover/timeline-scroll:opacity-100 group-hover/timeline-scroll:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto transition-opacity" onClick={() => scrollTabs(-1)}><ArrowLeft className="h-5 w-5" /></button>}
      {scrollEdges.right && <button type="button" aria-label="タブを右にスクロール" className="absolute right-1 top-1/2 z-20 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-foreground/10 text-foreground hover:bg-foreground/20 sm:flex opacity-0 pointer-events-none group-hover/timeline-scroll:opacity-100 group-hover/timeline-scroll:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto transition-opacity" onClick={() => scrollTabs(1)}><ArrowRight className="h-5 w-5" /></button>}
      </div>
      <button type="button" aria-label="タイムラインのタブをカスタマイズ" className="flex w-10 shrink-0 items-center justify-center text-muted-foreground hover:bg-muted/40" onClick={() => { setOpen(true); setSearch(''); }}><Plus className="h-5 w-5" /></button>
    </div>
    <Dialog open={open} onOpenChange={value => { endDrag(false); setOpen(value); }}><DialogContent ref={element => {
      editor.current = element;
      if (element) {
        element.style.setProperty('--timeline-editor-height', `${window.visualViewport?.height ?? window.innerHeight}px`);
        element.style.setProperty('--timeline-editor-top', `${window.visualViewport?.offsetTop ?? 0}px`);
      }
    }} onOpenAutoFocus={event => { event.preventDefault(); editor.current?.focus(); }} overlayClassName="z-[550] bg-black/20 max-md:bg-background" className="timeline-tab-editor z-[600] flex flex-col gap-0 overflow-hidden overscroll-none border-0 shadow-none outline-none ring-0 bg-background p-5 md:max-h-[85dvh] md:w-[calc(100%_-_48px)] md:max-w-xl md:rounded-3xl md:p-7 max-md:inset-0 max-md:h-[var(--timeline-editor-height,100dvh)] max-md:top-[var(--timeline-editor-top,0px)] max-md:bottom-auto max-md:max-h-none max-md:w-full max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:pt-[calc(env(safe-area-inset-top)+20px)] max-md:pb-[calc(env(safe-area-inset-bottom)+20px)] max-md:data-[state=open]:animate-none max-md:data-[state=closed]:animate-none">
      <DialogTitle className="text-center text-xl font-bold">タイムライン</DialogTitle>
      <DialogDescription className="sr-only">表示するタイムラインのタブと並び順を編集します。</DialogDescription>
      <input aria-label="タブを検索" placeholder="検索" value={search} onChange={event => setSearch(event.target.value)} className="mt-6 h-12 shrink-0 w-full rounded-2xl bg-muted px-4 border-0 outline-none focus:ring-0" />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain"><div className="mb-4 mt-10 flex items-center justify-between"><h3 className="font-bold">表示中</h3></div>
      <div className="relative">{shown.filter(matches).map(tab => <div key={tab.value} ref={element => { if (element) rows.current.set(tab.value, element); else rows.current.delete(tab.value); }} data-timeline-tab-item={tab.value} data-dragging={dragging?.value === tab.value || undefined} style={dragging?.value === tab.value ? { transform: `translateY(${dragging.delta + (dragging.startIndex - shown.filter(matches).findIndex(item => item.value === tab.value)) * dragging.height}px) scale(1.02)` } : undefined} className={`relative flex h-24 items-center gap-3 rounded-2xl px-3 transition-shadow ${dragging?.value === tab.value ? 'z-10 bg-muted shadow-lg' : ''}`}>
        <span className="min-w-0 flex-1 font-bold">{tab.label}</span>
        {tab.value.startsWith('topic:')&&<button type="button" aria-label={`${tab.label}を外す`} className="p-2 text-muted-foreground" onClick={()=>void toggle(tab.value)}><X className="h-5 w-5"/></button>}
        <button type="button" aria-label={`${tab.label}をドラッグして並べ替え`} className="touch-none p-2 text-muted-foreground" onKeyDown={event => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault(); move(tab.value, tabs.findIndex(item => item.value === tab.value) + (event.key === 'ArrowUp' ? -1 : 1));
        }} onPointerDown={event => {
          event.preventDefault();
          const row = rows.current.get(tab.value);
          const current = { value: tab.value, startY: event.clientY, startIndex: tabs.filter(matches).findIndex(item => item.value === tab.value), height: row?.getBoundingClientRect().height || 96, delta: 0 };
          drag.current = current; draftRef.current = tabs; setDraft(tabs); setDragging(current);
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer events still commit on release. */ }
        }} onPointerMove={event => {
          if (!drag.current) return;
          const current = { ...drag.current, delta: event.clientY - drag.current.startY };
          drag.current = current; setDragging(current);
          const visible = tabs.filter(matches);
          const to = Math.max(0, Math.min(visible.length - 1, Math.floor((current.startIndex * current.height + current.height / 2 + current.delta) / current.height)));
          const next = reorder(tabs, current.value, tabs.findIndex(item => item.value === visible[to].value));
          draftRef.current = next; setDraft(next);
        }} onPointerUp={event => {
          if (drag.current) {
            const current = drag.current;
            const delta = event.clientY - current.startY;
            if (Number.isFinite(delta) && Math.abs(delta) > current.height / 2) {
              const visible = tabs.filter(matches);
              const to = Math.max(0, Math.min(visible.length - 1, Math.floor((current.startIndex * current.height + current.height / 2 + delta) / current.height)));
              draftRef.current = reorder(tabs, current.value, tabs.findIndex(item => item.value === visible[to].value));
            }
          }
          endDrag(true);
        }} onPointerCancel={() => endDrag(false)} onLostPointerCapture={() => endDrag(true)}><GripHorizontal className="h-5 w-5" /></button>
      </div>)}</div>
      {TIMELINE_TABS.some(tab => !tabs.some(item => item.value === tab.value) && matches(tab)) && <><h3 className="mt-6 font-bold">追加できるタブ</h3>{TIMELINE_TABS.filter(tab => !tabs.some(item => item.value === tab.value) && matches(tab)).map(tab => <button key={tab.value} type="button" className="flex min-h-16 items-center justify-between text-left font-bold" onClick={() => toggle(tab.value)}>{tab.label}<Plus className="h-5 w-5" /></button>)}</>}
      <button type="button" aria-expanded={topicsOpen} className="mt-8 flex w-full items-center justify-between font-bold" onClick={()=>setTopicsOpen(value=>!value)}>トピック<ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform ${topicsOpen?'':'-rotate-90'}`}/></button>
      {(topicsOpen||!!search.trim())&&TOPIC_TIMELINE_TABS.filter(tab=>!tabs.some(item=>item.value===tab.value)&&matches(tab)).map(tab=><button key={tab.value} type="button" aria-label={`${tab.label}を追加`} className="flex h-24 w-full items-center gap-4 text-left font-bold" onClick={()=>toggle(tab.value)}><span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-muted"><TopicIcon value={tab.value}/></span><span className="min-w-0 flex-1">{tab.label}</span><span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground"><Plus className="h-4 w-4"/></span></button>)}
      {available.some(tab=>tab.value.startsWith('list:')&&!tabs.some(item=>item.value===tab.value)&&matches(tab))&&<><h3 className="mt-8 font-bold">リスト</h3>{available.filter(tab=>tab.value.startsWith('list:')&&!tabs.some(item=>item.value===tab.value)&&matches(tab)).map(tab=><button key={tab.value} type="button" aria-label={`${tab.label}を追加`} className="flex min-h-20 w-full items-center justify-between text-left font-bold" onClick={()=>toggle(tab.value)}>{tab.label}<Plus className="h-5 w-5"/></button>)}</>}
      {!available.some(matches) && <p className="py-5 text-center text-sm text-muted-foreground">一致するタブがありません。</p>}
      </div>
      <style>{`.timeline-tab-editor > .neutral-dismiss { top: calc(env(safe-area-inset-top) + 20px); right: 20px; } @media (min-width:768px) { .timeline-tab-editor > .neutral-dismiss { top: 20px; } }`}</style>
    </DialogContent></Dialog>
  </>;
}

export { TimelineTabBar };
export { feedTabTopic };
export { isFeedTabValue };
export { normalizeTimelineTabs };
export { saveTimelineTabs };
export { useAvailableTimelineTabs };
export { useTimelineTabs };
export type { FeedTabValue };
export { TIMELINE_TABS };
export { TOPIC_TIMELINE_TABS };
export { AVAILABLE_TIMELINE_TABS };
