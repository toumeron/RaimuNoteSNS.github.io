# AIチャットのFish Audio音声

AIチャットのメッセージ読み上げ、ボイスモード（テスト・履歴再生を含む）、
アシスタント通話はすべて `synthesize-speech` Edge Functionを通じて
Fish Audio `s2.1-pro-free` で音声を生成します。既定は日本語の「落ち着いた女性」
（`0089dce5fefb4c6ba9b9f2f0debe1ddc`）です。
24 kHz / 16-bit / monoのPCMをストリーミングし、音声全体を待たずに受信部分から再生します。ブラウザ標準TTSへのフォールバックはありません。
マイクの音声認識と呼び出し音は従来の機能を使用します。

## 有効化

1. [Fish Audio API Keys](https://fish.audio/app/api-keys)でAPIキーを取得します。
2. Supabase Dashboardの対象プロジェクト → Edge Functions → Secretsで
   `FISH_AUDIO_API_KEY` を登録します。`VITE_` で始まる変数やブラウザの設定にキーを入れないでください。
3. リンク済みの対象Supabaseプロジェクトに関数をデプロイします。

   ```sh
   
   ```

4. フロントエンドを通常の手順でビルド・反映し、ログイン後、
   AIチャット → ボイスモード → 設定 → テスト再生で実音声を確認します。

APIキー未設定のときは設定未完了のエラーを表示します。APIキーを保存しただけでは、
新しい関数のデプロイは完了しません。

ローカルSupabaseでは `supabase/.env` にサーバー用のキーを設定し、
`supabase functions serve synthesize-speech --env-file supabase/.env` を使用します。
フロントエンドの接続先もローカルSupabaseに合わせてください。

## 声の選択

- 既定の声: [落ち着いた女性](https://fish.audio/ja/app/m/0089dce5fefb4c6ba9b9f2f0debe1ddc/)。
  メッセージ読み上げ・ボイスモード・アシスタント通話のすべてに使います。
- ボイスモードの「声」: カスタムIDを入力できます。空欄なら「落ち着いた女性」を使います。
  「落ち着いた女性に戻す」ボタンでも戻せます。
- APIキー以外のSecrets設定は不要です。以前の男性・女性別のSecretsはこの実装では使用しません。

速度は生成APIの `prosody.speed`、音量は再生側のGainNodeで調整します。
ブラウザ音声専用のピッチ設定は廃止しました。旧ボイスURIは読み込み時にリセットします。
アバターの口の形と字幕位置は音声の再生時間に合わせた推定であり、音素アラインメントではありません。
長文は最大600文字ずつ生成します。各区切り内は受信しながら再生しますが、
区切り間には次の音声生成の待ち時間が入る場合があります。
APIは `chunk_length: 100`、`latency: balanced` を使用します。

## 確認

```sh
npm test -- --run src/lib/aiSpeech.test.ts src/hooks/useAuth.test.tsx
deno check supabase/functions/synthesize-speech/index.ts
npx playwright test tests/avatar/avatars.spec.ts --grep 'Fish AI audio'
npm run build
```

ブラウザテストは認証と音声APIをモックし、無音PCMのストリーミング再生、
口の開閉、ボイスID、設定エラー、ブラウザTTSを使用しないことを確認します。
Fish Audioで生成する実音声の音質や遅延は、APIキーを設定してから確認する必要があります。

## 公式資料

- [TTS API](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech)
- [S2.1 Pro Free](https://fish.audio/blog/s2-1-pro-free-api/)

2026年10月1日時点の公式案内では無料提供期間は2026年11月30日までです。
Fair Useの条件があり、将来の期間・条件は公式資料で確認してください。
実装はモデルを明示し、有料モデルへの自動切り替えを行いません。
