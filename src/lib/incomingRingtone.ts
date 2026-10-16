import { createSpaceMusic } from './spaceMusic';
import { getAudioPlaybackContext, unlockAudioPlayback } from "@/lib/callTranscription";
let music: Promise<AudioBuffer> | undefined;
function loadMusic(ctx: AudioContext): Promise<AudioBuffer> {
  music ??= createSpaceMusic()
    .then(blob => blob.arrayBuffer())
    .then(bytes => ctx.decodeAudioData(bytes))
    .catch(error => { music = undefined; throw error; });
  return music;
}
export function unlockIncomingRingtone() {
  unlockAudioPlayback();
  // Start synthesis during chat interaction, not when the random call arrives.
  try { void loadMusic(getAudioPlaybackContext()).catch(() => {}); } catch { /* No audio support. */ }
}
/** Reuse the Spaces track and decoded buffer across incoming calls. */
export function playIncomingRingtone(): () => void {
  let ctx:AudioContext;
  try { ctx=getAudioPlaybackContext(); } catch { return ()=>{}; }
  let cancelled = false;
  let source: AudioBufferSourceNode | undefined;
  const gain = ctx.createGain();
  gain.gain.value = .65;
  gain.connect(ctx.destination);
  const ready=()=>ctx.state==='running'?Promise.resolve():ctx.resume();
  let starting=false;
  const start=async()=>{
    if(cancelled||starting)return;
    starting=true;
    try {
      const [buffer]=await Promise.all([loadMusic(ctx),ready()]);
      if(cancelled||ctx.state!=='running')return;
      if(!source){source=ctx.createBufferSource();source.buffer=buffer;source.loop=true;source.connect(gain);source.start();}
    } catch { /* Retry in the next gesture if Safari interrupted playback. */ }
    finally {starting=false;}
  };
  const restore=()=>{if(!cancelled&&document.visibilityState==='visible')void start();};
  document.addEventListener('visibilitychange',restore);
  window.addEventListener('touchend',restore);
  window.addEventListener('click',restore);
  void start();
  return () => {
    if(cancelled)return;
    cancelled = true;
    document.removeEventListener('visibilitychange',restore);
    window.removeEventListener('touchend',restore);
    window.removeEventListener('click',restore);
    if (source) { source.stop(); source.disconnect(); }
    gain.disconnect();
  };
}
