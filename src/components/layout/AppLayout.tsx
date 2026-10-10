import React, { useEffect, useState } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { useAuth } from '@/hooks/useAuth';
import { CallSessionProvider } from '@/components/chat/CallSessionProvider';
import { DesktopTimelineSidebar } from './DesktopSidebar';
import './desktop-layout.css';
import { DesktopLayoutContext } from './DesktopLayoutContext';
import { PageCompanion } from '@/components/ai/PageCompanion';
import { Skeleton } from '@/components/ui/skeleton';
import { isIpad } from '@/lib/utils';

export function AppLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [mapSidebarClosed, setMapSidebarClosed] = useState(false);
  useEffect(() => {
    const toggle = (event: Event) => setMapSidebarClosed((event as CustomEvent<boolean>).detail === true);
    window.addEventListener('lime-maps-sidebar-toggle', toggle);
    return () => window.removeEventListener('lime-maps-sidebar-toggle', toggle);
  }, []);
  useEffect(() => setMapSidebarClosed(false), [location.pathname]);
  const [desktopSidebarContainer, setDesktopSidebarContainer] = useState<HTMLDivElement | null>(null);
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 640px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 640px)');
    const update = () => setIsDesktop(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  // ルーティング（パス）が変更されるたびに、強制的にページトップへスクロールする
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const isDirectMessagesPage = location.pathname === '/messages' || location.pathname.startsWith('/messages/');
  const isAccountAboutPage = /^\/u\/[^/]+\/about$/.test(location.pathname);
  const isPostActivityPage = /^\/post\/[^/]+\/activity$/.test(location.pathname);
  const isPostDetailPage = /^\/post\/[^/]+$/.test(location.pathname);
  // 大文字小文字を区別せず /limepro または /LimePro にマッチさせる判定
  const isLimeProPage = /^\/limepro$/i.test(location.pathname);

  if (loading) {
    return (
      <div className="min-h-screen p-8">
        <Skeleton className="h-16 w-48" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" state={{ from: location }} replace />;

  // ページのパスに応じてメインコンテナのクラス名を切り替える
  let mainClassName = 'mx-auto max-w-2xl px-4 py-6';
  if (location.pathname === '/maps' || location.pathname === '/notifications' || location.pathname === '/topics' || location.pathname === '/settings' || location.pathname.startsWith('/news')) mainClassName = 'w-full max-w-none px-0 py-0';
  if (/^\/u\/[^/]+$/.test(location.pathname)) mainClassName = 'mx-auto max-w-2xl px-4 py-6 max-sm:pt-0';
  if (/^\/u\/[^/]+\/followers_following\/?$/.test(location.pathname)) mainClassName = 'mx-auto max-w-2xl px-0 py-0';
  if (isPostActivityPage) mainClassName = 'mx-auto max-w-2xl px-0 py-0';
  if (isAccountAboutPage) mainClassName = 'mx-auto max-w-2xl px-0 py-0';
  
  if (isLimeProPage) {
    // LimeProページの場合は最大幅制限を解除し、パディングもゼロにする（フルスクリーン対応）
    mainClassName = 'w-full max-w-none px-0 py-0';
  } else if (location.pathname === '/bookmarks' || location.pathname === '/search') {
    mainClassName = 'mx-auto max-w-2xl px-0 py-0';
  } else if (isPostDetailPage) {
    mainClassName = 'mx-auto max-w-2xl px-4 pb-6 pt-0';
  }

  if (isDirectMessagesPage) mainClassName = 'w-full max-w-none p-0';

  if (isDesktop) {
    const isWorkspacePage = isDirectMessagesPage || location.pathname === '/chat' || location.pathname.startsWith('/media');
    const hideHeader = isDirectMessagesPage || location.pathname === '/maps' || (location.pathname.startsWith('/u/') && !isAccountAboutPage) || ['/search', '/settings', '/chat', '/bookmarks'].includes(location.pathname) || location.pathname.startsWith('/media') || isPostDetailPage;
    const showRightSidebar = !isDirectMessagesPage && !['/chat', '/settings', '/maps'].includes(location.pathname);
    const isEdgePage = isPostActivityPage || location.pathname === '/maps' || location.pathname.startsWith('/news') || location.pathname === '/settings' || location.pathname === '/notifications' || location.pathname === '/topics' || isWorkspacePage || location.pathname === '/bookmarks' || location.pathname === '/' || location.pathname.startsWith('/u/') || isPostDetailPage;
    return (
      <CallSessionProvider>
        {!isDirectMessagesPage && <PageCompanion userId={user.id} />}
        <DesktopLayoutContext.Provider value={true}>
        <div className="lime-app-shell" data-lime-page={location.pathname}
          data-lime-map-sidebar-collapsed={location.pathname === '/maps' && mapSidebarClosed && !isIpad() || undefined}
          data-lime-ipad={isIpad() || undefined}
          data-lime-workspace={isDirectMessagesPage || location.pathname === '/chat' || undefined}
          data-lime-direct-workspace={isDirectMessagesPage || undefined}
          data-lime-hide-header={hideHeader || undefined}
          data-lime-edge={isEdgePage || undefined}
          data-lime-timeline={location.pathname === '/' || undefined}>
          <div className="lime-desktop-menu" ref={setDesktopSidebarContainer} />
          <div className="lime-desktop-column">
            <Header desktopLayout desktopSidebarContainer={desktopSidebarContainer} />
            <main className="lime-desktop-main"><Outlet /></main>
          </div>
          {showRightSidebar && <DesktopTimelineSidebar />}
        </div>
        </DesktopLayoutContext.Provider>
      </CallSessionProvider>
    );
  }

  return (
    // LimeProページの場合はボトムナビゲーション用の余白(pb-20)を削除する
    <CallSessionProvider>
        {!isDirectMessagesPage && <PageCompanion userId={user.id} />}
      <div className={`min-h-screen ${isDirectMessagesPage || isLimeProPage || location.pathname === '/maps' ? 'pb-0' : location.pathname === '/topics' ? 'pb-[var(--lime-bottom-nav-height,64px)] md:pb-0' : 'pb-20 md:pb-0'}`}>
      
        {/* LimeProページ以外でのみヘッダーを表示する */}
        {!isLimeProPage && location.pathname !== '/bookmarks' && <Header />}
      
        <main className={mainClassName}>
          <Outlet />
        </main>
      
        {/* LimeProページ以外でのみボトムナビゲーションを表示する */}
        {!isLimeProPage && <BottomNav />}
      
      </div>
    </CallSessionProvider>
  );
}
