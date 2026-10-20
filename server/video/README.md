# 投稿動画

動画・JPEGサムネイルの保存先は非公開のBackblaze B2バケットです。Supabaseは既存の認証・投稿レコードのメタデータと閲覧権限の確認にだけ使います。Cloudinary/Supabase Storageへ動画は送信しません。R2を選ぶ場合は同じWorkerに `VIDEOS` バケットをバインドできます。

- バケット: `limenote-videos-20261015` (Private)
- エンドポイント: `https://s3.us-east-005.backblazeb2.com`
- Worker: `https://limenote-videos.megayont2.workers.dev`
- ブラウザー: `VITE_VIDEO_WORKER_URL` にWorker URLを設定
- Worker secrets: `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- Worker public configuration: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ALLOWED_ORIGINS`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`

秘密キーはCloudflare DashboardのWorker設定→変数とシークレットへ直接登録します。フロントエンド環境変数、Git、ログへ入れません。Supabaseのservice-roleキーは使用しません。

## 処理

1. 既存の画像アイコンから画像または動画1本を選択。
2. 端末内で正確な長さを調べ、90秒超を拒否。Mediabunny/WebCodecsでH.264/AAC MP4・最大1920×1080（縦は1080×1920）・30fps・映像の目標2Mbps/音声96kbpsへ変換。小さい映像は拡大しない。保存上限36MiBに収まらない場合は720p、480pの順で再圧縮する。上限付近ではエンコーダーの端数用に末尾最大0.25秒を調整し、圧縮後の実ファイルも90秒以下か確認する。対応するエンコーダーがない端末では原本を送らずエラーを表示する。
3. Workerは認証・凍結状態を確認し、受け取ったファイルの映像トラック・実際の長さと解像度を再検査してから保存。元ファイルは512MB、圧縮済みは36MiB以内。
4. `posts.video` にキー・長さ・解像度等だけを保存。予約投稿も同じ列を使用。新規テーブルなし。
5. ポスターは画面近くの動画だけ取得。動画本体は再生時に取得。公開動画の再生はRangeに対応し、非公開動画は認証付きでローカルblobへ読み込み、非公開URL・トークンを共有しない。アンマウント時にblobを破棄。

動画付き投稿の削除は `DELETE /posts/:postId` で行います。Workerが本人・凍結状態と各キーの所有者/投稿IDを検証し、動画とJPEGサムネイルを削除した後、本人の認証と既存RLSで投稿レコードを削除します。B2では既存のバージョンID指定削除を使うため、非表示のファイル版を残しません。ファイル削除に失敗した場合は投稿メタデータを残し、再試行時には既に消えたファイルをスキップします。ファイル削除後のDB処理だけが失敗した場合も投稿レコードは残るため、再度削除できます。その間は動画の再生ができません。新しいテーブルや管理者キーは使用しません。

全オブジェクト取得でSupabase RLSを確認するため、投稿削除・凍結・公開範囲変更を反映します。ブラウザーにダウンロード済みのデータは取り消せません。署名付き公開URLを発行しません。

## 適用・検証

`20261015180000_post_video.sql` はDBに直接適用済み。CLIによるマイグレーション履歴のrepairは自動承認審査で拒否されたため未実行です。SQLは再実行時に列・トリガーを重複作成しません。GitHub Pagesへの公開は別途ユーザーの指示が必要です。

```
npm test --prefix server/video
npm run build --prefix server/video
node scripts/verify-media.mjs post-video
```

B2無料枠は保存10GB。無料枠を超える運用へ自動的に移行する契約や支払方法登録は行っていません。アカウント側の利用上限・転送量制限に達したときは保存・再生エラーとして扱います。

`20261015183000_post_video_1080p.sql` は既存の動画メタデータ検証関数の解像度上限だけを1080pへ変更し、DBへ適用済みです。
