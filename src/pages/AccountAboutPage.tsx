import { AtSign, CalendarDays, Globe2, Info, MapPin } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useProfile } from '@/hooks/useProfile';
import { accountAboutKey, countryName, getAccountAbout } from '@/api/account-about';
import { useState } from 'react';

export default function AccountAboutPage() {
  const { username = '' } = useParams();
  const { data: user, isLoading } = useProfile(username);
  const [showCountryInfo, setShowCountryInfo] = useState(false);
  const about = useQuery({
    queryKey: accountAboutKey(user?.id ?? ''),
    queryFn: () => getAccountAbout(user!.id), enabled: !!user?.id, retry: 1,
  });
  const month = (date: string) => dayjs(date).isValid() ? dayjs(date).format('YYYY年M月') : '不明';
  return (
    <section className="min-h-screen bg-background text-foreground" data-lime-account-about>
      {isLoading ? <p className="p-6 text-muted-foreground">読み込み中…</p> : !user ?
        <p className="p-6 text-muted-foreground">アカウントが見つかりません</p> : <>
          <div className="flex flex-col items-center pb-10 pt-10">
            <Avatar className="h-20 w-20"><AvatarImage src={user.avatarUrl} alt="" /><AvatarFallback>{(user.displayName || user.username).slice(0, 1)}</AvatarFallback></Avatar>
            <div className="mt-3 flex max-w-full items-center justify-center gap-1 px-4">
              <h2 className="min-w-0 break-all text-center text-xl font-bold">{user.displayName || user.username}</h2>
              {user.isOfficial && <img src={`${import.meta.env.BASE_URL}verified.png`} alt="Official" className="h-[1.25em] w-[1.25em] shrink-0 translate-y-[1px]" loading="eager" />}
            </div>
            <p className="mt-1 text-base text-muted-foreground break-all px-4">@{user.username}</p>
          </div>
          <dl className="space-y-10 px-5 pb-12 sm:px-6">
            <div className="flex items-center gap-5"><CalendarDays className="h-6 w-6 shrink-0" aria-hidden="true" /><div><dt className="text-base">登録日</dt><dd className="mt-1 text-base text-muted-foreground">{month(user.createdAt)}</dd></div></div>
            <div>
              <div className="flex items-center gap-5"><MapPin className="h-6 w-6 shrink-0" aria-hidden="true" /><div className="flex-1"><dt className="text-base">アカウントの所在地</dt><dd className="mt-1 text-base text-muted-foreground">{countryName(about.data?.country_code ?? null)}</dd></div>
              </div>
             </div>
            <div className="flex items-center gap-5"><AtSign className="h-6 w-6 shrink-0" aria-hidden="true" /><div><dt className="text-base">ユーザー名の変更{about.data ? `${about.data.username_change_count}回` : ''}</dt>{about.data?.last_username_change_at ? <dd className="mt-1 text-base text-muted-foreground">前回の変更: {month(about.data.last_username_change_at)}</dd> : !about.data && <dd className="mt-1 text-base text-muted-foreground">未取得</dd>}</div></div>
            <div className="flex items-center gap-5"><Globe2 className="h-6 w-6 shrink-0" aria-hidden="true" /><div><dt className="text-base">接続元</dt><dd className="mt-1 text-base text-muted-foreground">{about.data?.connection_source ?? '未取得'}</dd></div></div>
          </dl>
          {about.isError && <p role="alert" className="px-5 pb-6 text-sm text-muted-foreground">アカウント情報を取得できませんでした。<button type="button" className="ml-2 underline" onClick={() => void about.refetch()}>再試行</button></p>}
        </>}
    </section>
  );
}
