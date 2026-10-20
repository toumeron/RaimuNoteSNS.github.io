import { getClientName } from "@/lib/utils";
import { useCallback, useEffect, useRef, useState, useMemo, type ReactNode, createContext, useContext, type SVGProps, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { Mic, X, ArrowLeft, ChevronDown, Headphones, MicOff, MoreHorizontal, Pencil, Share2, Users } from "lucide-react";
import { toast } from "sonner";
import { type IAgoraRTCClient, type IMicrophoneAudioTrack, IAgoraRTCClient as AgoraIAgoraRTCClient, IMicrophoneAudioTrack as AgoraIMicrophoneAudioTrack } from "agora-rtc-sdk-ng";
import { useAuth } from "@/hooks/useAuth";
import { requestMicrophonePermission, microphoneErrorMessage } from "@/lib/callRecorder";
import { getLiveSpaces, getSpaceState, getSpaceToken, spaceRpc, SPACE_EMOJIS, type SpaceState } from "@/api/users";
import { SpacePlayback, SpaceWaitingAudio } from "@/lib/callRecorder";
import * as Popover from "@radix-ui/react-popover";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/button";
import { OfflineBookmarkContext } from "@/components/stickers/Stickers";
import { spaceLinkIn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useParams } from "react-router-dom";

// SpaceProvider
// SpaceRoom
function HeartPlus() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 10a5 5 0 0 0-8-5 5 5 0 0 0-8 6l8 8 3-3" /><path d="M19 14v7m-3.5-3.5h7" /></svg>; }

const SPEAKER_POLICIES: { value: SpeakerPolicy; label: string }[] = [
  { value: 'host', label: 'スピーカーとして許可したアカウントのみ' },
  { value: 'following', label: 'フォローしているアカウント' },
  { value: 'everyone', label: '全員' },
];
function SpacePolicySelect({ value, onChange, disabled }: { value: SpeakerPolicy; onChange: (value: SpeakerPolicy) => void; disabled?: boolean }) {
  return <label className="lime-space-policy"><span>発言できるユーザー</span><select aria-label="発言できるユーザー" value={value} onChange={event => onChange(event.target.value as SpeakerPolicy)} disabled={disabled}>{SPEAKER_POLICIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>;
}
function Face({ name, src, className = '' }: { name: string; src?: string; className?: string }) {
  return <Avatar className={`lime-space-face ${className}`}><AvatarImage src={src} /><AvatarFallback>{name?.slice(0, 1)}</AvatarFallback></Avatar>;
}
function SpaceEndConfirmation({ open, onOpenChange, onEnd, busy }: { open: boolean; onOpenChange: (value: boolean) => void; onEnd: () => Promise<void>; busy: boolean }) {
  return <AlertDialog.Root open={open} onOpenChange={onOpenChange}><AlertDialog.Portal><AlertDialog.Overlay className="lime-space-overlay lime-space-confirm-overlay" /><AlertDialog.Content className="lime-space-dialog lime-space-confirm"><MicOff className="mx-auto mb-8 h-12 w-12 text-primary" /><AlertDialog.Title className="text-2xl font-bold">スペースを終了しますか？</AlertDialog.Title><AlertDialog.Description className="my-4 text-muted-foreground">すべてのユーザーに対して会話が終了されます。</AlertDialog.Description><button className="lime-space-primary mt-6" disabled={busy} onClick={() => void onEnd()}>{busy ? '終了中…' : '終了する'}</button><AlertDialog.Cancel disabled={busy} className="lime-space-secondary mt-3">いいえ</AlertDialog.Cancel></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>;
}
function SpaceRoom({ space, data, joined, host, anonymous, setAnonymous, busy, muted, canSpeak, audioBlocked, resumeAudio, join, microphone, share, minimize, leave, refresh, devices, chooseMicrophone, selectedMicrophone, ownUid, voiceLevels = {}, speakingUids = [], remoteMuted = {} }: {
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

// SpaceProvider
type AudioSession = { announced?: boolean; playback: SpacePlayback; waitingAudio: SpaceWaitingAudio; id: string; uid: number; userId: string; anonymous: boolean; host: boolean; publishing: boolean; client: IAgoraRTCClient; track?: IMicrophoneAudioTrack; restoreAutoplay: () => void; observedSpeaker?: boolean };

function SpaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const live = useQuery({ queryKey: ['live-spaces'], queryFn: getLiveSpaces, staleTime: 15000, refetchInterval: 30000, retry: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [policy, setPolicy] = useState<SpeakerPolicy>('host');
  const [ending, setEnding] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicrophone, setSelectedMicrophone] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [audioSession, setAudioSession] = useState<AudioSession | null>(null);
  const [voiceLevels, setVoiceLevels] = useState<Record<number, number>>({});
  const [speakingUids, setSpeakingUids] = useState<number[]>([]);
  const [remoteMuted, setRemoteMuted] = useState<Record<number, boolean>>({});
  const [muted, setMuted] = useState(true);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const session = useRef<AudioSession | null>(null);
  const operation = useRef(false);
  const generation = useRef(0);
  const inspectedId = selected || audioSession?.id;
  const state = useQuery({ queryKey: ['space', inspectedId], queryFn: () => getSpaceState(inspectedId!), enabled: !!inspectedId, staleTime: 2500, refetchInterval: 3000, refetchIntervalInBackground: false, retry: 1 });
  const space = state.data?.space;

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['live-spaces'] });
    void queryClient.invalidateQueries({ queryKey: ['space'] });
    void queryClient.invalidateQueries({ queryKey: ['space-card'] });
  }, [queryClient]);

  const disconnect = useCallback(async (notifyServer = true) => {
    generation.current++;
    const active = session.current;
    session.current = null;
    setAudioSession(null);
    setSpeakingUids([]); setVoiceLevels({}); setRemoteMuted({});
    setMuted(true);
    setAudioBlocked(false);
    if (active) {
      active.waitingAudio.stop();
      active.playback.close();
      active.track?.stop();
      active.track?.close();
      active.restoreAutoplay();
      active.client.removeAllListeners();
      await active.client.leave().catch(() => {});
      if (notifyServer) await spaceRpc('leave_live_space', { p_space_id: active.id }).catch(() => {});
    }
    refresh();
  }, [refresh]);

  useEffect(() => {
    return () => { void disconnect(); };
  }, [disconnect, user?.id]);

  useEffect(() => {
    if (!audioSession) return;
    let running = false;
    const pulse = async () => {
      if (running || session.current !== audioSession) return;
      running = true;
      try {
        await spaceRpc('heartbeat_live_space', { p_space_id: audioSession.id });
        if (audioSession.host && !audioSession.announced) { await spaceRpc('announce_live_space', { p_space_id: audioSession.id, p_client_name: getClientName() }); audioSession.announced = true; void queryClient.invalidateQueries({ queryKey: ['feed'] }); void queryClient.invalidateQueries({ queryKey: ['posts'] }); }
        const current = await queryClient.fetchQuery({ queryKey: ['space', audioSession.id], queryFn: () => getSpaceState(audioSession.id), staleTime: 5000 });
        if (!current.space) {
          await disconnect(false);
          toast('スペースが終了しました');
        }
      } catch { /* A brief network interruption is handled by Agora reconnection. */ }
      finally { running = false; }
    };
    const timer = window.setInterval(pulse, 20000);
    const foreground = () => { if (!document.hidden) void pulse(); };
    document.addEventListener('visibilitychange', foreground);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', foreground); };
  }, [audioSession, disconnect, queryClient]);

  useEffect(() => {
    if (!audioSession) return;
    const measure = () => {
      if (session.current !== audioSession || document.hidden) return;
      const levels: Record<number, number> = {};
      const level = (value: number) => Number.isFinite(value) ? Math.round(Math.max(0, Math.min(1, value)) * 100) / 100 : 0;
      levels[audioSession.uid] = audioSession.track?.getVolumeLevel ? level(audioSession.track.getVolumeLevel()) : 0;
      audioSession.client.remoteUsers.forEach(remote => { levels[Number(remote.uid)] = remote.audioTrack?.getVolumeLevel ? level(remote.audioTrack.getVolumeLevel()) : 0; });
      setVoiceLevels(previous => Object.keys(previous).length === Object.keys(levels).length && Object.entries(levels).every(([uid, value]) => previous[Number(uid)] === value) ? previous : levels);
      const speakers = Object.keys(levels).map(Number).filter(uid => levels[uid] > .015);
      setSpeakingUids(previous => previous.length === speakers.length && previous.every((uid, index) => uid === speakers[index]) ? previous : speakers);
    };
    measure(); const timer = window.setInterval(measure, 100);
    return () => clearInterval(timer);
  }, [audioSession]);

  const open = useCallback((id: string) => { setCreating(false); setAnonymous(false); setSelected(id); }, []);
  const create = useCallback(() => {
    if (!user) { toast.error('ログインしてください'); return; }
    if (session.current) { open(session.current.id); return; }
    setSelected(null); setCreating(true); setTitle(''); setPolicy('host');
  }, [user, open]);

  const connect = async (id: string, host: boolean, hidden: boolean, waitingAudio: SpaceWaitingAudio, microphonePermission?: Promise<void>) => {
    const stamp = generation.current;
    const playback = new SpacePlayback(() => setAudioBlocked(true), () => waitingAudio.pause(), () => waitingAudio.resume());
    playback.setCapturing(host);
    let client: IAgoraRTCClient | undefined;
    let track: IMicrophoneAudioTrack | undefined;
    let registered = false;
    let restoreAutoplay = () => {};
    try {
      if (microphonePermission) await microphonePermission;
      if (stamp !== generation.current) throw new Error('接続を中止しました');
      const member = await spaceRpc<{ rtc_uid: number; anonymous: boolean }>('join_live_space', { p_space_id: id, p_anonymous: hidden });
      registered = true;
      const token = await getSpaceToken(id, member.rtc_uid, host);
      const { default: AgoraRTC } = await import('agora-rtc-sdk-ng');
      client = AgoraRTC.createClient({ mode: 'live', codec: 'vp8' });
      await client.setClientRole(token.role);
      client.enableAudioVolumeIndicator();
      client.on('volume-indicator', levels => { if (stamp === generation.current) setSpeakingUids(levels.filter(item => item.level > 5).map(item => Number(item.uid))); });
      client.on('user-info-updated', (uid, message) => {
        if (stamp !== generation.current || (message !== 'mute-audio' && message !== 'unmute-audio')) return;
        setRemoteMuted(previous => ({ ...previous, [Number(uid)]: message === 'mute-audio' }));
      });
      client.on('user-unpublished', (remote, type) => {
        if (type !== 'audio') return;
        playback.remove(remote.uid);
        if (stamp === generation.current) { setRemoteMuted(previous => ({ ...previous, [Number(remote.uid)]: true })); setSpeakingUids(previous => previous.filter(uid => uid !== Number(remote.uid))); }
      });
      client.on('user-left', remote => { playback.remove(remote.uid); if (stamp === generation.current) setSpeakingUids(previous => previous.filter(uid => uid !== Number(remote.uid))); });
      client.on('user-published', async (remote, type) => {
        if (type !== 'audio' || !client) return;
        try {
          const roster = await getSpaceState(id);
          const speaker = roster.members.find(member => member.rtc_uid === remote.uid && member.role !== 'listener');
          if (!speaker) return;
          if (stamp !== generation.current) return;
          // A muted track can also be announced while joining. Only confirmed
          // microphone activation ends the music; polling covers RTC/DB races.
          if (speaker.muted === false || roster.waiting === false) waitingAudio.stop();
          await client.subscribe(remote, 'audio');
          if (stamp !== generation.current) return;
          setRemoteMuted(previous => ({ ...previous, [Number(remote.uid)]: speaker.muted !== false }));
          if (remote.audioTrack) playback.attach(remote.uid, remote.audioTrack);
        }
        catch { setAudioBlocked(true); }
      });
      client.on('token-privilege-will-expire', async () => {
        const active = session.current;
        if (!active || active.client !== client) return;
        try { await client!.renewToken((await getSpaceToken(id, active.uid, active.publishing)).token); }
        catch { toast.error('音声接続の更新に失敗しました。再入室してください。'); void disconnect(); }
      });
      client.on('token-privilege-did-expire', () => { toast.error('音声接続が期限切れになりました。再入室してください。'); void disconnect(); });
      const previousAutoplay = AgoraRTC.onAutoplayFailed;
      const onAutoplay = () => setAudioBlocked(true);
      AgoraRTC.onAutoplayFailed = onAutoplay;
      restoreAutoplay = () => { if (AgoraRTC.onAutoplayFailed === onAutoplay) AgoraRTC.onAutoplayFailed = previousAutoplay; };
      if (stamp !== generation.current) throw new Error('接続を中止しました');
      await client.join(token.appId, `lime-space:${id}`, token.token, member.rtc_uid);
      if (host) {
        if (stamp !== generation.current) throw new Error('接続を中止しました');
        track = await AgoraRTC.createMicrophoneAudioTrack(selectedMicrophone ? { microphoneId: selectedMicrophone } : undefined);
        await track.setMuted(true);
        await client.publish(track);
        setDevices(await AgoraRTC.getMicrophones().catch(() => []));
      }
      if (stamp !== generation.current) throw new Error('接続を中止しました');
      const current = await getSpaceState(id);
      if (!current.space || stamp !== generation.current) throw new Error('接続を中止しました');
      waitingAudio.setWaiting(current.waiting === true);
      playback.describe(current.space.title, current.space.profiles.display_name);
      const active: AudioSession = { playback, waitingAudio, id, uid: member.rtc_uid, userId: user!.id, anonymous: member.anonymous, host, publishing: host, client, track, restoreAutoplay };
      session.current = active;
      setAudioSession(active); setMuted(true); refresh();
      if (host) {
        try { await spaceRpc('announce_live_space', { p_space_id: id, p_client_name: getClientName() }); active.announced = true; void queryClient.invalidateQueries({ queryKey: ['feed'] }); void queryClient.invalidateQueries({ queryKey: ['posts'] }); }
        catch { toast.error('スペースのお知らせを投稿できませんでした。接続が戻ると再試行します。'); }
      }
    } catch (error) {
      waitingAudio.stop();
      playback.close();
      track?.close();
      restoreAutoplay();
      client?.removeAllListeners();
      await client?.leave().catch(() => {});
      if (registered || host) await spaceRpc('leave_live_space', { p_space_id: id }).catch(() => {});
      throw error;
    }
  };

  const start = async () => {
    if (operation.current || !user || !title.trim()) return;
    operation.current = true; setBusy(true);
    const stamp = generation.current;
    // Begin permission request in the tap handler, before database/network awaits (iOS/PWA).
    const waitingAudio = new SpaceWaitingAudio(() => setAudioBlocked(true));
    const permission = requestMicrophonePermission();
    try {
      await permission;
      if (stamp !== generation.current) throw new Error('接続を中止しました');
      const id = await spaceRpc<string>('create_live_space', { p_title: title.trim(), p_policy: policy });
      if (stamp !== generation.current) { await spaceRpc('leave_live_space', { p_space_id: id }).catch(() => {}); throw new Error('接続を中止しました'); }
      await connect(id, true, false, waitingAudio);
      setCreating(false); setSelected(id);
    } catch (error) { waitingAudio.stop(); toast.error(microphoneErrorMessage(error)); }
    finally { operation.current = false; setBusy(false); }
  };

  const join = async () => {
    if (operation.current || !space) return;
    if (!user) { toast.error('ログインしてください。匿名リスニングもログイン後に利用できます。'); return; }
    if (session.current && session.current.id !== space.id) { toast.error('参加中のスペースを退出してから参加してください。'); return; }
    const host = user.id === space.host_id;
    operation.current = true; setBusy(true);
    const waitingAudio = new SpaceWaitingAudio(() => setAudioBlocked(true));
    const permission = host ? requestMicrophonePermission() : undefined;
    try { await connect(space.id, host, anonymous, waitingAudio, permission); }
    catch (error) { waitingAudio.stop(); toast.error(microphoneErrorMessage(error)); }
    finally { operation.current = false; setBusy(false); }
  };

  const toggleMicrophone = async () => {
    const active = session.current;
    if (!active || operation.current) return;
    operation.current = true; setBusy(true);
    const permission = !active.track ? requestMicrophonePermission() : undefined;
    try {
      if (permission) await permission;
      if (!active.track) {
        if (session.current !== active) return;
        const { default: AgoraRTC } = await import('agora-rtc-sdk-ng');
        const token = await getSpaceToken(active.id, active.uid, true);
        await active.client.renewToken(token.token);
        await active.client.setClientRole('host');
        const track = await AgoraRTC.createMicrophoneAudioTrack(selectedMicrophone ? { microphoneId: selectedMicrophone } : undefined);
        setDevices(await AgoraRTC.getMicrophones().catch(() => []));
        if (session.current !== active) { track.close(); return; }
        active.track = track;
        active.playback.setCapturing(true);
        await track.setMuted(true);
        await active.client.publish(track);
        active.publishing = true;
      }
      if (session.current !== active) return;
      await active.track.setMuted(!muted);
      if (muted) active.waitingAudio.stop();
      setMuted(!muted);
      await spaceRpc('set_space_microphone', { p_space_id: active.id, p_muted: !muted }); refresh();
    } catch (error) {
      if (!active.publishing && session.current === active) {
        active.track?.close(); active.track = undefined; active.playback.setCapturing(false);
        try {
          await active.client.renewToken((await getSpaceToken(active.id, active.uid, false)).token);
          await active.client.setClientRole('audience');
        } catch { /* The session can still be closed normally. */ }
      }
      toast.error(microphoneErrorMessage(error));
    }
    finally { operation.current = false; setBusy(false); }
  };

  const share = async () => {
    if (!selected) return;
    const url = new URL(`${import.meta.env.BASE_URL}spaces/${selected}`, window.location.origin).href;
    try {
      if (navigator.share) await navigator.share({ title: space?.title || 'スペース', url });
      else { await navigator.clipboard.writeText(url); toast.success('リンクをコピーしました'); }
    } catch (error) { if ((error as Error).name !== 'AbortError') toast.error('リンクを共有できませんでした'); }
  };
  const joined = audioSession?.id === selected;
  const canSpeak = !!joined && !audioSession.anonymous && (audioSession.host || (state.data?.me?.can_speak ?? space?.speaker_policy === 'everyone'));
  const modalOpen = creating || !!selected;
  const currentRoom = live.data?.find(room => room.id === audioSession?.id);
  const minimize = () => { setSelected(null); setCreating(false); };
  const finish = async () => { setBusy(true); await disconnect(); setBusy(false); setEnding(false); };
  const chooseMicrophone = async (id: string) => {
    const active = session.current;
    if (operation.current) return;
    operation.current = true; setBusy(true);
    try { if (active?.track) await active.track.setDevice(id || 'default'); setSelectedMicrophone(id); }
    catch (error) { toast.error(microphoneErrorMessage(error)); }
    finally { operation.current = false; setBusy(false); }
  };
  useEffect(() => {
    const active = session.current;
    if (active && state.data?.space === null) active.waitingAudio.stop();
    if (!active || active.id !== state.data?.space?.id) return;
    active.playback.describe(state.data.space.title, state.data.space.profiles.display_name);
    if (typeof state.data.waiting === 'boolean') active.waitingAudio.setWaiting(state.data.waiting);
    active.client.remoteUsers.forEach(remote => {
      if (!state.data?.members.some(member => member.rtc_uid === remote.uid && member.role !== 'listener')) { active.playback.remove(remote.uid); remote.audioTrack?.stop(); }
    });
    if (state.data?.me?.role === 'speaker') active.observedSpeaker = true;
    if (active.host || !active.publishing || (state.data?.me?.can_speak !== false && !(active.observedSpeaker && state.data?.me?.role === 'listener'))) return;
    active.publishing = false; active.observedSpeaker = false;
    void (async () => {
      await active.track?.setMuted(true);
      if (active.track) await active.client.unpublish(active.track).catch(() => {});
      active.track?.close(); active.track = undefined; active.playback.setCapturing(false); active.publishing = false; setMuted(true);
      await active.client.setClientRole('audience');
      toast('リスナーに戻りました');
    })().catch(() => { void disconnect(); });
  }, [state.data, disconnect]);
  const spaceContext = useMemo(() => ({ spaces: live.data || [], joinedId: audioSession?.id, open, create }), [live.data, audioSession?.id, open, create]);
  const voiceLevel = audioSession ? Math.max(0, ...Object.entries(voiceLevels).filter(([uid]) => Number(uid) === audioSession.uid ? !muted && audioSession.publishing : !remoteMuted[Number(uid)]).map(([, value]) => value)) : 0;
  const audioContext = useMemo(() => ({ id: audioSession?.id, level: voiceLevel }), [audioSession?.id, voiceLevel]);
  return <SpaceContext.Provider value={spaceContext}><SpaceAudioLevelContext.Provider value={audioContext}>
    {children}
    <Dialog.Root key={joined ? 'live-panel' : 'space-dialog'} modal={!joined} open={modalOpen} onOpenChange={value => { if (!value && !busy) minimize(); }}>
      <Dialog.Portal>
        {!joined && <Dialog.Overlay className="lime-space-overlay" />}
        <Dialog.Content className={`lime-space-dialog ${joined ? 'lime-space-live-panel' : ''}`} aria-describedby={undefined} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy || joined) event.preventDefault(); }}>
          {creating ? <>
            <button aria-label="閉じる" disabled={busy} className="lime-space-icon" onClick={minimize}><X /></button>
            <div className="flex justify-center py-6"><SpaceIcon className="h-14 w-14 text-primary" /></div>
            <Dialog.Title className="text-2xl font-bold sm:text-3xl">スペースを作成</Dialog.Title>
            <div className="mt-7"><SpacePolicySelect value={policy} onChange={setPolicy} disabled={busy} /></div>
            <input aria-label="スペースのテーマ" className="lime-space-input mt-5 rounded-full" maxLength={100} placeholder="どのようなテーマで会話しますか？" value={title} onChange={event => setTitle(event.target.value)} disabled={busy} />
            <p className="mt-6 text-center text-sm text-muted-foreground">開始時はマイクがオフになります</p>
            <button className="lime-space-primary mt-3" disabled={busy || !title.trim()} onClick={start}>{busy ? '接続中…' : '今すぐ始める'}</button>
          </> : space && state.data ? <SpaceRoom key={space.id} space={space} data={state.data} joined={joined} host={user?.id === space.host_id} anonymous={joined ? audioSession.anonymous : anonymous} setAnonymous={setAnonymous} busy={busy} muted={muted} canSpeak={canSpeak} audioBlocked={audioBlocked} ownUid={audioSession?.uid} voiceLevels={voiceLevels} speakingUids={speakingUids} remoteMuted={remoteMuted} resumeAudio={() => { audioSession?.playback.resume(); setAudioBlocked(false); }} join={() => void join()} microphone={() => void toggleMicrophone()} share={() => void share()} minimize={minimize} leave={() => { if (audioSession?.host) setEnding(true); else void disconnect(); }} refresh={refresh} devices={devices} selectedMicrophone={selectedMicrophone} chooseMicrophone={id => void chooseMicrophone(id)} /> : <>
            <button aria-label="閉じる" className="lime-space-icon" onClick={minimize}><X /></button>
            <Dialog.Title className="mt-7 text-xl font-bold">{state.isPending ? 'スペースを読み込み中…' : 'スペース'}</Dialog.Title>
            {state.isError ? <div className="py-10 text-center"><p>スペースの取得に失敗しました</p><button className="mt-4 text-primary" onClick={() => state.refetch()}>再試行</button></div> : state.isPending ? <div role="status" className="py-16 text-center text-muted-foreground">読み込み中…</div> : <p className="py-12 text-center text-muted-foreground">このスペースは終了しました。</p>}
          </>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    <SpaceEndConfirmation open={ending} onOpenChange={setEnding} onEnd={finish} busy={busy} />
    {audioSession && !modalOpen && <div className="lime-space-mini"><button aria-label="参加中のスペース" className="min-w-0 flex-1 px-4 py-3 text-left" onClick={() => open(audioSession.id)}><span className="flex items-center gap-2 font-bold text-primary"><SpaceIcon className="h-4 w-4" />{currentRoom?.profiles.display_name || 'スペース'}</span><span className="block truncate text-sm text-muted-foreground">{currentRoom?.title || title || '参加中のスペース'}</span></button><button className="lime-space-icon" aria-label="スペースを開く" onClick={() => open(audioSession.id)}><Mic /></button><button className="lime-space-icon" aria-label={audioSession.host ? 'スペースを終了' : '退出する'} onClick={() => { if (audioSession.host) setEnding(true); else void disconnect(); }}><X /></button></div>}
  </SpaceAudioLevelContext.Provider></SpaceContext.Provider>;
}

