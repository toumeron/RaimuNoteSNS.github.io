import { useEffect, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import '@/components/post/post-actions.css';

export function PostActionSheet({ open, onOpenChange, title, children, onCloseAutoFocus }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; children: ReactNode;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  useEffect(() => {
    if (!open) return;
    window.dispatchEvent(new CustomEvent('lime-post-action-sheet-open', {detail: true}));
    return () => {window.dispatchEvent(new CustomEvent('lime-post-action-sheet-open', {detail: false}));};
  }, [open]);
  return <Dialog.Root modal={false} open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      {open && <button type="button" aria-label="リポストの操作を閉じる" data-lime-dismiss-backdrop className="lime-post-action-sheet-backdrop" onTouchMove={event => event.preventDefault()} onClick={event => {event.stopPropagation();onOpenChange(false);}} /> }
      <Dialog.Content className="lime-post-action-sheet" aria-describedby={undefined} onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={onCloseAutoFocus} onPointerDownOutside={() => onOpenChange(false)} onClick={event => event.stopPropagation()}>
        <Dialog.Title className="sr-only">{title}</Dialog.Title>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
