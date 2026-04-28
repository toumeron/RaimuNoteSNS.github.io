import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import AuthPage from "./pages/Auth";
import Feed from "./pages/Feed";
import PostDetail from "./pages/PostDetail";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import SearchPage from "./pages/SearchPage";
import PostActivity from "./pages/PostActivity"; // 1. PostActivityをインポート
import NotFound from "./pages/NotFound";

const ScrollToTop = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { 
      staleTime: 1000 * 60 * 60, 
      refetchOnWindowFocus: false, 
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter 
        basename="/RaimuNoteSNS.github.io"
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <ScrollToTop />
        
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<AuthPage />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<Feed />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/post/:id" element={<PostDetail />} />
              {/* 2. ポストアクティビティ（いいね一覧）のルートを追加 */}
              <Route path="/post/:postId/activity" element={<PostActivity />} />
              <Route path="/u/:username" element={<Profile />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            <Route path="/index" element={<Navigate to="/" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;