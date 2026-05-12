import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { useAuth } from '@/hooks/useAuth';
import { Skeleton } from '@/components/ui/skeleton';

export function AppLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen p-8">
        <Skeleton className="h-16 w-48" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" state={{ from: location }} replace />;

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <Header />
      <main className="mx-auto max-w-2xl px-4 py-6">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}