import { afterEach, expect, it, vi } from 'vitest';
import { SpacePlayback } from './spacePlayback';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
it('owns native voice players without closing SDK tracks, preserves pause and releases system controls', () => {
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.stubGlobal('MediaStream', class { constructor(public tracks: unknown[]) {} });
  vi.stubGlobal('MediaMetadata', class { constructor(values: object) { Object.assign(this, values); } });
  const mediaSession = { metadata: null, playbackState: 'none', setActionHandler: vi.fn() }, audioSession = { type: 'auto' };
  vi.stubGlobal('navigator', { mediaSession, audioSession });
  const pause = vi.fn(), resume = vi.fn(), track = { getMediaStreamTrack: () => ({}), stop: vi.fn() };
  const player = new SpacePlayback(vi.fn(), pause, resume); player.setCapturing(false); player.describe('会話', 'ホスト');
  player.attach(42, track as any); expect(document.querySelectorAll('audio')).toHaveLength(1); expect(play).toHaveBeenCalledTimes(1);
  player.pause(); player.attach(43, track as any); expect(play).toHaveBeenCalledTimes(1); expect(pause).toHaveBeenCalledTimes(1);
  player.resume(); expect(play).toHaveBeenCalledTimes(3); expect(resume).toHaveBeenCalledTimes(1);
  player.setCapturing(true); expect(audioSession.type).toBe('play-and-record');
  player.close(); expect(document.querySelector('audio')).toBeNull(); expect(track.stop).not.toHaveBeenCalled();
  expect(mediaSession.metadata).toBeNull(); expect(audioSession.type).toBe('auto');
});
it('does not clear metadata belonging to a newer player', () => {
  const mediaSession = { metadata: null as unknown, playbackState: 'none', setActionHandler: vi.fn() };
  vi.stubGlobal('MediaMetadata', class { constructor(values: object) { Object.assign(this, values); } });
  vi.stubGlobal('navigator', { mediaSession });
  const player = new SpacePlayback(vi.fn(), vi.fn(), vi.fn()); player.describe('会話', 'ホスト');
  const replacement = {}; mediaSession.metadata = replacement; player.close(); expect(mediaSession.metadata).toBe(replacement);
});
