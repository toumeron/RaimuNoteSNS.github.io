import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { Mic, X } from 'lucide-react';
import { toast } from 'sonner';
import type { IAgoraRTCClient, IMicrophoneAudioTrack } from 'agora-rtc-sdk-ng';
import { useAuth } from '@/hooks/useAuth';
import { requestMicrophonePermission, microphoneErrorMessage } from '@/lib/microphone';
import { getLiveSpaces, getSpaceState, getSpaceToken, spaceRpc } from '@/api/spaces';
import { SpaceContext, type SpeakerPolicy } from './SpaceContext';
import { SpaceRoom, SpaceEndConfirmation, SpacePolicySelect } from './SpaceRoom';
import './spaces.css';
import { SpaceIcon } from './SpaceIcon';

type AudioSession = { id: string; uid: number; userId: string; anonymous: boolean; host: boolean; publishing: boolean; client: IAgoraRTCClient; track?: IMicrophoneAudioTrack; restoreAutoplay: () => void; observedSpeaker?: boolean };

export function SpaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const live = useQuery({ queryKey: ['live-spaces'], queryFn: getLiveSpaces, refetchInterval: 15000, retry: 1 });
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
  const [muted, setMuted] = useState(true);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const session = useRef<AudioSession | null>(null);
  const operation = useRef(false);
  const generation = useRef(0);
  const inspectedId = selected || audioSession?.id;
  const state = useQuery({ queryKey: ['space', inspectedId], queryFn: () => getSpaceState(inspectedId!), enabled: !!inspectedId, refetchInterval: 3000, retry: 1 });
  const space = state.data?.space;

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['live-spaces'] });
    void queryClient.invalidateQueries({ queryKey: ['space'] });
  }, [queryClient]);

  const disconnect = useCallback(async (notifyServer = true) => {
    generation.current++;
    const active = session.current;
    session.current = null;
    setAudioSession(null);
    setMuted(true);
    setAudioBlocked(false);
    if (active) {
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
        const current = await getSpaceState(audioSession.id);
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
  }, [audioSession, disconnect]);

  const open = (id: string) => { setCreating(false); setAnonymous(false); setSelected(id); };
  const create = () => {
    if (!user) { toast.error('ログインしてください'); return; }
    if (session.current) { open(session.current.id); return; }
    setSelected(null); setCreating(true); setTitle(''); setPolicy('host');
  };

  const connect = async (id: string, host: boolean, hidden: boolean, microphonePermission?: Promise<void>) => {
    const stamp = generation.current;
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
      client.on('user-published', async (remote, type) => {
        if (type !== 'audio' || !client) return;
        try {
          const roster = await getSpaceState(id);
          if (!roster.members.some(member => member.rtc_uid === remote.uid && member.role !== 'listener')) return;
          if (stamp !== generation.current) return;
          await client.subscribe(remote, 'audio'); remote.audioTrack?.play();
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
      const active = { id, uid: member.rtc_uid, userId: user!.id, anonymous: member.anonymous, host, publishing: host, client, track, restoreAutoplay };
      session.current = active;
      setAudioSession(active); setMuted(true); refresh();
    } catch (error) {
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
    const permission = requestMicrophonePermission();
    try {
      await permission;
      if (stamp !== generation.current) throw new Error('接続を中止しました');
      const id = await spaceRpc<string>('create_live_space', { p_title: title.trim(), p_policy: policy });
      if (stamp !== generation.current) { await spaceRpc('leave_live_space', { p_space_id: id }).catch(() => {}); throw new Error('接続を中止しました'); }
      await connect(id, true, false);
      setCreating(false); setSelected(id);
    } catch (error) { toast.error(microphoneErrorMessage(error)); }
    finally { operation.current = false; setBusy(false); }
  };

  const join = async () => {
    if (operation.current || !space) return;
    if (!user) { toast.error('ログインしてください。匿名リスニングもログイン後に利用できます。'); return; }
    if (session.current && session.current.id !== space.id) { toast.error('参加中のスペースを退出してから参加してください。'); return; }
    const host = user.id === space.host_id;
    operation.current = true; setBusy(true);
    const permission = host ? requestMicrophonePermission() : undefined;
    try { await connect(space.id, host, anonymous, permission); }
    catch (error) { toast.error(microphoneErrorMessage(error)); }
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
        await track.setMuted(true);
        await active.client.publish(track);
        active.publishing = true;
      }
      if (session.current !== active) return;
      await active.track.setMuted(!muted);
      setMuted(!muted);
      await spaceRpc('set_space_microphone', { p_space_id: active.id, p_muted: !muted }); refresh();
    } catch (error) {
      if (!active.publishing && session.current === active) {
        active.track?.close(); active.track = undefined;
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
    if (!active || active.id !== state.data?.space?.id) return;
    active.client.remoteUsers.forEach(remote => {
      if (!state.data?.members.some(member => member.rtc_uid === remote.uid && member.role !== 'listener')) remote.audioTrack?.stop();
    });
    if (state.data?.me?.role === 'speaker') active.observedSpeaker = true;
    if (active.host || !active.publishing || (state.data?.me?.can_speak !== false && !(active.observedSpeaker && state.data?.me?.role === 'listener'))) return;
    active.publishing = false; active.observedSpeaker = false;
    void (async () => {
      await active.track?.setMuted(true);
      if (active.track) await active.client.unpublish(active.track).catch(() => {});
      active.track?.close(); active.track = undefined; active.publishing = false; setMuted(true);
      await active.client.setClientRole('audience');
      toast('リスナーに戻りました');
    })().catch(() => { void disconnect(); });
  }, [state.data, disconnect]);
  return <SpaceContext.Provider value={{ spaces: live.data || [], open, create }}>
    {children}
    <Dialog.Root key={joined ? 'live-panel' : 'space-dialog'} modal={!joined} open={modalOpen} onOpenChange={value => { if (!value && !busy) minimize(); }}>
      <Dialog.Portal>
        {!joined && <Dialog.Overlay className="lime-space-overlay" />}
        <Dialog.Content className={`lime-space-dialog ${joined ? 'lime-space-live-panel' : ''}`} aria-describedby={undefined} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy || joined) event.preventDefault(); }}>
          {creating ? <>
            <button aria-label="閉じる" disabled={busy} className="lime-space-icon" onClick={minimize}><X /></button>
            <div className="flex justify-center py-6"><SpaceIcon className="h-14 w-14 text-violet-500" /></div>
            <Dialog.Title className="text-2xl font-bold sm:text-3xl">スペースを作成</Dialog.Title>
            <div className="mt-7"><SpacePolicySelect value={policy} onChange={setPolicy} disabled={busy} /></div>
            <input aria-label="スペースのテーマ" className="lime-space-input mt-5 rounded-full" maxLength={100} placeholder="どのようなテーマで会話しますか？" value={title} onChange={event => setTitle(event.target.value)} disabled={busy} />
            <p className="mt-6 text-center text-sm text-muted-foreground">開始時はマイクがオフになります</p>
            <button className="lime-space-primary mt-3" disabled={busy || !title.trim()} onClick={start}>{busy ? '接続中…' : '今すぐ始める'}</button>
          </> : space && state.data ? <SpaceRoom key={space.id} space={space} data={state.data} joined={joined} host={user?.id === space.host_id} anonymous={joined ? audioSession.anonymous : anonymous} setAnonymous={setAnonymous} busy={busy} muted={muted} canSpeak={canSpeak} audioBlocked={audioBlocked} resumeAudio={() => { audioSession?.client.remoteUsers.forEach(remote => remote.audioTrack?.play()); setAudioBlocked(false); }} join={() => void join()} microphone={() => void toggleMicrophone()} share={() => void share()} minimize={minimize} leave={() => { if (audioSession?.host) setEnding(true); else void disconnect(); }} refresh={refresh} devices={devices} selectedMicrophone={selectedMicrophone} chooseMicrophone={id => void chooseMicrophone(id)} /> : <>
            <button aria-label="閉じる" className="lime-space-icon" onClick={minimize}><X /></button>
            <Dialog.Title className="mt-7 text-xl font-bold">{state.isPending ? 'スペースを読み込み中…' : 'スペース'}</Dialog.Title>
            {state.isError ? <div className="py-10 text-center"><p>スペースの取得に失敗しました</p><button className="mt-4 text-violet-500" onClick={() => state.refetch()}>再試行</button></div> : state.isPending ? <div role="status" className="py-16 text-center text-muted-foreground">読み込み中…</div> : <p className="py-12 text-center text-muted-foreground">このスペースは終了しました。</p>}
          </>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    <SpaceEndConfirmation open={ending} onOpenChange={setEnding} onEnd={finish} busy={busy} />
    {audioSession && !modalOpen && <div className="lime-space-mini"><button aria-label="参加中のスペース" className="min-w-0 flex-1 px-4 py-3 text-left" onClick={() => open(audioSession.id)}><span className="flex items-center gap-2 font-bold text-violet-500"><SpaceIcon className="h-4 w-4" />{currentRoom?.profiles.display_name || 'スペース'}</span><span className="block truncate text-sm text-muted-foreground">{currentRoom?.title || title || '参加中のスペース'}</span></button><button className="lime-space-icon" aria-label="スペースを開く" onClick={() => open(audioSession.id)}><Mic /></button><button className="lime-space-icon" aria-label={audioSession.host ? 'スペースを終了' : '退出する'} onClick={() => { if (audioSession.host) setEnding(true); else void disconnect(); }}><X /></button></div>}
  </SpaceContext.Provider>;
}
