import { Link, useNavigate } from 'react-router-dom';
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
import { LogOut, Settings as SettingsIcon, User as UserIcon, Search } from 'lucide-react';

// 名前付きエクスポート
export const Header = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
        <Logo />
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
            <DropdownMenuContent align="end" className="w-56 rounded-xl border-border/60 shadow-xl">
              <DropdownMenuItem onClick={() => navigate('/search')}>
                <Search className="mr-2 h-4 w-4" /> 検索
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              
              <DropdownMenuItem onClick={() => navigate(`/u/${user.username}`)}>
                <UserIcon className="mr-2 h-4 w-4" /> プロフィール
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/settings')}>
                <SettingsIcon className="mr-2 h-4 w-4" /> 設定
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  logout();
                  navigate('/auth');
                }}
                className="text-destructive focus:bg-destructive/10 focus:text-destructive"
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
    </header>
  );
};