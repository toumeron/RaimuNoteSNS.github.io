# データベースの保存先一覧

最初にこの資料を参照してください。公開プロフィールは `profiles`、本人専用設定は `profile_private_settings` に集約します。1アカウントに複数件あるポスト・関係・操作履歴は関連テーブルとして管理します。

## プロフィール・アカウント

| 保存先 | 内容 | 参照・更新コード |
| --- | --- | --- |
| `profiles` | 名前、自己紹介、画像、任意の所在地、登録日、固定ポスト、国情報、接続元、ユーザー名変更回数・日時 | `src/api/users.ts`、`src/api/profile-pins.ts`、`src/api/account-about.ts` |
| `profile_private_settings` | 非公開のBot指示と外部ユーザー一覧の移行済み日時。本人だけが読める | `src/lib/privateProfile.ts`、`import_external_account_users` RPC、`supabase/functions/post-bot/index.ts` |
| `profile_highlights` | ハイライトしたポストの一覧。1ユーザーが複数件を持ち、ポストの公開範囲を適用する | `src/api/profile-highlights.ts`、`src/api/posts.ts` |
| `external_account_users` | Bluesky・Misskeyの追加済みユーザー一覧。本人専用、1ユーザーが複数件を持つ | `src/lib/externalAccounts.ts` |

`profiles.pinned_post_id` は固定ポスト1件を示す外部キーです。ポストを削除するとNULLになり、他人のポストを固定する更新はDBで拒否します。

国情報は `country_code` / `connection_source` / `connection_updated_at`、変更履歴は `username_change_count` / `last_username_change_at` / `username_tracking_since` に保存します。履歴カラムの直接変更は拒否し、国情報は本人確認をする `update_account_connection` RPCから更新します。国判定の有効・無効は `VITE_ACCOUNT_COUNTRY_LOOKUP_ENABLED` で管理します。

非公開データを `profiles` に入れないでください。公開プロフィールは第三者や匿名ユーザーにも読まれます。Bot指示や追加済みユーザー一覧は本人専用の保存先を使います。

## その他の機能別テーブル

| 機能 | テーブル | 主なコード・確認先 |
| --- | --- | --- |
| 投稿・返信 | `posts`, `comments` | `src/api/posts.ts`、`src/api/comments.ts` |
| リポスト | `reposts`, `reply_reposts`, `external_reposts` | `src/api/posts.ts`、対応する `supabase/migrations/` |
| いいね | `likes`, `comment_likes` | `src/api/posts.ts`、`src/api/comments.ts` |
| リアクション | `post_reactions`, `comment_reactions`, `reactions` | `src/lib/accountExport.ts`、対応するAPI。`reactions` は旧形式の参照も残るため撤去対象にしない |
| カスタム絵文字 | `custom_emojis` | `src/pages/Settings.tsx` |
| 保存・メンション | `bookmarks`, `mentions` | `src/api/bookmarks.ts`、投稿関連API |
| ハッシュタグ | `hashtags`, `post_hashtags` | 投稿・検索処理 |
| フォロー | `follows` | `src/api/follows.ts` |
| メンバーシップ・機能権限 | `memberships`, `user_entitlements` | プロフィールのメンバーシップ処理、`src/pages/Settings.tsx` |
| 通知 | `notifications`, `post_notification_subscriptions`, `push_subscriptions` | 通知API、通知用フック、Push関連関数 |
| LimeAI | `chat_sessions` | チャット画面、アカウントエクスポート |
| スペース | `spaces`, `space_members`, `space_reactions` | `src/components/spaces/`、関連マイグレーション |
| スタイルアプリ | `style_apps`, `style_app_preferences` | `20261003210000_style_apps.sql`、関連画面 |
| ニュース | `news_summaries`, `news_generation_state` | ニュース画面・生成関数、`20261007143000_external_sources_and_news_cadence.sql` |
| エクスポート管理 | `account_exports` | `supabase/functions/account-export/`、`src/lib/accountExport.ts` |
| 既存・用途要確認 | `lime_drops` | 今回のクライアントコードでは直接参照を確認できていない。データ・DB側関数の調査なしに削除しない |

`limenote_security.request_limits` はサーバー専用スキーマの利用回数管理です。プロフィール設定とは分けて管理します。Supabase管理用の `auth` / `storage` / `realtime` / `supabase_migrations` はアプリの整理対象ではありません。

## 今回統合する3テーブル

| 旧テーブル | 統合先 |
| --- | --- |
| `profile_pins` | 既存の `profiles.pinned_post_id` |
| `account_about` | `profiles` のアカウント情報カラム |
| `external_account_imports` | `profile_private_settings.external_accounts_imported_at` |

接続先の調査時点では `public` に38個の実テーブルがあります。統合後は35個になります。過去のマイグレーションは履歴なので削除・書き換えず、`20261008190000_consolidate_profile_data.sql` で移行します。3つの旧テーブルを参照する旧版フロントエンドと、この統合後のスキーマを混在させないでください。

## 適用・検証

1. `node scripts/profile-data-consolidation-db-test.mjs` で、既存データの引き継ぎ・本人権限・固定ポスト削除・変更履歴・クラウド移行済みフラグを検証する。
2. 統合版のフロントエンドをビルドし、固定・解除、アカウント詳細、外部ユーザー追加・同期をブラウザーで検証する。
3. フロントエンド公開の切り替えと統合マイグレーションを合わせて実施する。公開版の切り替えを確認してからDBへ適用する。
4. マイグレーションはトランザクション内で全行をコピーし、元データとの一致を検証してから旧テーブルを撤去する。不一致や予期しない依存があればロールバックする。`DROP ... CASCADE` は使用しない。

以前のクライアントに戻す場合も、DBだけ・画面だけを戻さないこと。移行後の新しい固定ポストや国情報も含めて旧形式へ戻す移行が必要です。