type SpeakerPolicy = 'everyone' | 'host' | 'following';
type LiveSpace = { id: string; title: string; host_id: string; speaker_policy: SpeakerPolicy; profiles: { display_name: string; username: string; avatar_url: string } };
type SpaceMember = { id: string; display_name: string; username?: string; avatar_url: string; role: 'host' | 'speaker' | 'listener'; muted?: boolean; requested?: boolean; rtc_uid?: number };
const SpaceContext = createContext<{ spaces: LiveSpace[]; joinedId?: string; open: (id: string) => void; create: () => void }>({ spaces: [], open: () => {}, create: () => {} });
const useSpaces = () => useContext(SpaceContext);

const SpaceAudioLevelContext = createContext<{ id?: string; level: number }>({ level: 0 });

/** The audio bars and curved ring used on live avatars and the creation screen. */
function SpaceIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
    <rect x="5" y="1" width="14" height="16" rx="7" fill="currentColor" />
    <path d="M3 13a9 9 0 0 0 18 0" stroke="currentColor" strokeWidth="2.2" />
    <path d="M8.5 8v3m3.5-5v7m3.5-5v3" stroke="var(--space-icon-bars, hsl(var(--background)))" strokeWidth="1.7" strokeLinecap="round" />
  </svg>;
}

// SpacePostCard
function SpacePostCard({ content }: { content: string }) {
  const link = spaceLinkIn(content);
  const offline=useContext(OfflineBookmarkContext);
  const { open, joinedId } = useSpaces();
  const query = useQuery({ queryKey: ['space-card', link?.id], queryFn: () => spaceRpc<LiveSpace & { is_active: boolean } | null>('get_space_card', { p_space_id: link!.id }), enabled: !!link && !offline, refetchInterval: query => query.state.data?.is_active ? 15000 : false });
  const {isError,isPending}=query;
  const data=offline && link ? offline.spaces[link.id] : query.data;
  if (!link) return null;
  if (!data && (offline || (!isPending && !isError))) return <div className="lime-space-post-card is-ended"><h3>スペース</h3><p>終了しました</p></div>;
  if (!data) return <a href={link ? `https://toumeron.github.io/RaimuNoteSNS.github.io/spaces/${link.id}` : '#'} onClick={event => event.stopPropagation()} className="mt-3 block text-primary">{isError ? 'スペースを開く' : 'スペースを読み込み中…'}</a>;
  const joined = joinedId === data.id;
  return <div className={`lime-space-post-card ${!data.is_active ? 'is-ended' : ''}`} onClick={event => event.stopPropagation()}>
    <div className="lime-space-post-host"><Avatar className="h-8 w-8 border border-white/70"><AvatarImage src={data.profiles.avatar_url} /><AvatarFallback>{data.profiles.display_name.slice(0, 1)}</AvatarFallback></Avatar><span className="truncate font-bold">{data.profiles.display_name}</span><span className="lime-space-post-role">ホスト</span></div>
    <h3>{data.title}</h3>
    {!data.is_active ? <p>終了しました</p> : <button disabled={!!offline} className={joined ? 'is-joined' : ''} onClick={() => open(data.id)}><SpaceVoiceIndicator id={data.id} />{joined ? '参加済み' : 'スペースを聞く'}</button>}
  </div>;
}

