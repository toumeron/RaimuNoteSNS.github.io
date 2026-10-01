# モバイルPWAのチャット・通話回帰テスト

実行: `npx playwright test --config tests/mobile-chat/playwright.config.ts`

本番のChatPageとCallSessionProviderをローカルで描画し、390×844の画面で確認する。
マイクAPI・認証・ネットワークはモック。下部ナビの実測値に相当する98px（セーフエリアを含む）を与え、入力欄の重なり、動的な高さ変更、キーボード表示・解除、フレンド発信時の許可要求、縮小後のページ往復と終了を検証する。
実機のOS許可ダイアログ、Safariの音声再生、実音声の認識品質は実機確認が必要。

# 本番反映

フロントエンドの更新と併せて `supabase functions deploy transcribe-call` を実行する。
既存のchat-gemmaと同じ `GROQ_API_KEY`、Supabaseの組み込み環境変数を使用する。
この関数はブラウザのSpeechRecognitionが未提供・利用不可の場合に呼ばれる。
ログイン済みユーザーのみ利用可能。録音は1発話ごと（無音1秒または最大20秒）に区切り、文字起こしに必要な音声をGroqへ送る。アプリのDB・Storageに音声は保存しない。
通話終了、ミュート、発話処理の中断時にマイク、AudioContext、クライアントの通信を停止する。

本番PWAはHTTPSで開き、初回許可・拒否後の再試行・フレンド通話の縮小とページ往復・キーボードと端末の向き変更をiOS/Androidの実機で確認する。
