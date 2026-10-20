import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import { describe, expect, it, afterEach, vi } from "vitest";
import { createSpaceMusic, SPACE_MUSIC_RATE } from "./spaceMusic";
import { SPACE_SCORE_DURATION } from "@/lib/spaceMusic";
import { SpacePlayback } from "@/lib/callRecorder";

describe("spaceMusic", () => {
it('generates and reuses a complete audible stereo loop from synthesis parameters', async () => {
  const spectrum = readFileSync(resolve("src/assets/audio/space-spectrum.gz"));
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Uint8Array(spectrum).buffer));
  const pending = createSpaceMusic(); expect(createSpaceMusic()).toBe(pending);
  const blob = await pending; expect(await createSpaceMusic()).toBe(blob); expect(blob.type).toBe('audio/wav');
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob); });
  const view = new DataView(buffer);
  expect(String.fromCharCode(...new Uint8Array(buffer, 0, 4))).toBe('RIFF');
  expect(view.getUint16(22, true)).toBe(2);
  expect(view.getUint32(24, true)).toBe(SPACE_MUSIC_RATE);
  const seconds = (buffer.byteLength - 44) / (4 * SPACE_MUSIC_RATE);
  expect(seconds).toBeCloseTo(SPACE_SCORE_DURATION, 4);
  expect(seconds).toBeCloseTo(226.22254, 4);
  expect(view.getInt16(44, true)).toBe(0);
  expect(view.getInt16(buffer.byteLength - 2, true)).toBe(0);
  let energy = 0, peak = 0, stereoDifference = 0;
  for (let offset = 44; offset < buffer.byteLength; offset += 4) {
    const left = view.getInt16(offset, true) / 32768, right = view.getInt16(offset + 2, true) / 32768;
    energy += left * left + right * right; peak = Math.max(peak, Math.abs(left), Math.abs(right));
    stereoDifference += (left - right) ** 2;
  }
  expect(Math.sqrt(energy / ((buffer.byteLength - 44) / 2))).toBeGreaterThan(.02);
  expect(peak).toBeLessThan(1);
  expect(stereoDifference).toBeGreaterThan(1);
}, 30000);
});

describe("spacePlayback", () => {
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
});

describe("audioPlayback", () => {
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('primes and resumes output in the original gesture and shares it between ringing and speech',async()=>{
 vi.resetModules();const start=vi.fn(),resume=vi.fn().mockResolvedValue(undefined),created=vi.fn();
 class Context{state='suspended';sampleRate=44100;destination={};constructor(){created();}resume=resume;createBuffer=vi.fn(()=>({}));createBufferSource=()=>({buffer:null,connect:vi.fn(),disconnect:vi.fn(),start,onended:null});}
 vi.stubGlobal('AudioContext',Context);const session={type:'auto'};Object.defineProperty(navigator,'audioSession',{configurable:true,value:session});
 const audio=await import("@/lib/callRecorder");audio.unlockAudioPlayback();
 expect(start).toHaveBeenCalledWith(0);expect(resume).toHaveBeenCalledOnce();expect(session.type).toBe('playback');
 expect(audio.getAudioPlaybackContext()).toBe(audio.getAudioPlaybackContext());expect(created).toHaveBeenCalledOnce();
 delete (navigator as any).audioSession;
});
});