function SpaceVoiceIndicator({ id }: { id: string }) {
  const audio = useContext(SpaceAudioLevelContext);
  const volume = audio.id === id ? Math.max(0, Math.min(1, audio.level)) : 0;
  return <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" aria-hidden="true" data-voice-level={volume}>{[6, 12, 18].map((x, index) => { const height = 3 + volume * (index === 1 ? 15 : 10); return <path key={x} d={`M${x} ${12 - height / 2}v${height}`} />; })}</svg>;
}

// agora
// あなたのSupabaseクライアント

const APP_ID = "72911fd8a3e344cab6964959b6e6c428"; // ここはフロントに書いてOK

const useAgora = () => {
  let client: AgoraIAgoraRTCClient | null = null;
  let localAudioTrack: AgoraIMicrophoneAudioTrack | null = null;

  const join = async (channelName: string, userId: string, role: 'host' | 'audience') => {
    const {default: AgoraRTC} = await import("agora-rtc-sdk-ng");
    client = AgoraRTC.createClient({ mode: "live", codec: "vp8" });

    // 1. Supabase Edge Functionからトークンを取得
    const { data, error } = await supabase.functions.invoke('agora-token', {
      body: { channelName, uid: userId, role }
    });

    if (error) throw error;

    // 2. 役割を設定
    await client.setClientRole(role === 'host' ? "host" : "audience");

    // 3. チャンネルに参加
    await client.join(APP_ID, channelName, data.token, userId);

    // 4. ホストならマイクを公開
    if (role === 'host') {
      localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
      await client.publish([localAudioTrack]);
    }

    // 5. 他の人の声を聞くためのリスナー
    client.on("user-published", async (user, mediaType) => {
      await client!.subscribe(user, mediaType);
      if (mediaType === "audio") {
        user.audioTrack?.play();
      }
    });

    return client;
  };

  const leave = async () => {
    localAudioTrack?.close();
    await client?.leave();
  };

  return { join, leave };
};

// SpacePage
function SpacePage() {
  const { id } = useParams();
  const spaces = useSpaces();
  const opened = useRef<string>();
  useEffect(() => {
    if (id && opened.current !== id) { opened.current = id; if (id === 'new') spaces.create(); else spaces.open(id); }
  }, [id, spaces]);
  return <div className="p-6"><h1 className="text-xl font-bold">スペース</h1><button className="mt-4 text-primary" onClick={() => id === 'new' ? spaces.create() : spaces.open(id!)}>スペースを開く</button></div>;
}

export { SpaceProvider };
export { SpaceIcon };
export type { SpeakerPolicy };
export type { LiveSpace };
export type { SpaceMember };
export { SpaceContext };
export { useSpaces };
export { SpaceAudioLevelContext };
export { SpacePolicySelect };
export { SpaceEndConfirmation };
export { SpaceRoom };
export { SPEAKER_POLICIES };
export { SpacePostCard };
export { useAgora };
export { SpacePage };
