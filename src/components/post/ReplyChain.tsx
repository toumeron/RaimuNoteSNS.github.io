import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

type Segment = { x: number; top: number; bottom: number; dashed?: boolean };

export function ReplyChain({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    let active = true;
    const measure = () => {
      if (!active) return;
      const origin = host.getBoundingClientRect();
      const avatars = [...host.querySelectorAll<HTMLElement>('[data-lime-thread-avatar]')].map(el => ({
        rect: el.getBoundingClientRect(),
        owner: el.closest<HTMLElement>('[data-lime-conversation-comment]'),
      }));
      const next: Segment[] = [];
      const add = (avatar: DOMRect, top: number, bottom: number, dashed = false) => {
        if (bottom > top) next.push({ x: avatar.left + avatar.width / 2 - origin.left, top: top - origin.top, bottom: bottom - origin.top, dashed });
      };
      avatars.forEach(({ rect, owner }, index) => {
        // Only a real child continues this line. Consecutive siblings must not
        // appear to be replies to each other, even when flattened for display.
        const following = avatars[index + 1];
        const connected = following && (!owner || following.owner?.dataset.limeConversationParent === owner.dataset.limeConversationComment);
        if (connected) add(rect, rect.bottom + 8, following.rect.top - 8);
      });
      host.querySelectorAll<HTMLElement>('[data-lime-thread-more]').forEach(more => {
        const parentId = more.dataset.limeThreadMore;
        const parent = avatars.some(avatar => avatar.owner)
          ? avatars.find(avatar => avatar.owner?.dataset.limeConversationComment === parentId)
          : avatars.at(-1);
        if (!parent) return;
        const button = more.getBoundingClientRect();
        const preceding = avatars.filter(avatar => avatar.rect.top < button.top).at(-1);
        // A footer for siblings is not a continuation of the preceding leaf.
        if (preceding === parent && !avatars.some(avatar => avatar.rect.top > button.top && avatar.owner?.dataset.limeConversationParent === parentId)) {
          add(parent.rect, parent.rect.bottom + 8, button.top - 8);
        }
        add(parent.rect, button.top + 8, button.bottom - 8, true);
      });
      setSegments(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const resize = new ResizeObserver(measure);
    resize.observe(host);
    host.querySelectorAll('[data-lime-thread-item]').forEach(el => resize.observe(el));
    const changes = new MutationObserver(measure);
    changes.observe(host, { childList: true, subtree: true, characterData: true });
    host.addEventListener('load', measure, true);
    window.addEventListener('resize', measure);
    document.fonts?.ready.then(measure);
    measure();
    return () => {
      active = false;
      resize.disconnect(); changes.disconnect();
      host.removeEventListener('load', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, []);
  return (
    <div ref={ref} data-lime-reply-chain className="relative">
      <style>{`
        [data-lime-reply-chain] [data-lime-thread-item] {
          padding: 12px 0 !important;
          margin: 0 !important;
          border: 0 !important;
          border-radius: 0 !important;
          box-shadow: none !important;
          background: transparent !important;
          max-width: none !important;
        }
      `}</style>
      {children}
      <svg aria-hidden="true" data-lime-thread-lines className="pointer-events-none absolute inset-0 z-[1] h-full w-full" style={{ overflow: 'visible' }}>
        {segments.map((segment, i) => <line key={i} x1={segment.x} x2={segment.x} y1={segment.top} y2={segment.bottom} stroke="hsl(var(--border))" strokeWidth="2" strokeDasharray={segment.dashed ? '2 6' : undefined} strokeLinecap="round" />)}
      </svg>
    </div>
  );
}
