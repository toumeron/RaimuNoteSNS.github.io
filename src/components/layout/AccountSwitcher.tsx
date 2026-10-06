import { useState, type ReactElement } from 'react';
import { Check, Loader2, Plus, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Drawer } from 'vaul';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { SavedAccount } from '@/lib/savedAccounts';

function AccountAvatar({ account, small = false }: { account: SavedAccount; small?: boolean }) {
  return <Avatar className={small ? 'h-8 w-8 border-0' : 'h-11 w-11 shrink-0 border-0'}>
    <AvatarImage src={account.avatarUrl} alt="" />
    <AvatarFallback>{(account.displayName || account.username).slice(0, 1)}</AvatarFallback>
  </Avatar>;
}
export function SavedAccountList({ onDone, managing = false, mobile = false }: { onDone?: () => void; managing?: boolean; mobile?: boolean }) {
  const { user, accounts = [], switching = false, switchAccount, forgetAccount } = useAuth();
  const navigate = useNavigate();
  const ids = [...new Set([...accounts.map(account => account.id), ...(user ? [user.id] : [])])].sort();
  const { data: profiles = [] } = useQuery({
    queryKey: ['saved-account-profiles', ids], enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, username, display_name, avatar_url, is_official').in('id', ids);
      if (error) throw error;
      return data ?? [];
    }, staleTime: 60_000,
  });
  const list = [...accounts];
  if (user && !list.some(account => account.id === user.id)) list.unshift({ id: user.id, username: user.username ?? '', displayName: user.displayName ?? '', avatarUrl: user.avatarUrl ?? '', isOfficial: user.isOfficial, needsLogin: false });
  const resolved = list.map(account => {
    const profile = profiles.find(row => row.id === account.id);
    return profile ? { ...account, username: profile.username ?? account.username, displayName: profile.display_name ?? account.displayName, avatarUrl: profile.avatar_url ?? account.avatarUrl, isOfficial: !!profile.is_official } : account;
  });
  return <div className={mobile ? 'min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y' : 'max-h-[min(55dvh,400px)] overflow-y-auto overscroll-contain'} data-lime-account-list>
    {resolved.map(account => <div key={account.id} className="flex items-center">
      <button type="button" disabled={switching} aria-label={`${account.displayName} @${account.username}${account.id === user?.id ? '（ログイン中）' : 'に切り替える'}`} aria-pressed={account.id === user?.id}
        className={`flex min-w-0 flex-1 items-center gap-3 px-4 text-left transition-colors hover:bg-muted/60 disabled:opacity-50 ${mobile ? 'py-4' : 'py-3'}`}
        onClick={async () => {
          if (account.needsLogin) { onDone?.(); navigate('/auth?add=1'); return; }
          try { await switchAccount(account.id); onDone?.(); navigate('/'); }
          catch (error) { toast.error(error instanceof Error ? error.message : 'アカウントの切り替えに失敗しました'); }
        }}>
        <AccountAvatar account={account} />
        <span className="min-w-0 flex-1"><span className={`flex min-w-0 items-center gap-1 font-bold ${mobile ? "text-base" : "text-[15px]"}`}><span className="truncate">{account.displayName}</span>{account.isOfficial && <img src={`${import.meta.env.BASE_URL}verified.png`} alt="認証済み" className="h-4 w-4 shrink-0" />}</span><span className="block truncate text-sm text-muted-foreground">@{account.username}</span>{account.needsLogin && <span className="text-xs text-muted-foreground">再ログイン</span>}</span>
        {account.id === user?.id && <Check className={`h-5 w-5 shrink-0 ${mobile ? "rounded-full bg-primary p-1 text-primary-foreground" : "text-green-500"}`} aria-label="ログイン中" />}
      </button>
      {managing && account.id !== user?.id && <button type="button" disabled={switching} aria-label={`@${account.username}をこの端末の保存から削除`} className="mr-3 rounded-full p-2 text-muted-foreground hover:bg-muted" onClick={() => forgetAccount(account.id)}><X className="h-4 w-4" /></button>}
    </div>)}
  </div>;
}
function AccountActions({ onDone }: { onDone: () => void }) {
  const { user, logout, switching = false } = useAuth();
  const navigate = useNavigate();
  return <div className="shrink-0 border-t border-border py-1">
    <button type="button" disabled={switching} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-bold hover:bg-muted/60" onClick={() => { onDone(); navigate('/auth?add=1'); }}><Plus className="h-4 w-4" />既存のアカウントを追加</button>
    {user && <button type="button" disabled={switching} className="w-full px-4 py-3 text-left text-sm font-bold hover:bg-muted/60" onClick={async () => {
      try { await logout(); onDone(); navigate('/auth'); }
      catch { toast.error('ログアウトに失敗しました'); }
    }}>@{user.username}からログアウト</button>}
  </div>;
}
export function AccountSwitcherMenu({ children, onDone }: { children: ReactElement; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const done = () => { setOpen(false); onDone?.(); };
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>{children}</PopoverTrigger>
    <PopoverContent side="top" align="start" sideOffset={10} collisionPadding={12} className="z-[500] w-[min(340px,calc(100vw-24px))] overflow-hidden rounded-2xl border-0 p-0 shadow-[0_8px_40px_rgba(0,0,0,0.35)] dark:shadow-[0_0_24px_rgba(255,255,255,0.2),0_12px_40px_rgba(0,0,0,0.6)]" aria-label="アカウント切り替え" data-lime-account-switcher>
      <SavedAccountList onDone={done} />
      <AccountActions onDone={done} />
    </PopoverContent>
  </Popover>;
}
export function MobileAccountSwitcher({ children, onDone }: { children: ReactElement; onDone: () => void }) {
  const { switching = false } = useAuth();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const done = () => { setOpen(false); setEditing(false); onDone(); };
  return <Drawer.Root open={open} onOpenChange={value => { setOpen(value); if (!value) setEditing(false); }} shouldScaleBackground={false} handleOnly>
    <Drawer.Trigger asChild>{children}</Drawer.Trigger>
    <Drawer.Portal>
      <Drawer.Overlay className="fixed inset-0 z-[2147483199] bg-black/60" />
      <Drawer.Content aria-describedby={undefined} data-lime-account-switcher data-lime-mobile-account-sheet className="fixed inset-x-0 bottom-0 z-[2147483200] flex h-[min(88dvh,850px)] flex-col overflow-hidden rounded-t-[28px] border-0 bg-popover dark:bg-black text-popover-foreground outline-none pb-[env(safe-area-inset-bottom)]">
        <Drawer.Handle aria-label="アカウント一覧を閉じる" className="mx-auto mt-2 h-1 w-11 shrink-0 bg-muted-foreground/40" />
        <div className="relative flex shrink-0 items-center justify-center px-5 py-4">
          <button type="button" disabled={switching} className="absolute left-5 text-sm disabled:opacity-50" onClick={() => setEditing(!editing)}>{editing ? '完了' : '編集'}</button>
          <Drawer.Title className="text-base font-bold">アカウント</Drawer.Title>
        </div>
        <SavedAccountList onDone={done} managing={editing} mobile />
        <AccountActions onDone={done} />
      </Drawer.Content>
    </Drawer.Portal>
  </Drawer.Root>;
}
export function MobileAccountShortcuts({ onDone }: { onDone: () => void }) {
  const { user, accounts = [], switching = false } = useAuth();
  const others = accounts.filter(account => account.id !== user?.id);
  return <div className="ml-auto flex shrink-0 items-center gap-1" data-lime-mobile-account-shortcuts>
    <MobileAccountSwitcher onDone={onDone}>
      <button type="button" disabled={switching} aria-label="アカウント一覧を開く" className="flex items-center gap-1 rounded-full p-1 disabled:opacity-50">
        {switching ? <Loader2 className="h-5 w-5 animate-spin" /> : others.length ? others.slice(0, 2).map(account => <AccountAvatar key={account.id} account={account} small />) : <Plus className="h-5 w-5" />}
      </button>
    </MobileAccountSwitcher>
  </div>;
}
