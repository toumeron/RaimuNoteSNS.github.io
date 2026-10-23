import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { PostWithAuthor } from '@/types';
const MOBILE_BREAKPOINT_QUERY = '(max-width: 767px)';

const useIsMobileViewport = () => {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const mql = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
    const handleChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);

    setIsMobile(mql.matches);

    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handleChange);
      return () => mql.removeEventListener('change', handleChange);
    }

    // Safari 13 等の古い実装向けフォールバック
    mql.addListener(handleChange);
    return () => mql.removeListener(handleChange);
  }, []);

  return isMobile;
};

export const PostComposerFrame = ({ isOpen, onClose, initialQuotedPost, children }: { isOpen: boolean; onClose: () => void; initialQuotedPost?: PostWithAuthor; children: (fullScreen: boolean) => ReactNode }) => {
  const isMobile = useIsMobileViewport();
  const mobileFrame = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;

    const html = document.documentElement;
    const body = document.body;

    const previous = {
      htmlOverflow: html.style.overflow,
      htmlOverscrollBehavior: html.style.overscrollBehavior,
      bodyOverflow: body.style.overflow,
      bodyOverscrollBehavior: body.style.overscrollBehavior,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyWidth: body.style.width,
    };

    const lockedScrollY = window.scrollY;

    if (isMobile) {
      // iOS Safari / モバイルChromeでは body の overflow:hidden だけでは
      // 背面ページのスクロールが残る場合があるため、ページ自体を固定する。
      // スクロール位置を保持して閉じた後に元の位置へ正確に戻す。
      html.style.overflow = 'hidden';
      html.style.overscrollBehavior = 'none';
      body.style.overflow = 'hidden';
      body.style.overscrollBehavior = 'none';
      body.style.position = 'fixed';
      body.style.top = `-${lockedScrollY}px`;
      body.style.left = '0';
      body.style.right = '0';
      body.style.width = '100%';
    } else {
      // デスクトップの既存モーダル挙動はそのまま維持する。
      body.style.overflow = 'hidden';
    }

    return () => {
      html.style.overflow = previous.htmlOverflow;
      html.style.overscrollBehavior = previous.htmlOverscrollBehavior;
      body.style.overflow = previous.bodyOverflow;
      body.style.overscrollBehavior = previous.bodyOverscrollBehavior;
      body.style.position = previous.bodyPosition;
      body.style.top = previous.bodyTop;
      body.style.left = previous.bodyLeft;
      body.style.right = previous.bodyRight;
      body.style.width = previous.bodyWidth;

      if (isMobile) {
        window.scrollTo(0, lockedScrollY);
      }
    };
  }, [isOpen, isMobile]);

  useLayoutEffect(() => {
    if (!isOpen || !isMobile) return;
    const viewport = window.visualViewport;
    const update = () => {
      if (!mobileFrame.current) return;
      const height = viewport?.height ?? window.innerHeight;
      mobileFrame.current.style.height = `${height}px`;
      mobileFrame.current.style.maxHeight = `${height}px`;
      mobileFrame.current.style.top = `${viewport?.offsetTop ?? 0}px`;
    };
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [isOpen, isMobile]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('[data-lime-audience-sheet]') && !document.querySelector('[data-limenote-crop-editor-lock]')) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === 'undefined') return null;

  if (isMobile) {
    // モバイルはオーバーレイではなく全画面で表示する
    return createPortal(
      <div ref={mobileFrame} data-lime-mobile-composer role="dialog" aria-modal="true" aria-label={initialQuotedPost ? "引用リポスト" : "新規ポスト"} onClick={event => event.stopPropagation()} className="lime-mobile-composer fixed inset-0 z-[2147483000] flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden overscroll-none bg-background">
        {children(true)}
      </div>,
      document.body
    );
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={initialQuotedPost ? "引用リポスト" : "新規ポスト"} onClick={event => event.stopPropagation()} className="fixed inset-0 z-[2147483000] flex items-start justify-center bg-black/20 p-4 pt-16 sm:items-center sm:pt-4 overflow-y-auto">
      <div
        className="fixed inset-0"
        onClick={onClose}
      />
      <div className="relative w-full max-w-xl animate-in fade-in zoom-in-95 duration-200">
        {children(false)}
      </div>
    </div>,
    document.body
  );
};

