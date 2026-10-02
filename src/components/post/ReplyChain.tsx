import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

type Segment = { x: number; top: number; bottom: number };

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
      const avatars = [...host.querySelectorAll<HTMLElement>('[data-lime-thread-avatar]')].map(el => el.getBoundingClientRect());
      const next = avatars.slice(0, -1).map((avatar, index) => ({
        x: avatar.left + avatar.width / 2 - origin.left,
        top: avatar.bottom + 8 - origin.top,
        bottom: avatars[index + 1].top - 8 - origin.top,
      })).filter(segment => segment.bottom > segment.top);
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
      {children}
      <svg aria-hidden="true" data-lime-thread-lines className="pointer-events-none absolute inset-0 z-[1] h-full w-full" style={{ overflow: 'visible' }}>
        {segments.map((segment, i) => <line key={i} x1={segment.x} x2={segment.x} y1={segment.top} y2={segment.bottom} stroke="hsl(var(--border))" strokeWidth="2" strokeLinecap="round" />)}
      </svg>
    </div>
  );
}
