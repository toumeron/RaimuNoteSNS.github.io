let context:AudioContext|undefined;
/** Use one output session for friend speech, ringing and call waiting. */
export function configureAudioPlayback() {
  try {
    const session=(navigator as Navigator & {audioSession?:{type:string}}).audioSession;
    if(session&&session.type!=='playback')session.type='playback';
  } catch { /* Older Safari does not implement Audio Session. */ }
}
export function getAudioPlaybackContext():AudioContext {
  configureAudioPlayback();
  const Constructor=window.AudioContext||(window as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
  if(!Constructor)throw new Error('このブラウザではAI音声を再生できません。');
  if(!context||context.state==='closed')context=new Constructor();
  return context;
}
/** Must run synchronously from a tap, before microphone/network awaits. */
export function unlockAudioPlayback() {
  try {
    const ctx=getAudioPlaybackContext();
    if(ctx.state!=='running'&&typeof ctx.createBuffer==='function'){
      const source=ctx.createBufferSource();source.buffer=ctx.createBuffer(1,1,ctx.sampleRate||44100);
      source.connect(ctx.destination);source.onended=()=>source.disconnect();source.start(0);
    }
    void ctx.resume().catch(()=>{});
  } catch { /* Playback will report errors through the existing call UI. */ }
}
