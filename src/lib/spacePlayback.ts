import type { IRemoteAudioTrack } from 'agora-rtc-sdk-ng';

type AudioNavigator = Navigator & { audioSession?: { type: string } };
/** Native audio sinks and system controls survive minimization and route changes. */
export class SpacePlayback {
  private players = new Map<string, HTMLAudioElement>();
  private paused = false;
  private closed = false;
  private metadata?: MediaMetadata;
  private previousType = (navigator as AudioNavigator).audioSession?.type;
  private assignedType?: string;
  constructor(private onBlocked: () => void, private pauseWaiting: () => void, private resumeWaiting: () => void) {}
  setCapturing(capturing: boolean) {
    const audioSession = (navigator as AudioNavigator).audioSession;
    if (!audioSession) return;
    try { this.assignedType = capturing ? 'play-and-record' : 'playback'; audioSession.type = this.assignedType; } catch { /* Unsupported browser. */ }
  }
  describe(title: string, host: string) {
    if (!navigator.mediaSession || typeof MediaMetadata === 'undefined' || this.closed) return;
    if (this.metadata?.title === title && this.metadata.artist === host) return;
    this.metadata = new MediaMetadata({ title, artist: host, album: 'LimeNote スペース' });
    navigator.mediaSession.metadata = this.metadata;
    for (const [action, handler] of [['play', () => this.resume()], ['pause', () => this.pause()], ['stop', () => this.pause()]] as const) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Platform-dependent controls. */ }
    }
    navigator.mediaSession.playbackState = this.paused ? 'paused' : 'playing';
  }
  attach(uid: string | number, track: IRemoteAudioTrack) {
    if (this.closed) return;
    this.remove(uid);
    const audio = new Audio();
    audio.hidden = true; audio.autoplay = false; audio.dataset.limeSpaceVoice = String(uid);
    audio.srcObject = new MediaStream([track.getMediaStreamTrack()]);
    document.body.append(audio); this.players.set(String(uid), audio);
    if (!this.paused) this.play(audio);
  }
  private play(audio: HTMLAudioElement) { void audio.play().catch(() => { if (!this.closed && !this.paused) this.onBlocked(); }); }
  remove(uid: string | number) {
    const audio = this.players.get(String(uid));
    if (!audio) return;
    audio.pause(); audio.srcObject = null; audio.remove(); this.players.delete(String(uid));
  }
  pause() {
    this.paused = true; this.pauseWaiting(); this.players.forEach(audio => audio.pause());
    if (navigator.mediaSession?.metadata === this.metadata) navigator.mediaSession.playbackState = 'paused';
  }
  resume() {
    if (this.closed) return;
    this.paused = false; this.resumeWaiting(); this.players.forEach(audio => this.play(audio));
    if (navigator.mediaSession?.metadata === this.metadata) navigator.mediaSession.playbackState = 'playing';
  }
  close() {
    if (this.closed) return;
    this.closed = true; [...this.players.keys()].forEach(uid => this.remove(uid));
    if (this.metadata && navigator.mediaSession?.metadata === this.metadata) {
      navigator.mediaSession.metadata = null;
      for (const action of ['play', 'pause', 'stop'] as const) try { navigator.mediaSession.setActionHandler(action, null); } catch { /* Unsupported control. */ }
      navigator.mediaSession.playbackState = 'none';
    }
    const audioSession = (navigator as AudioNavigator).audioSession;
    if (audioSession && this.previousType && audioSession.type === this.assignedType) try { audioSession.type = this.previousType; } catch { /* Unsupported mode. */ }
  }
}
