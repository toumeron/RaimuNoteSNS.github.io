import { NavLink } from 'react-router-dom';
import { Home, User as UserIcon, Settings as SettingsIcon } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

export function BottomNav() {
  const { user } = useAuth();
  if (!user) return null;

  const items = [
    { to: '/', icon: Home, label: 'ホーム', end: true },
    { to: `/u/${user.username}`, icon: UserIcon, label: 'プロフ' },
    { to: '/settings', icon: SettingsIcon, label: '設定' },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-border/60 bg-background/90 backdrop-blur-md md:hidden">
      <ul className="mx-auto grid max-w-md grid-cols-3">
        {items.map((it) => (
          <li key={it.to}>
            <NavLink
              to={it.to}
              end={it.end}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-1 py-2.5 text-xs font-bold transition',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                )
              }
            >
              <it.icon className="h-5 w-5" />
              {it.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
