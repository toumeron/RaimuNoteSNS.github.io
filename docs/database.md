# データベースの保存先一覧

最初にこの資料を参照してください。公開プロフィールは `profiles`、本人専用設定は `profile_private_settings` に集約します。1アカウントに複数件あるポスト・関係・操作履歴は関連テーブルとして管理します。

## プロフィール・アカウント

| 保存先 | 内容 | 参照・更新コード |
| --- | --- | --- |
| `profiles` | 名前、自己紹介、画像、任意の所在地、登録日、固定ポスト、国情報、接続元、ユーザー名変更回数・日時 | `src/api/users.ts`、`src/api/profile-pins.ts`、`src/api/account-about.ts` |
| `profile_private_settings` | 非公開のBot指示と外部ユーザー一覧の移行済み日時。種類別の通知設定も同じテーブルに保存する。本人だけが読める | `src/lib/privateProfile.ts`、`import_external_account_users` RPC、`supabase/functions/post-bot/index.ts` |
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

通知機能の拡張、追加カラムと適用手順は [通知機能](notifications.md) を参照してください。通知拡張は新規テーブルを作りません。

## トピック設定

`20261008233000_topic_preferences.sql` は既存の `profile_private_settings` に `followed_topics` と `dismissed_topics` を追加します。新規テーブルはありません。2026年10月8日に本番DBへ適用し、適用後も `public` の実テーブル数は36個であることを確認済みです。

- 保存内容は本人限定。公開プロフィールには含めません。既存のBot指示・通知設定を保持します。
- `update_topic_preferences(topic_ids, disposition)` はログイン中の本人を `auth.uid()` で判定し、`follow`・`dismiss`・`clear` を一行の更新で処理します。トピックの重複とフォロー／興味なしの重複を防ぎます。
- カタログは `src/lib/topics.ts`。おすすめの投稿候補をLimeNote・Bluesky・Misskeyから取得し、明示した興味を既存の行動履歴による評価に加えます。興味なしは関連度を下げ、検索候補から除外します。
- トレンドの投稿は取得済み候補の関連度を調整します。検索ページの「おすすめ」はトピックを使ってトレンドを並べ、公開の検索量・元の順位・カテゴリ別一覧は保持します。
- 読み込みはページ・フィードの表示や更新時に実行します。定期実行・ポーリング・常時接続・有料サービスの追加はありません。
- `node scripts/topics-db-test.mjs` で本人権限・入力検証・設定保持を検証します。`tests/topics/topics.config.ts` のブラウザーテストは未フォローの選択画面、クラウド保存、再読み込み、フォロー解除、興味なし、失敗時の再試行とナビゲーションを検証します。

### 推薦の取得元・評価（全トピック共通）

- `discoverBlueskyTopicFeeds` は公開のフィード検索を使い、フィード名が目的のトピックに合う取得元を選びます。説明にたまたま出てくる「AI」「キャリア」などの語だけでは別分野のフィードを選びません。アートは確認済みの公開作品フィードも使います。
- 投稿に保持する `recommendationTopics` は取得元の文脈で、本文に挿入したりユーザー向けタグとして表示したりしません。画像のみ・短文・リンクだけの投稿も候補になります。
- Blueskyの画像altとラベル、Misskeyの画像コメント、リンクのタイトル・説明を保持します。全トピック共通の評価で、取得元の文脈を本文の単語一致より重く扱います。
- 同一作者の異なる関連投稿が2件以上ある場合、各外部SNSで最大1作者の最近の投稿も取得します。これは取得元の直接的な分類より弱い作者の傾向として評価し、全投稿を同じトピックと断定しません。既存のいいね履歴からも作者とトピックの関係を学習します。
- 1回の候補取得で新たに調べるトピックは最大2件。フォローするトピックが多い場合はページを読み進めると取得対象を巡回します。フィード一覧のキャッシュはメモリ内で15分間保持し、アクセス時だけ更新します。定期実行はありません。
- アートをフォローし人工知能をフォローしていない場合、本文・画像説明・作者プロフィール・ラベルにAI生成の明示がある画像投稿を推薦から除外します。AI学習禁止等の否定表現を生成宣言として扱いません。申告されていない生成画像を画素から判定する機能はありません。

