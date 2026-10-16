# 通知機能

通知はイベントを起点に生成・配信する。通知確認と履歴削除のポーリング用Cronは使用しない。旧ジョブ `lime-external-post-notifications` と `lime-notification-expiry` は廃止している。

外部SNSの通知方式は再検討中。`server/external-notifications.mjs` と `server/cloudflare/` は未採用・未配置の試作であり、常時接続を必須条件としない。有料サービス・定期確認は利用しない。外部SNSの即通知は本番で稼働していない。

公式の通知機能として、Blueskyには認証が必要な `app.bsky.notification.putActivitySubscription` と `registerPush`、Misskeyには認証が必要な `following/update` と `sw/register` がある。Misskeyのフォロー先通知は既存のフォロー関係も必要。現在のLimeNoteの外部ユーザー用ベルは各SNSへのログインなしでクラウドに対象を保存するため、これらの公式通知登録へそのまま置き換えることはできない。公式PushをLimeNoteで受け取り、通知履歴へ反映する具体的な対応も未検証。

参考: [Bluesky投稿通知登録](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/notification/putActivitySubscription.json)、[Bluesky Push登録](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/notification/registerPush.json)、[Misskeyフォロー先通知設定](https://github.com/misskey-dev/misskey/blob/develop/packages/backend/src/server/api/endpoints/following/update.ts)、[Misskey Push登録](https://github.com/misskey-dev/misskey/blob/develop/packages/backend/src/server/api/endpoints/sw/register.ts)。

## 保存先

新しいアプリ用テーブルは作らない。

- `notifications`: メンション、新着ポスト、返信、いいね、リポスト、リアクション、フォロー。ユーザー名・認証状態・画像、返信ID、外部ポストID、重複防止キー、30日後の期限を保持する。
- `post_notification_subscriptions`: LimeNoteのUUIDとBluesky・Misskeyのハンドルを同じ既存テーブルで管理する。外部ユーザーの確認日時と確認済みポストもここに保存する。
- `profile_private_settings.notification_preferences`: 種類ごとの通知ON/OFFと端末へのPush通知ON/OFF。RPCは1項目だけを更新し、他の設定を上書きしない。

既存ユーザーの未設定項目はON。OFFは今後の通知生成を抑制する。PushだけOFFにしても通知ページへの通知は生成する。

## イベントで通知を作る

LimeNote内の操作はDBのINSERTトリガーで通知を作成する。新着ポスト、メンション、返信、ポスト・返信へのいいね、リポスト、リアクション、フォローが対象。操作時に通知を作成し、既存のDB RealtimeとPush送信トリガーで配信する。定期確認はない。自分自身への操作は通知しない。同じ操作の解除・再実行や再試行で通知を重複させない。

未採用の試作プロセスはBluesky JetstreamとMisskeyの公開Streaming APIをWebSocketで受信する。通知対象の投稿イベントを受信すると、フィードAPIの次の更新を待たずに既存の `record_external_post_notifications` RPCへ渡す。対象外の投稿、返信、単純なリポスト、購読開始前の投稿を除外する。

購読の追加・解除は既存テーブルのDB Realtimeイベントで反映する。投稿確認用の `setInterval` やCronは使わない。接続エラー時のみ待機して再接続し、起動・接続復旧・購読追加時には取りこぼしを補うためAPIを一度取得する。DB書き込み失敗時は受信済みのイベントを再試行する。DBの一意キーが重複を防ぐ。

Misskeyは固定の `misskey.io` に接続する。他サーバーのユーザーはmisskey.io側のフェデレーション情報を使うため、連合元からの到着までの遅延は残る。ストリームやPush通信自体のネットワーク遅延をゼロにする保証はない。

## 通知ページと設定

既存の `Header` に「通知」と「すべて」「メンション」のタブを統合する。設定ボタンは置かない。タブ下線の切り替えは検索ページの `SearchTabIndicator` を共有する。区切り線はコンテンツ列の全幅に表示する。同じ日・同じポストの同種の操作はまとめて表示し、50件ずつ読み込む。

設定のLimeProと背景の間に通知設定を配置する。周囲と同じ `rounded-3xl border border-border/60 bg-card p-5 shadow-soft` のカードとし、内部は項目名とスイッチにする。新着ポスト通知の対象ユーザー一覧はLimeNote・Bluesky・Misskeyを表示し、個別に解除できる。設定と購読はクラウドに保存する。

## 期限・既読・配信

通知履歴は作成から30日間表示する。RLSで期限切れを表示・未読件数から除外する。新規通知INSERT時に、期限切れの履歴を期限用インデックスで削除する。定期削除はないため、新規通知がない期間には期限切れレコードが物理的に残るが、画面や未読件数には含まれない。

既読保存後はDBの実際の未読件数を取得し、アプリと端末のバッジを更新する。通知クリックでも該当通知を既読にする。アプリ内一時通知は5秒、端末通知は30秒で閉じる処理を行う。ブラウザーがService Workerを停止した場合には端末通知のタイマーを保証できないため、次のPush受信や既読連絡でも期限切れ通知を閉じる。

DBのPush送信トリガーは1つに整理した。専用の秘密情報をVaultとEdge Functionで共有する。外部購読テーブルにはサーバー用のSELECTと `last_checked_at` のUPDATE権限だけを追加した。

## バックエンドの構成

通知機能は次のマイグレーションで定義する。

- `20261008210000_notification_preferences_and_activity.sql`
- `20261008213000_notification_delivery_and_expiry.sql`
- `20261008220000_external_notification_worker_permissions.sql`
- `20261008223000_notification_event_delivery.sql`

`send-push` と `check-external-notifications` のEdge Functionも公開済み。後者の定期実行は解除済み。`scripts/install-external-notification-cron.mjs` は旧ファイル名を維持しているが、現在は秘密情報の設定と旧ジョブの解除を行うだけで、Cronを登録しない。

## 未採用の常駐受信プロセスの参考手順

この方式は未採用の試作である。Node.js 24以降と、このリポジトリの `@supabase/supabase-js` が必要。

1. サーバー専用の環境変数 `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` を設定する。Service Role Keyをブラウザー・ソース・公開ファイルへ含めない。
2. `node server/external-notifications.mjs` を1プロセス起動する。
3. Linuxの場合は `server/external-notifications.service` を実際のユーザー・配置先・Nodeパスへ合わせて使用できる。再起動はプロセス障害時だけであり、定期ジョブではない。
4. 通知ONの外部ユーザーが投稿した際のDB生成、ページへの反映、実端末のPush配信を確認する。購読解除と種類別OFFも確認する。

## 検証

- `node scripts/notifications-db-test.mjs`
- `node --test server/*.test.mjs`
- `npx vitest run src/api/notifications.test.ts src/lib/externalNotificationSources.test.ts src/lib/notificationDelivery.test.ts src/lib/registerPwa.test.ts`
- `deno test --allow-env supabase/functions/check-external-notifications/handler_test.ts`
- `npx playwright test -c tests/profile-highlights/playwright.config.ts --workers=1`
- `npx tsc --noEmit -p tsconfig.app.json` と `npm run build`

ブラウザーテストは開発サーバーとAPI応答のフィクスチャを使う。外部SNSから実端末までのPush配信は、このテストの対象に含まれない。
