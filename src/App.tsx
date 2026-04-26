import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
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
import NotFound from "./pages/NotFound"; // .tsx は不要なので削除して安定させます

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { 
      // 30秒(1000 * 30)から、1時間(1000 * 60 * 60)に変更して、
      // 勝手にバックグラウンドで再取得させないようにします。
      staleTime: 1000 * 60 * 60, 
      
      // 画面に戻った時に更新されるのを確実に防ぎます
      refetchOnWindowFocus: false, 
      
      // ネットワークが不安定なときのために、3回はリトライするようにします
      retry: 3,
      
      // ネットワークが切断されている間は再試行を待機します
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      {/* basename を追加することで、URLのズレを解消します */}
      <BrowserRouter 
        basename="/RaimuNoteSNS.github.io"
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<AuthPage />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<Feed />} />
              <Route path="/post/:id" element={<PostDetail />} />
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
