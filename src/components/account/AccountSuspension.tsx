import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { SUSPENSION_EVENT, SUSPENSION_MESSAGE } from '@/lib/accountSuspension';

export function SuspensionNotice({profile = false}: {profile?: boolean}) {
  return <section className={profile ? "mx-auto max-w-xl px-8 py-20 sm:px-12 sm:py-28" : "border-b border-border px-6 py-10 sm:px-10 sm:py-12"} aria-label="アカウントの停止">
    <h1 className={`${profile ? "text-3xl" : "text-2xl"} font-extrabold leading-tight sm:text-4xl`}>{profile ? 'アカウントは停止されています' : 'ご利用のアカウントは停止されています'}</h1>
    <p className="mt-5 text-base leading-relaxed text-muted-foreground sm:text-lg">{profile ? 'LimeNoteでは、利用規約に違反しているアカウントを停止しています' : 'ご利用のアカウントは読み取り専用になっています。ポスト、返信、リポスト、いいね、フォロー、メッセージの送信などの操作はできません。'}<Link to="/terms" className="text-primary hover:underline">利用規約</Link></p>
  </section>;
}
export function AccountSuspensionFeedback() {
  const {user} = useAuth();
  const [visible,setVisible] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const show = () => {setVisible(true);clearTimeout(timer);timer=setTimeout(()=>setVisible(false),7000);};
    window.addEventListener(SUSPENSION_EVENT,show);
    return () => {window.removeEventListener(SUSPENSION_EVENT,show);clearTimeout(timer);};
  },[]);
  useEffect(()=>{setVisible(false);},[user?.id]);
  return visible ? <div role="alert" className="fixed bottom-24 left-1/2 z-[2147483500] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 rounded-lg bg-primary px-5 py-4 text-primary-foreground shadow-lg sm:bottom-8"><p className="text-sm sm:text-base">{SUSPENSION_MESSAGE}</p></div> : null;
}
