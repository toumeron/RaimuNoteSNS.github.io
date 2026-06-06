import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Logo } from './Logo';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';
import {
  LogOut,
  Settings as SettingsIcon,
  User as UserIcon,
  Search,
  Bell,
  MessageSquare,
  Images,
} from 'lucide-react';

export const Header = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const isSearchPage = location.pathname === '/u/LimeBiz';

  const handleLogoClick = () => {
    window.location.href = import.meta.env.BASE_URL;
  };

  const notices = [
    '【お知らせ】いつもLimeNoteをご利用いただきありがとうございます。より快適にサービスをご利用いただけるよう、システムの軽微な調整および表示改善を実施いたしました。これに伴い、一部画面の表示速度や操作感が向上しております。今後も皆さまに安心してご利用いただけるサービス運営に努めてまいります。引き続きLimeNoteをよろしくお願いいたします。',
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-md">
      <style>
        {`
          @keyframes notice-scroll {
            0% {
              transform: translateX(0);
            }
            100% {
              transform: translateX(-50%);
            }
          }

          .notice-scroll {
            animation: notice-scroll 28s linear infinite;
          }

          .notice-scroll:hover {
            animation-play-state: paused;
          }
        `}
      </style>

      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
        <div onClick={handleLogoClick} className="cursor-pointer">
          <Logo />
        </div>

        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded-full ring-2 ring-transparent transition hover:ring-primary/40 outline-none">
                <Avatar className="h-10 w-10 border-2 border-primary/30">
                  <AvatarImage src={user.avatarUrl} alt={user.displayName} />
                  <AvatarFallback>{user.displayName?.slice(0, 1)}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              align="end"
              className="z-[60] w-56 rounded-xl border-border/60 bg-popover text-popover-foreground shadow-xl"
            >
              <DropdownMenuItem
                onClick={() => navigate('/search')}
                className="dark:focus:text-black"
              >
                <Search className="mr-2 h-4 w-4" /> 検索
              </DropdownMenuItem>

              <DropdownMenuItem
                onClick={() => navigate('/notifications')}
                className="dark:focus:text-black"
              >
                <Bell className="mr-2 h-4 w-4" /> 通知
              </DropdownMenuItem>

              <DropdownMenuItem
                onClick={() => navigate('/chat')}
                className="dark:focus:text-black"
              >
                <MessageSquare className="mr-2 h-4 w-4" /> チャット
              </DropdownMenuItem>

              <DropdownMenuItem
                onClick={() => navigate('/media')}
                className="dark:focus:text-black"
              >
                <Images className="mr-2 h-4 w-4" /> フォト(Beta)
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                onClick={() => navigate(`/u/${user.username}`)}
                className="dark:focus:text-black"
              >
                <UserIcon className="mr-2 h-4 w-4" /> プロフィール
              </DropdownMenuItem>

              <DropdownMenuItem
                onClick={() => navigate('/settings')}
                className="dark:focus:text-black"
              >
                <SettingsIcon className="mr-2 h-4 w-4" /> 設定
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                onClick={() => {
                  logout();
                  navigate('/auth');
                }}
                className="text-destructive focus:bg-destructive/10 dark:focus:bg-destructive dark:focus:text-white"
              >
                <LogOut className="mr-2 h-4 w-4" /> ログアウト
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button asChild size="sm" className="rounded-full px-6 font-bold">
            <Link to="/auth">はじめる</Link>
          </Button>
        )}
      </div>

      {isSearchPage && (
        <div className="w-full overflow-hidden bg-green-600 text-white">
          <div className="notice-scroll flex w-max whitespace-nowrap py-1 text-sm font-bold">
            {[...notices, ...notices].map((notice, index) => (
              <span key={index} className="mx-8">
                {notice}
              </span>
            ))}
          </div>
        </div>
      )}
    </header>
  );
};