デジタルイラストは既存の `profile_private_settings.followed_topics` / `dismissed_topics` に `digital-illustration` を保存する。20261009001000 は許可IDのCHECKと既存RPCの検証だけを22種類に更新し、新しいテーブル・カラムは作らない。候補の言語判定には投稿のlangs、画像説明、投稿者・日本語フィードの文脈を使い、金融・経済・仮想通貨はフォローした関連トピックに限って英語投稿を許可する。デジタルイラストは日本のキャラクター系フィードと画像付きファンアートを対象とし、AI生成の申告を除外する。作風の比較には保存済みの画像特徴を使う。通常のおすすめ表示では画像モデルを起動しない。画像や画像特徴を外部の推論サービスへ送信しない。AI生成の判定は申告情報に限る。

画像のみのおすすめ候補は、トピックフィードと関連投稿者のメディア一覧（Bluesky posts_with_media / Misskey withFiles）から取得する。画像説明や本文の有無を取得条件にしない。取得元の言語文脈を投稿者の次の作品や保存したいいね履歴へ引き継ぎ、単語一致の重みを抑える。Misskey の既存 link-preview リレーは検証済み boolean の withFiles を転送する。DB の変更は伴わない。

おすすめの実閲覧履歴は既存の端末内保存で管理し、一度閲覧した作品を再取得時に除外する。投稿IDに加えて作品の指紋を保存し、画像サイズ違い・Blueskyの同じ画像CID・ページをまたぐ再掲載を重複判定する。未閲覧のまま高速スクロールした投稿は実閲覧扱いにしない。ホームの既存タブ連続クリックと引き下げ更新処理を使用し、通常モバイルブラウザーでも更新を有効にする。DB変更や定期実行は不要。

### いいね・興味なしの画像学習

- `20261009024000_recommendation_feedback_visual_enrichment.sql` は既存の `dismiss_recommendation` のみを更新。2026年10月9日に本番へ適用済み。既存の `profile_private_settings.recommendation_feedback` に画像URL・特徴を保持し、古いフィードバックへの追記は日時を保ち、いいねで解除済みのフィードバックを復活させない。新規テーブルはない。
- iOS PWAのメモリ制限に対応するため、おすすめ表示に伴うCLIPのダウンロード・Worker推論を停止した。既に保存された画像特徴は比較に使うが、未解析画像の画素分類は自動実行しない。
- いいね・興味なしは保存済み履歴と画像特徴を使う。重い画像特徴の自動補完や外部投稿の再取得をおすすめ表示から実行しない。学習時に過去のいいね日時を現在へ変更しない。定期実行はない。
- 同一投稿・同じ画像の再掲載は、ユーザー別の端末内配信履歴（30日・最大5000件）で推薦から除外する。これは実閲覧の学習とは別に管理する。作者の連続表示はページ境界も含め最大3件。好みとの関連根拠がない投稿を穴埋めに使わない。

### 外部フォローの統合 (20261009030000)

既存の follows に external_provider / external_handle / external_profile を追加した。ネイティブUUID参照と所有者制限を維持し、外部フォローは set_external_follow RPCで保存する。旧 external_account_users の12件を検証付きで移行し、同名の互換ビューに置き換えた。本番の公開テーブルは36から35へ減った。プロフィールのフォローとLimeNote側のフォロー中一覧・タイムラインを統合し、SNS側のログインは必要ない。旧データの公開プロフィール情報は一覧表示で不足時に補完する。新規テーブル・定期実行・GitHub Pages公開は行っていない。

### おすすめが参照するいいね履歴（2026年10月9日）

- 保存先は既存の `likes`。初回表示では最新200件、表示後の履歴補完では200件ずつ最大1,000件を取得する。作者・言語・トピック・長期/直近の好みには取得した全件を集計し、表示済み/いいね済み判定にも全件のIDを保持する。
- 比較用の画像付き投稿は最大128件に圧縮する。先に作者ごとに1件を選び、残りを新しい履歴で埋める。同じ作者の直近投稿だけで枠を使わない。画像そのもののダウンロード・新たなAI推論はこの補完では行わない。保存済みの特徴がある場合のみ画像特徴の比較に使う。
- Bluesky本人のいいねAPIによる補完は1回100件、10分間キャッシュする。LimeNoteでいいねした外部投稿は `likes` 側の上限内で集計する。Blueskyで直接行った全履歴の取得ではない。
- 履歴補完は表示中のカードを追加・並べ替えず、次の取得に使う好みを更新する。興味なしへの除外は即時反映し、保存失敗時のみ元に戻す。新しいテーブルや定期実行は追加しない。
