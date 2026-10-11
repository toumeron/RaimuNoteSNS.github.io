# Welcome to your Lovable project

TODO: Document your project here

## データベース

保存先とテーブルの用途は [データベースの保存先一覧](docs/database.md) にまとめています。プロフィール情報を追加する前に、既存の `profiles` / `profile_private_settings` のカラムで表現できるかを確認してください。

## ファイル整理とテスト出力

小さな補助関数・表示部品は、同じ機能を扱う既存のファイルにまとめています。推薦の判定・行動シグナルは `src/lib/recommendationSignals.ts`、プロフィールの投稿処理は `src/lib/profileReplyThreads.ts`、タイムラインのページ処理は `src/lib/timelinePaging.ts`、公開メディアのアップロードは `src/lib/uploadPostMedia.ts` を参照してください。対応する単体テストも機能単位でまとめ、各テストの検証内容は維持しています。

ブラウザテストの画像・ログは生成物です。`artifacts/`、`test-results/`、`playwright-report/` は Git に登録しません。確認が終わった生成物は削除してください。アプリが使用する `public/` の画像と、説明文書から参照する画像は保存対象です。

短さだけを理由に統合せず、独立した読み込み・認証・配備の境界が必要なファイルは分けて管理します。
