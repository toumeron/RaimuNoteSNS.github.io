/** Attach an HLS stream only when playback is requested; abort releases buffers and requests. */
export async function attachHls(media: HTMLVideoElement, url: string, signal: AbortSignal, onError: (message: string) => void) {
 const check = () => { if (signal.aborted) throw new DOMException('Aborted', 'AbortError'); };
 check();
 const {default: Hls, FetchLoader} = await import('hls.js');
 check();
 if (!Hls.isSupported()) {
  if (media.canPlayType('application/vnd.apple.mpegurl')) { media.src = url; return; }
  throw new Error('このブラウザーでは動画を再生できません');
 }
 const hls = new Hls({maxBufferLength: 20, maxMaxBufferLength: 30, loader: FetchLoader, fetchSetup: (context, init) => new Request(context.url, {...init, referrerPolicy:'no-referrer'})});
 const destroy = () => hls.destroy();
 signal.addEventListener('abort', destroy, {once:true});
 await new Promise<void>((resolve,reject) => {
  const abort = () => reject(new DOMException('Aborted','AbortError'));
  const finish = () => { signal.removeEventListener('abort',abort); resolve(); };
  signal.addEventListener('abort',abort,{once:true});
  hls.on(Hls.Events.MANIFEST_PARSED,finish);
  hls.on(Hls.Events.ERROR,(_event,data) => {
   if (!data.fatal || signal.aborted) return;
   signal.removeEventListener('abort',abort);
   destroy();
   const message='動画を読み込めませんでした'; onError(message); reject(new Error(message));
  });
  hls.attachMedia(media);
  hls.loadSource(url);
 });
}
