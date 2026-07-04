import React, { useEffect } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { useAuth } from '@/hooks/useAuth';
import { Skeleton } from '@/components/ui/skeleton';

export function AppLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();

  // ルーティング（パス）が変更されるたびに、強制的にページトップへスクロールする
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

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
  
  if (isLimeProPage) {
    // LimeProページの場合は最大幅制限を解除し、パディングもゼロにする（フルスクリーン対応）
    mainClassName = 'w-full max-w-none px-0 py-0';
  } else if (isPostDetailPage) {
    mainClassName = 'mx-auto max-w-2xl px-4 pb-6 pt-0';
  }

  return (
    // LimeProページの場合はボトムナビゲーション用の余白(pb-20)を削除する
    <div className={`min-h-screen ${isLimeProPage ? 'pb-0' : 'pb-20 md:pb-0'}`}>
      
      {/* LimeProページ以外でのみヘッダーを表示する */}
      {!isLimeProPage && <Header />}
      
      <main className={mainClassName}>
        <Outlet />
      </main>
      
      {/* LimeProページ以外でのみボトムナビゲーションを表示する */}
      {!isLimeProPage && <BottomNav />}
      
    </div>
  );
}