import { CommunityAudienceImage } from '@/components/communities/CommunityAudienceImage';
import { useRef, useState, type ReactNode, type ReactElement, type CSSProperties, type PointerEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check } from 'lucide-react';
import { useIsMobile } from '@/hooks/useViewportWidth';
import { ComposerIcon, type ComposerIconKind } from './PostPoll';
import { CommunityIcon } from '@/components/communities/CommunityIcon';
import type { Community } from '@/api/communities';

type Visibility = 'public' | 'following' | 'members';
type Props = {
  children: ReactNode;
  trigger: ReactElement;
  visibility: Visibility;
  communityId?: string;
  communities: Community[];
  quotedCommunityId?: string;
  canPostMembersOnly?: boolean;
  disabled: boolean;
  onSelect: (visibility: Visibility, communityId?: string) => void;
};

/** Mobile uses the same audiences and payloads as desktop, in a bottom sheet. */
export function PostAudiencePicker({children, trigger, visibility, communityId, communities, quotedCommunityId, canPostMembersOnly, disabled, onSelect}: Props) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const drag = useRef({active:false, start:0, moved:false, pointer:0});
  const [dragOffset, setDragOffset] = useState(0);
  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    drag.current = {active:true, start:event.clientY, moved:false, pointer:event.pointerId};
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current.active || event.pointerId !== drag.current.pointer) return;
    const distance = Math.max(0, event.clientY - drag.current.start);
    if (distance > 5) drag.current.moved = true;
    setDragOffset(distance);
  };
  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current.active || event.pointerId !== drag.current.pointer) return;
    drag.current.active = false;
    if (event.clientY - drag.current.start >= 72) setOpen(false);
    else setDragOffset(0);
  };
  if (!mobile) return children;
  const choose = (value: Visibility, id?: string) => { onSelect(value, id); setOpen(false); };
  const row = 'flex w-full items-center gap-3 bg-transparent px-5 py-3 text-left disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-[-2px]';
  const marker = <Check aria-hidden="true" className="ml-auto h-4 w-4 shrink-0 text-primary"/>;
  return <Dialog.Root open={open} onOpenChange={value => {if (value) {setDragOffset(0);drag.current.moved=false;}setOpen(value);}}>
    <Dialog.Trigger asChild disabled={disabled}>{trigger}</Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="lime-audience-shade fixed inset-0 z-[2147483646] bg-black/45"/>
      <Dialog.Content data-lime-audience-sheet aria-describedby={undefined} onOpenAutoFocus={e => {e.preventDefault();heading.current?.focus();}} className="lime-audience-sheet fixed inset-x-0 bottom-0 z-[2147483647] flex max-h-[85dvh] flex-col overflow-hidden rounded-t-[28px] bg-background text-foreground shadow-xl outline-none" style={{paddingBottom: 'max(12px, env(safe-area-inset-bottom))', '--lime-audience-drag': `${dragOffset}px`} as CSSProperties}>
        <button type="button" data-lime-no-dismiss-feedback aria-label="公開範囲の選択を閉じる" className="mx-auto flex h-7 w-20 shrink-0 touch-none items-center justify-center bg-transparent" style={{WebkitTapHighlightColor:'transparent'}} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => {drag.current.active=false;drag.current.moved=true;setDragOffset(0);}} onClick={() => {if (!drag.current.moved) setOpen(false);drag.current.moved=false;}}>
          <span aria-hidden="true" className="h-1 w-9 rounded-full bg-muted-foreground/20"/>
        </button>
        <Dialog.Title ref={heading} tabIndex={-1} className="shrink-0 px-5 pb-5 pt-1 text-center text-lg font-bold outline-none">オーディエンスを選択</Dialog.Title>
        <div className="min-h-0 overflow-y-auto overscroll-contain pb-3">
          {([{value:'public',label:'全員',kind:'globe'},{value:'following',label:'フォロー中',kind:'users'},...(canPostMembersOnly?[{value:'members',label:'メンバー限定',kind:'members'}]:[])] as const).map(option => <button key={option.value} type="button" className={row} disabled={!!quotedCommunityId} aria-pressed={!communityId && visibility === option.value} onClick={() => choose(option.value as Visibility)}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
              {option.value === 'public' ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m5 6 4 1 1 3-2 2-3-1m5-8 3 3-1 3 3 1 1 3-3 2-1 5m7-14-3 3 2 3 3 1M7 14l3 1 1 3-2 2"/></svg> : <ComposerIcon kind={option.kind as ComposerIconKind} className="h-[18px] w-[18px]"/>}
            </span>
            <span className="min-w-0 text-sm">{option.label}</span>
            {!communityId && visibility === option.value && marker}
          </button>)}
          {!!communities.length && <><h3 className="px-5 pb-2 pt-5 text-sm font-bold">コミュニティ</h3>{communities.map(c => <button key={c.id} type="button" disabled={!!quotedCommunityId && quotedCommunityId !== c.id} className={row} aria-pressed={communityId === c.id} onClick={() => choose('public', c.id)}>
            <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted text-muted-foreground">{c.cover_url ? <CommunityAudienceImage src={c.cover_url}/> : <CommunityIcon className="h-[18px] w-[18px]"/>}</span>
            <span className="min-w-0"><span className="block break-words text-sm">{c.name}</span><span className="block text-sm text-muted-foreground">{c.member_count}人のメンバー</span></span>
            {communityId === c.id && marker}
          </button>)}</>}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
