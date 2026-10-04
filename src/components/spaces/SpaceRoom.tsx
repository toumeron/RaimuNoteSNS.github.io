import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, ChevronDown, Headphones, Mic, MicOff, MoreHorizontal, Pencil, Share2, Users, X } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import * as Dialog from '@radix-ui/react-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { spaceRpc, SPACE_EMOJIS, type SpaceState } from '@/api/spaces';
import type { LiveSpace, SpeakerPolicy } from './SpaceContext';
import { SpaceIcon } from './SpaceIcon';

function HeartPlus() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 10a5 5 0 0 0-8-5 5 5 0 0 0-8 6l8 8 3-3" /><path d="M19 14v7m-3.5-3.5h7" /></svg>; }

export const SPEAKER_POLICIES: { value: SpeakerPolicy; label: string }[] = [
  { value: 'host', label: 'スピーカーとして許可したアカウントのみ' },
  { value: 'following', label: 'フォローしているアカウント' },
  { value: 'everyone', label: '全員' },
];
export function SpacePolicySelect({ value, onChange, disabled }: { value: SpeakerPolicy; onChange: (value: SpeakerPolicy) => void; disabled?: boolean }) {
  return <label className="lime-space-policy"><span>発言できるユーザー</span><select aria-label="発言できるユーザー" value={value} onChange={event => onChange(event.target.value as SpeakerPolicy)} disabled={disabled}>{SPEAKER_POLICIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>;
}
function Face({ name, src, className = '' }: { name: string; src?: string; className?: string }) {
  return <Avatar className={`lime-space-face ${className}`}><AvatarImage src={src} /><AvatarFallback>{name?.slice(0, 1)}</AvatarFallback></Avatar>;
}
export function SpaceEndConfirmation({ open, onOpenChange, onEnd, busy }: { open: boolean; onOpenChange: (value: boolean) => void; onEnd: () => Promise<void>; busy: boolean }) {
  return <AlertDialog.Root open={open} onOpenChange={onOpenChange}><AlertDialog.Portal><AlertDialog.Overlay className="lime-space-overlay lime-space-confirm-overlay" /><AlertDialog.Content className="lime-space-dialog lime-space-confirm"><MicOff className="mx-auto mb-8 h-12 w-12 text-primary" /><AlertDialog.Title className="text-2xl font-bold">スペースを終了しますか？</AlertDialog.Title><AlertDialog.Description className="my-4 text-muted-foreground">すべてのユーザーに対して会話が終了されます。</AlertDialog.Description><button className="lime-space-primary mt-6" disabled={busy} onClick={() => void onEnd()}>{busy ? '終了中…' : '終了する'}</button><AlertDialog.Cancel disabled={busy} className="lime-space-secondary mt-3">いいえ</AlertDialog.Cancel></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>;
}
export function SpaceRoom({ space, data, joined, host, anonymous, setAnonymous, busy, muted, canSpeak, audioBlocked, resumeAudio, join, microphone, share, minimize, leave, refresh, devices, chooseMicrophone, selectedMicrophone, ownUid, voiceLevels = {}, speakingUids = [], remoteMuted = {} }: {
  space: LiveSpace; data: SpaceState; joined: boolean; host: boolean; anonymous: boolean; setAnonymous: (value: boolean) => void; busy: boolean; muted: boolean; canSpeak: boolean; audioBlocked: boolean; resumeAudio: () => void; join: () => void; microphone: () => void; share: () => void; minimize: () => void; leave: () => void; refresh: () => void;
  voiceLevels?: Record<number, number>; ownUid?: number; speakingUids?: number[]; remoteMuted?: Record<number, boolean>;
  devices: MediaDeviceInfo[]; chooseMicrophone: (id: string) => void; selectedMicrophone: string;
}) {
  const swipeStart = useRef<number | null>(null);
  const [view, setView] = useState<'room' | 'guests' | 'settings' | 'microphone' | 'edit'>('room');
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState(space.title);
  useEffect(() => { setView('room'); setReactionsOpen(false); }, [space.id]);
  const perform = async (name: string, args: Record<string, unknown>, done?: () => void) => {
    if (pending) return;
    setPending(true);
    try { await spaceRpc(name, { p_space_id: space.id, ...args }); refresh(); done?.(); }
    catch (error) { toast.error((error as Error).message || '更新できませんでした'); }
    finally { setPending(false); }
  };
  const guestCount = data.members.filter(member => member.role !== 'host').length + data.anonymous_count;
  const requestCount = data.members.filter(member => member.requested).length;
  const roomHeader = <div className="lime-space-room-header"><button aria-label={joined ? 'スペースを最小化' : '閉じる'} className="lime-space-icon" disabled={busy} onClick={minimize}>{joined ? <ChevronDown /> : <X />}</button><div className="ml-auto flex items-center gap-1"><button className="lime-space-icon" aria-label="スペースを共有" onClick={share}><Share2 /></button>{joined && <Popover.Root><Popover.Trigger className="lime-space-icon" aria-label="スペースのメニュー"><MoreHorizontal /></Popover.Trigger><Popover.Content className="lime-space-popover lime-space-menu" align="end" sideOffset={6}>{host && <Popover.Close onClick={() => setView('settings')}>スペースの設定</Popover.Close>}{canSpeak && <Popover.Close onClick={() => setView('microphone')}>マイクの設定</Popover.Close>}</Popover.Content></Popover.Root>}{joined && <button className="lime-space-leave" disabled={busy} onClick={leave}>{host ? '終了' : '退出する'}</button>}</div></div>;
  return <>
    <button className="lime-space-grab" aria-label="スペースを折りたたむ" onClick={minimize} onTouchStart={event => { swipeStart.current = event.touches[0].clientY; }} onTouchEnd={event => { if (swipeStart.current !== null && event.changedTouches[0].clientY - swipeStart.current > 50) minimize(); swipeStart.current = null; }}><span /></button>
    {view === 'room' ? roomHeader : <div className="lime-space-room-header"><button aria-label="スペースに戻る" className="lime-space-icon" onClick={() => setView('room')}><ArrowLeft /></button><h2 className="ml-3 text-xl font-bold">{view === 'guests' ? 'ゲスト' : view === 'settings' ? 'スペースの設定' : view === 'edit' ? 'テーマを編集' : 'マイクの設定'}</h2></div>}
    <div className="lime-space-room-body">
      {view === 'room' && <p className="lime-space-live-label">ライブ · {data.members.length + data.anonymous_count}人がリスニング中</p>}
      <Dialog.Title className={view === 'room' ? 'lime-space-room-title' : 'sr-only'}>{space.title}</Dialog.Title>
      {view === 'room' ? <>
        {host && joined && <button className="lime-space-edit lime-space-icon" aria-label="テーマを編集" onClick={() => { setDraft(space.title); setView('edit'); }}><Pencil className="!h-4 !w-4" /></button>}
        <div className="lime-space-members">{[
          data.members.find(member => member.role === 'host') || { id: space.host_id, display_name: space.profiles.display_name, avatar_url: space.profiles.avatar_url, role: 'host' as const, muted: true, rtc_uid: host && joined ? ownUid : undefined },
          ...data.members.filter(member => member.role === 'speaker'), ...data.members.filter(member => member.role === 'listener'),
        ].map(member => {
          const isSelf = joined && (member.rtc_uid === ownUid || (host && member.role === 'host'));
          const isMuted = isSelf ? muted : member.rtc_uid !== undefined && remoteMuted[member.rtc_uid] !== undefined ? remoteMuted[member.rtc_uid] : member.muted !== false;
          const volume = member.rtc_uid === undefined ? 0 : voiceLevels[member.rtc_uid] || 0;
          const speaking = member.role !== 'listener' && !isMuted && member.rtc_uid !== undefined && speakingUids.includes(member.rtc_uid);
          return <div key={member.id} style={{ '--voice-level': volume } as CSSProperties} data-voice-level={isMuted ? 0 : volume} className={`lime-space-person ${speaking ? 'is-speaking' : ''}`}><Face name={member.display_name} src={member.avatar_url} /><p>{member.display_name}</p><span>{member.role !== 'listener' && (isMuted ? <MicOff aria-label="ミュート中" /> : speaking ? <span className="lime-space-voice-bars" aria-label="発言中"><i /><i /><i /></span> : <Mic aria-label="マイクオン" />)}{member.role === 'host' ? 'ホスト' : member.role === 'speaker' ? 'スピーカー' : 'リスナー'}</span></div>;
        })}</div>
        {!!data.anonymous_count && <p className="text-sm text-muted-foreground">匿名リスナー {data.anonymous_count}人</p>}
        <div aria-live="polite" className="lime-space-reactions">{data.reactions.map(reaction => <span key={reaction.id} className="lime-space-reaction">{reaction.emoji}</span>)}</div>
        {!joined && <div className="lime-space-listen">{!host && <label className="my-7 flex items-center justify-between gap-4 font-bold">匿名でリスニングする<Switch aria-label="匿名でリスニングする" checked={anonymous} onCheckedChange={setAnonymous} disabled={busy} /></label>}<p className="mb-3 text-center text-sm text-muted-foreground">開始する前にマイクがオフになります</p><button className="lime-space-primary" onClick={join} disabled={busy}>{busy ? '接続中…' : host ? '配信に戻る' : '聞いてみる'}</button></div>}
      </> : view === 'guests' ? <>
        {(['host', 'speaker', 'listener'] as const).map(role => <section className="lime-space-guest-section" key={role}><h3>{role === 'host' ? 'ホスト' : role === 'speaker' ? 'スピーカー' : 'リスナー'}</h3>{role !== 'host' && <p className="text-sm text-muted-foreground">{data.members.filter(member => member.role === role).length + (role === 'listener' ? data.anonymous_count : 0)}人</p>}{data.members.filter(member => member.role === role).map(member => <div className="lime-space-guest" key={member.id}><Face name={member.display_name} src={member.avatar_url} /><div className="min-w-0 flex-1"><p className="truncate font-bold">{member.display_name}</p>{member.username && <p className="truncate text-muted-foreground">@{member.username}</p>}{member.requested && <p className="text-sm text-primary">発言リクエスト</p>}</div>{host && role !== 'host' && <button disabled={pending} className="lime-space-guest-action" onClick={() => void perform('manage_space_speaker', { p_member_id: member.id, p_allow: role !== 'speaker' })}>{role === 'speaker' ? 'リスナーに戻す' : '発言を許可'}</button>}</div>)}{role === 'listener' && !!data.anonymous_count && <p className="mt-4 text-muted-foreground">匿名リスナー {data.anonymous_count}人</p>}</section>)}
      </> : view === 'settings' ? <><h3 className="mt-5 text-xl font-bold">スピーカー</h3><p className="my-3 text-sm text-muted-foreground">発言できるユーザーを選択してください。</p><div className="lime-space-policy-options">{SPEAKER_POLICIES.map(item => <label key={item.value}><span>{item.label}</span><input type="radio" name="speaker-policy" checked={space.speaker_policy === item.value} disabled={pending} onChange={() => void perform('update_live_space', { p_title: space.title, p_policy: item.value })} /></label>)}</div></> : view === 'edit' ? <><input autoFocus aria-label="スペースのテーマ" className="lime-space-input mt-6 rounded-full" maxLength={100} value={draft} onChange={event => setDraft(event.target.value)} /><button disabled={pending || !draft.trim()} className="lime-space-primary mt-5" onClick={() => void perform('update_live_space', { p_title: draft.trim(), p_policy: space.speaker_policy }, () => setView('room'))}>保存</button></> : <><label className="mt-6 block text-sm text-muted-foreground" htmlFor="space-microphone">マイク</label><select id="space-microphone" className="lime-space-input mt-2" value={selectedMicrophone} onChange={event => chooseMicrophone(event.target.value)} disabled={busy}><option value="">デフォルト</option>{devices.map(device => <option key={device.deviceId} value={device.deviceId}>{device.label || 'マイク'}</option>)}</select></>}
    </div>
    {joined && <div className="lime-space-controls">{anonymous && <div className="lime-space-anonymous"><Headphones />匿名でリスニング中</div>}{audioBlocked && <button className="lime-space-primary mb-3" onClick={resumeAudio}>音声を再生する</button>}<div className="flex items-center gap-3"><div className="mr-auto flex min-w-0 items-center gap-2">{canSpeak ? <><button className={`lime-space-microphone ${muted ? 'is-muted' : ''}`} onClick={microphone} disabled={busy} aria-label={muted ? 'マイクをオンにする' : 'マイクをオフにする'}>{muted ? <MicOff /> : <Mic />}</button><button className="lime-space-icon" aria-label="マイクの設定" onClick={() => setView('microphone')}><ChevronDown className="rotate-180" /></button></> : anonymous ? <span className="lime-space-listening"><Headphones />リスニング中</span> : <button className="lime-space-request" disabled={pending} onClick={() => void perform('request_space_speaker', { p_requested: !data.me?.requested })}><Mic /><span>{data.me?.requested ? 'リクエストを取消' : '発言をリクエスト'}</span></button>}</div><button className="lime-space-control-icon relative" aria-label="スペースを管理" aria-pressed={view === 'guests'} onClick={() => setView(view === 'guests' ? 'room' : 'guests')}><Users />{!!requestCount && host && <span className="lime-space-request-badge">{requestCount}</span>}<span className="sr-only">ゲスト {guestCount}人</span></button><Popover.Root open={reactionsOpen} onOpenChange={setReactionsOpen}><Popover.Trigger className="lime-space-control-icon" aria-label="リアクションする"><HeartPlus /></Popover.Trigger><Popover.Content className="lime-space-popover lime-space-emoji-panel" side="top" align="end" sideOffset={12} aria-label="絵文字リアクション">{SPACE_EMOJIS.map(emoji => <button key={emoji} aria-label={`${emoji}でリアクション`} className="lime-space-emoji" onClick={() => void perform('react_live_space', { p_emoji: emoji }, () => setReactionsOpen(false))}>{emoji}</button>)}</Popover.Content></Popover.Root></div>{!canSpeak && !anonymous && <p className="sr-only">リスニング中</p>}</div>}
  </>;
}
