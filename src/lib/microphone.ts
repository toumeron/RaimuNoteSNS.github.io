/** Request recording permission from the call button's user gesture. */
export async function requestMicrophonePermission(): Promise<void> {
  if (!window.isSecureContext) throw new Error('マイクを使うにはHTTPSでページを開いてください。');
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('この環境ではマイクを利用できません。端末のブラウザで開き直してください。');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  // SpeechRecognition captures its own audio. Do not keep a second microphone open.
  stream.getTracks().forEach(track => track.stop());
}

export function microphoneErrorMessage(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'マイクの使用が許可されていません。端末の設定でこのPWAまたはブラウザのマイク許可を確認し、必要に応じてブラウザで同じサイトを開いて許可した後、もう一度発信してください。';
  }
  if (name === 'NotFoundError') return 'マイクが見つかりません。端末のマイクや接続を確認してください。';
  if (name === 'NotReadableError') return 'マイクを使用できません。他のアプリの録音や通話を終了してから再試行してください。';
  return error instanceof Error ? error.message : 'マイクの許可を確認できませんでした。もう一度お試しください。';
}
