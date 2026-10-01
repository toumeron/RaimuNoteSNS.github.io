/** Safari exposes SpeechRecognition even in installed apps where it cannot start reliably. */
export function preferRecordedCallSpeech(): boolean {
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
    || window.matchMedia?.('(display-mode: standalone)').matches === true;
  return ios && standalone;
}

export function callAudioFilename(type: string): string {
  if (/mp4|m4a/i.test(type)) return 'call.m4a';
  if (/wav/i.test(type)) return 'call.wav';
  if (/ogg/i.test(type)) return 'call.ogg';
  return 'call.webm';
}

type TranscriptionRequest = {
  url: string;
  apiKey: string;
  accessToken: string;
  audio: Blob;
  lang: string;
  signal: AbortSignal;
};

export async function requestCallTranscription(request: TranscriptionRequest, fetcher = fetch): Promise<string> {
  if (!request.audio.size) throw new Error('録音データが空です。マイクをオンにしてもう一度話してください。');
  const audio = /^audio\/(?:x-)?m4a(?:;|$)/i.test(request.audio.type)
    ? new Blob([request.audio], { type: 'audio/mp4' }) : request.audio;
  const form = new FormData();
  form.append('audio', audio, callAudioFilename(audio.type));
  form.append('language', request.lang.split('-')[0]);
  const response = await fetcher(request.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${request.accessToken}`, apikey: request.apiKey },
    body: form,
    signal: request.signal,
  });
  const result: unknown = await response.json().catch(() => null);
  const data = result && typeof result === 'object' ? result as Record<string, unknown> : {};
  if (!response.ok) {
    if (response.status === 404) throw new Error('通話の音声認識サーバーが見つかりません。管理者による設定が必要です。');
    if (response.status === 401 || response.status === 403) throw new Error('ログインの有効期限が切れています。ログインし直してから発信してください。');
    if (typeof data.error === 'string') throw new Error(data.error);
    if (response.status === 429) throw new Error('音声認識が混み合っています。少し待って再試行してください。');
    throw new Error(`音声認識サーバーとの通信に失敗しました（${response.status}）。もう一度お試しください。`);
  }
  if (typeof data.text !== 'string') throw new Error('音声認識サーバーから正しい応答を受け取れませんでした。');
  return data.text;
}
