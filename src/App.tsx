import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth"; 
import { AppLayout } from "@/components/layout/AppLayout";
import { ThemeProvider } from "next-themes"; 
import { useOSNotification } from "@/hooks/useOSNotification"; 
import AuthPage from "./pages/Auth";
import Feed from "./pages/Feed";
import PostDetail from "./pages/PostDetail";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import SearchPage from "./pages/SearchPage";
import PostActivity from "./pages/PostActivity";
import Share from "./pages/Share";
import NotFound from "./pages/NotFound";
import Notifications from "./pages/Notifications";
import FollowersFollowingPage from "./pages/FollowersFollowingPage";

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

// 通知監視用の中間コンポーネント
const NotificationWatcher = () => {
  const { user } = useAuth();
  useOSNotification(user?.id ?? null);
  return null;
};

// --- ここから絵文字エフェクトのロジック ---
const EmojiRainEffect = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<{ id: number; char: string; left: number; duration: number; delay: number; size: number }[]>([]);

  const char = user?.emojiEffect || localStorage.getItem('lime_emoji_pref') || '';

  useEffect(() => {
    if (!char) {
      setItems([]);
      return;
    }
    const newItems = Array.from({ length: 20 }).map((_, i) => ({
      id: i,
      char: char,
      left: Math.random() * 100,
      duration: 5 + Math.random() * 7,
      delay: Math.random() * 10,
      size: 16 + Math.random() * 20,
    }));
    setItems(newItems);
  }, [char]);

  if (!char) return null;

  return (
    <div style={{ pointerEvents: 'none', position: 'fixed', inset: 0, zIndex: 9999, overflow: 'hidden' }}>
      <style>{`
        @keyframes fall-animation {
          0% { transform: translateY(-10vh) rotate(0deg); opacity: 0; }
          10% { opacity: 0.8; }
          90% { opacity: 0.8; }
          100% { transform: translateY(110vh) rotate(360deg); opacity: 0; }
        }
      `}</style>
      {items.map((item) => (
        <div
          key={item.id}
          style={{
            position: 'absolute',
            top: '-50px',
            left: `${item.left}%`,
            animation: `fall-animation ${item.duration}s linear infinite`,
            animationDelay: `${item.delay}s`,
            fontSize: `${item.size}px`,
            userSelect: 'none',
          }}
        >
          {item.char}
        </div>
      ))}
    </div>
  );
};
// --- ここまで ---

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        
        <BrowserRouter 
          basename="/RaimuNoteSNS.github.io"
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <ScrollToTop />
          
          <AuthProvider>
            <NotificationWatcher />
            <EmojiRainEffect /> {/* ファイルを作らずにここで呼び出し */}
            <Routes>
              <Route path="/auth" element={<AuthPage />} />
              <Route element={<AppLayout />}>
                <Route path="/" element={<Feed />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/post/:id" element={<PostDetail />} />
                <Route path="/post/:postId/activity" element={<PostActivity />} />
                <Route path="/u/:username" element={<Profile />} />
                {/* 修正：/u/ を含めたパスを設定 */}
                <Route path="/u/:username/followers_following" element={<FollowersFollowingPage />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/share" element={<Share />} />
              </Route>
              <Route path="/index" element={<Navigate to="/" replace />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;