# ウェブアプリのセキュリティ調査・対策（2026-10-12）

## 対象と適用状態

対象はReact/Viteのウェブアプリ、PWA、Supabase Edge Functions・SQL・Storage権限、通知サーバー、Cloudflare Worker、GitHub Actions、依存パッケージ、追跡中のソースとGit履歴。iOSは今回の対象外で、今回加えたiOSの変更は取り消した。

ローカル修正に加え、本番Supabase（`wrxaayteittkjoblgauk` / limeNote）のスキーマ・権限・配備状態を調査し、次の4つのDBマイグレーションを適用、検証、適用履歴へ登録した。

- `20261008120000_security_hardening.sql`：既存の広いポリシーにrestrictive所有者制限・私有データ読み取り制限・プロフィール特権フラグ保護を追加。
- `20261012030000_private_conversation_columns.sql`：DMの列権限とRealtime identity制限。
- `20261012040000_legacy_database_security.sql`：旧ビュー、ハッシュタグ、旧返信RPC、LimeDrop、保守RPC、バケット制限。
- `20261012050000_authenticated_bot_cron.sql`：既存Bot cronに専用認証を追加。時刻・有効状態を維持。

本番Edge Functionsは15機能を配備した：`group-friends`、`link-preview`、`account-export`、`delete-timeline-background`、`get-trends`、`send-push`、`generate-news`、`backup-table`、`agora-token`、`space-token`、`chat-gemma`、`transcribe-call`、`synthesize-speech`、`post-bot`、`upload-profile-media`。15機能すべてACTIVEを一覧でも確認。全14認証必須機能（公開トレンドを除く）に認証なしの空POSTを送り401を確認した。

GitHubへのpush・GitHub Pages公開は行っていない。フロントの改善と自動読み込みの変更はローカルのみ。旧公開フロントの`select('*')`は新しいDM列制限により失敗しうる。ユーザーは情報漏洩防止を優先してこの影響を承知でDB適用を明示的に承認した。

Cloudflareはログイン済みアカウントに設定名`limenote-notifications`のWorkerが存在せず、更新できなかった。新規Workerや有料リソースは作成していない。Auth、Cloudinary、バックアップIAMの管理設定は変更していない。

## 発見して修正した問題

| 問題 | 対策と検証 |
| --- | --- |
| グループの一般・招待中の参加者にも、会話の生データから管理者用招待トークン、参加申請、他の参加者の既読・ミュート・削除設定、画像登録情報が読める | 行のRLSだけでは列は隠れない。会話のテーブル全体のSELECTと旧列権限を撤回し、画面で必要な6列だけ許可。詳細は既存の権限付きサマリーRPCから取得。修正前のトークン取得を実際のPostgreSQLで再現し、修正後の拒否と管理者用サマリーの維持を確認した。 |
| DMの「自分だけ削除」をしたユーザーの一覧が、相手側から`hidden_by`として読める | メッセージの読み取りも表示用の列だけに限定。フロントのSELECTを明示し、隠したユーザー一覧の直接取得を拒否するDBテストを追加。 |
| 既存環境でDMテーブルにREPLICA IDENTITY FULLが設定されていると、Realtimeの物理削除時に私有データが旧行として配信されるリスク | 2つのDMテーブルをDEFAULT identityに固定し、旧行に含む情報を主キーだけにする。設定を隔離DBテストと本番カタログで確認。実クライアントによるRealtimeイベントの確認は未実施。 |
| リンクプレビューのIPv6検査が、一部の特殊用途・移行用アドレスやゼロ埋め表記を許可する | IPv6を正規化し、6to4・Teredoを含むIETF特殊範囲、ISATAP、文書用範囲、IPv4の旧6to4リレーを拒否。通常の公開IPv6は維持。DNSで許可したアドレスへ接続する既存方式とリダイレクトごとの検査は維持。回帰テストを追加。 |
| エクスポート等で巨大な本文を読み切った後に制限している、または本文の制限がない | エクスポート8KB、トレンド4KB、背景削除4KB、Push webhook16KB、ニュース生成4KB、バックアップ8KBを、読み取り中のバイト数で制限。エクスポートとトレンドは外部処理前の拒否をテスト。認証のあるwebhook/cronも不正本文で処理を開始しない。 |
| チャットのテキスト添付が文字数で切り詰める前にファイル全体を読み、巨大ファイルで端末メモリを消費する | UTF-8で表示文字数に必要な先頭バイトだけを読む。PDF/DOCXは別Workerで解析し30秒で終了、入力25MB・抽出8万文字・PDF2000ページに制限。DOCXは実際の展開量64MB、512エントリを検査し、ZIP内の偽のサイズ値も信用しない。Chromeで実際の抽出と不正ZIPの拒否を検証。端末のCPU・メモリの絶対上限を保証するものではない。 |
| 背景削除に共有レート制限がなく、Cloudinaryへのリダイレクト・待機時間を制限していない | 既存のupload quotaを共用し、リダイレクトを拒否、30秒で打ち切る。内部エラーメッセージを利用者へ返さない。Edge側クライアントのセッション永続化・自動更新も停止。 |
| 背景削除中に別画像を保存すると、遅れた削除応答が新しい設定を消す | DB更新に古いpublic IDの一致条件を付け、変更済みの設定を上書きしない。条件付き更新のテストを追加。 |
| sharpの画像処理ライブラリとCloudflare開発ツールに既知の脆弱性 | sharpを0.35.5へoverride、Wranglerを4.149.0へ更新しlockfileを反映。sharpのPNG生成・読み取りとウェブの全テスト・ビルド、Workerのdry-runビルドを確認。 |
| 旧owner権限ビューから投稿RLSを迂回でき、ハッシュタグ関連2テーブルにもRLSがない | 全publicビューをsecurity_invokerにし、タグ関連の読み取りは可視投稿へ、登録・削除は所有投稿へ限定。共有タグの改名を禁止し、旧投稿RPCのno-op upsertは維持。隔離DBと本番匿名ロールで検証。 |
| 旧プロフィール返信RPCが保護アカウントの制限を迂回する | SECURITY INVOKERにして現在の投稿・返信RLSを適用。保護投稿の非表示を検証。 |
| LimeDropで未承認の相互フォローを送信条件とし、受信者が送信者等の列も書き換えられる | 本人の承認済み相互フォローだけ許可。INSERTはpending、UPDATEは受信者のpending→accepted/declinedのみ、更新列はstatusだけ。既存列権限も撤回。 |
| 匿名・一般利用者から古いニュース削除RPCを呼べる | `delete_old_news`をservice_roleだけに制限。トリガー関数の不要なRPC実行権限を撤回、所有する非拡張関数のsearch_pathも固定。 |
| 公開画像Storageバケットに容量・MIME制限がない | avatars/covers/postsを10MBと画像MIMEだけに制限。既存オブジェクトは削除しない。 |
| 画像レスポンスをContent-Lengthや読み切った後のサイズ判定に任せている | ストリームの実バイトでチャット画像10MB、オフライン画像16MB、保存全体256MB/2000画像を制限。過大レスポンスでは読み取りを中止。 |
| プレビューのDNS待機と接続タイムアウト後の遅延ソケットを十分制限していない | DNS10秒で打ち切り、接続が遅れて完了してもソケットを閉じる。遅延接続を回帰テストで再現。 |
| 公開ビルドがNode 20で、lockfileを固定せず依存を解決する | Node 24と`npm ci`へ変更。Dependabotの監視対象に通知サーバーとCloudflareディレクトリも追加。ワークフローは実行・公開していない。 |

新しいテーブルは追加していない。画面の構成・Header・機能の範囲は変えていない。通知確認・履歴削除の定期実行やポーリングは登録していない。

列権限の考え方は[Supabase公式ドキュメント](https://supabase.com/docs/guides/database/postgres/column-level-security)を確認した。Realtimeが列権限をフィルタし、DELETEに行のRLSを適用しない点は[公式walrusの説明](https://github.com/supabase/walrus#reading-wal)を確認した。IP範囲は[IANA IPv6レジストリ](https://www.iana.org/assignments/iana-ipv6-special-registry)を参照した。

## 読み込み方式

「さらに読み込む」等の独自ボタンは追加していない。ブックマーク・通知・レビュー・フォロー一覧等の共通`useAutoPagination`をTLと同じ`300px 0px 500px 0px`のviewport判定へ揃え、リストの独自observerも共通化した。再取得中の二重要求とエラー時の自動連続要求は抑止し、失敗時の既存の再試行操作は維持。DMの過去履歴はスクロール上端で取得する既存の方式を維持。

## 既存対策の確認

- 投稿・返信・関連活動・非公開添付：既存のrestrictiveポリシー、親投稿の閲覧権限、所有者偽装の拒否を隔離DBで確認。
- 認証・サーバー権限：利用者向け処理の`getUser`、service-roleを使う処理の本人・参加者チェック、cron/webhookの専用秘密値と未設定時の拒否を調査。グループAIの会話設定はサーバーだけで読み、履歴と起点メッセージには利用者のRLSを維持した。
- DM、招待、グループ管理、AI帰属、投票、リスト、保護アカウント：匿名・非参加者・他人の操作・再試行・無効入力などの既存DBテストを実行。
- XSS・生成コード：Reactの表示、HTML生成箇所、sandbox、外部リンク、PWAキャッシュ、アカウント分離、メディア取得経路を調査。Chromeで生成コードの実行と、同一originの保存データ・アプリ宛ネットワークへのアクセス拒否を検証した。
- 外部リクエスト：リンクのURL制限、DNS検査、接続先固定、各リダイレクトの検査、Push先のホスト制限、Cloudinaryの署名と所有者チェックを確認。
- 秘密情報：公開anonキーを秘密値と誤認せず、service-role JWT・private key・GitHub/AWS/Google/Supabase秘密キーのパターンを検査。値そのものは出力していない。

## 実施した検証

- Vitest：125ファイル、961テスト通過。DM列選択とIP検査の変更後にも対象テストを実行。
- `npm run test:security-db`：隔離PostgreSQLで70項目通過。
- `node scripts/direct-messages-db-test.mjs`：既存DM機能と今回の列権限・identity変更の検証通過。
- リスト、投票、保護アカウントの各DBテスト：通過。追加の`security-legacy-db-test.mjs`でビュー漏洩、タグ、旧返信RPC、LimeDrop、保守RPCを検証し通過。
- Deno：認証ヘルパー、エクスポート、グループAI、DM・リスト・投票画像、Push、背景削除、トレンド、リンクプレビュー、ランカーの65テスト通過。公開サイトに接続するオプションの1テストは未実行。
- 変更した8つのEdgeエントリポイントの`deno check`：通過。トレンドのテスト用エクスポート後にも再確認。
- `tsc --noEmit -p tsconfig.app.json`、`npm run build`：通過。既存の大きいチャンク等の警告は残る。
- `npm run test:security-browser`：Chromeのsandbox検証通過。`security-document-browser-test.mjs`で実ChromeのモジュールWorkerによるPDF/DOCX抽出、不正DOCX拒否も通過。
- 通知サーバー：6テスト通過。Cloudflareの`wrangler deploy --dry-run`：通過、配備なし。
- 変更した本文・HTTP処理のDenoテストを最終再実行：27通過、公開サイトへの任意テスト1件未実行。
- 本番カタログ：RLS未設定publicテーブル0、invokerでないpublicビュー0、restrictiveポリシー102。DM非公開列拒否・表示列許可・identity DEFAULT、ニュース削除RPC拒否、LimeDrop列制限、バケット制限を確認。匿名・無関係の利用者IDのロールで非公開投稿・DM・通知・ブックマークの拒否を確認。検証はロールをトランザクション内だけで切り替え、行データを出力せずROLLBACKした。
- 本番security advisors：ERROR8→0、WARN82、INFO7。WARNの80件は公開SECURITY DEFINER RPCの実行権限に関する棚卸し項目で、利用者を限定して操作する既存APIも含む。WARN0や未知の欠陥がないことは主張しない。残る2件はpublic拡張と漏洩パスワード保護。
- sharp 0.35.5：PNGの生成・読み取り通過。
- 秘密情報検査：現在の追跡ファイルと履歴の24,276ファイル/blobで対象パターンの検出0件。履歴のメディアバイナリと2MB超のblobは除外している。

## 残る依存警告と実行経路

npm公式auditは、開始時にルート13件（High 7 / Moderate 6）、通知サーバー0件、Cloudflare3件（High 3）。更新後はルート12件（High 5 / Moderate 7）、通知サーバー0件、Cloudflare0件。件数は依存ツリー上の警告で、独立した攻撃方法の数ではない。今回の修正で警告0件になったとは報告しない。

ルートに残る原因は、現時点で修正版が掲載されていない次の2件。

1. [bracesの深いパターンによるスタック枯渇](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)。Tailwind 3・chokidar・fast-glob・micromatchへ波及する。ウェブ利用者のHTTP入力をこのビルド用パーサーへ渡す経路は確認していない。ビルド環境で信頼できないパターンや設定を実行しない運用は引き続き必要。Tailwind 4への移行は、画面全体のCSS互換性検証を必要とする別の変更になる。
2. [sprintf-jsの過大な精度指定によるDoS](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)。mammothのCLI用argparse、およびtransformersのNode用onnxruntime-node→global-agent→roarrへ波及する。ウェブのDOCX抽出はmammoth CLIを起動せず、推論はブラウザーWorkerで行う。これらのNode依存をウェブサーバーの入力処理に使う経路は確認していない。未修正依存が存在する事実は残る。

sharpの修正判断は[メンテナーのアドバイザリ](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)も確認した。互換性を確認せずに`npm audit fix --force`でCSSやDOCX機能を変更する対応は行っていない。

## 残る作業と制限

1. **旧限定画像の移行は保留。** 本番で、限定投稿43件に旧公開画像URLが残ることを件数のみで確認した。既存service-roleキーの取得・一時保存は自動承認レビューが通常の配備許可の範囲外として拒否した。改めて許可を求め、ユーザーは「キーを取得せず、この移行は保留する」と回答したため、キーは取得せず画像も移行・削除していない。返信画像を含む全メディアの移行対象件数は未確定。コピー後もCloudinary原本・派生画像削除とCDN無効化、旧URLの失効検証が必要。以前の第三者の保存コピーは回収できない。
2. **GitHub Pages未公開。** フロントの新しいDM SELECT・文書解析・画像制限・自動読み込みは、公開指示があるまで本番画面には反映されない。DB制限を緩めて旧DMクライアントへ戻す対応はしない。
3. Cloudflareの正しい既存配備先の確認が必要。現在ログインしているアカウントでは対象Workerが存在しない。新規作成・ポーリング・常時接続の開始はしていない。
4. Bot自動投稿の停止を避けるユーザー指示に従い、専用の新しい`BOT_CRON_SECRET`を生成してEdge SecretsとVaultへ同じ値を登録。service-roleキーを取得せず、0600の一時ファイルは作業後に削除。既存`bot-auto-post-v2`（job ID 11）は`*/30 * * * *`・activeを維持し、Vault参照の`x-bot-secret`を追加、全DB権限のBearerキーを送る旧方式をやめた。認証付き直接呼び出しと、既存cronと同じDB→HTTPキューの実行経路で200を確認。確認時点でBot有効ユーザーは0件なので、実際のAI生成・投稿は発生しておらず、その成功まで検証した結果ではない。NEWS_CRON_SECRET、PUSH_WEBHOOK_SECRET、BACKUP_CRON_SECRET、Cloudinary3設定は名前の存在だけ確認。その他の値の一致や実際の定期処理成功は未確認。
5. Cloudinaryの古いunsigned upload preset、バックアップ先IAM、実際のAuth設定・最低パスワード長・メール確認・再認証設定は未確認・未変更。`supabase config push`で本番のURL等をローカル設定に上書きする一括適用はしていない。漏洩パスワード保護は[Supabase公式仕様](https://supabase.com/docs/guides/auth/password-security)でPro以上のため、有料サービスを使わない指定に従い追加購入・有効化していない。
6. DM・投票・リスト画像には、RLS確認後に発行する1時間の署名付きURLを使う設計がある。URLを持つ人は期限まで取得でき、閲覧権限の解除直後の失効は保証しない。
7. 実ユーザーのブラウザーで管理者・一般参加者・招待中・退出済みを使った最終REST/Realtime操作確認は未実施。本番の匿名・無関係ロール拒否と隔離DBの正当操作は検証済みだが、公開フロントの更新を伴う実操作確認とは区別する。

未知の脆弱性を含め「全てない」と証明した結果ではない。未修正依存、旧公開画像、管理サービスの未確認項目は残る。本番に適用できた制限とバックエンド配備を、残る項目と分けて記録した。

## 追加のプロフィール修正とBot確認

ユーザーが指定した、フォローボタン横の「プロフィールのその他のメニュー」3点ボタンのみを削除。カバー上の既存のメニュー、フォロー・DM等の他の操作は維持。型チェックとビルドを再実行し通過。GitHub Pagesへ未公開。

Bot専用値を送る前にpg_netキューの権限も調査した。`net`の所有者はsupabase_adminで、postgresからのREVOKEは警告のみとなり効かなかったため、効かない文を最終マイグレーションから除いた。[Supabase公式の制限](https://supabase.com/docs/guides/troubleshooting/revoking-access-to-pg_net-objects-has-no-effect-0bbc16)を確認し、一般ブラウザーの公開anonキーによる`Accept-Profile: net`リクエストが406/PGRST106となり、netがData APIに公開されていないことを実測した。Vaultの復号ビューにはanon/authenticatedのSELECT権限がない。ただし[公式仕様](https://supabase.com/docs/guides/troubleshooting/database-roles-can-read-request-headers-queued-by-pg_net-ad6357)のとおり、DBへ直接接続できる信頼済みログインロールには処理待ちのHTTPヘッダーが読める。キューのアクセス制御が変更できたとは報告しない。

## 自動ニュースの関連付けエラー修正

検索ページのLimeNote自動ニュースで、`posts`と`profiles`の曖昧な関連付けがPGRST201を返すことを本番の公開anonクエリで再現した。作者の外部キー`posts_user_id_fkey`を本番カタログで確認し、`profiles!posts_user_id_fkey!inner(is_private)`へ変更。公開範囲・保護アカウント除外・5日以内の条件は維持。発見・話題の追加検索・公開直前の再検証で共通の取得関数を使うため、すべてに修正が適用される。

修正クエリは本番で200、ニュース関連18テストとDeno型チェックは通過。`generate-news`を本番へ再配備し、ニュース専用GitHub Actionsで実行確認。初回は関連付けエラーを解消したが、両ソースとも同じ出来事を裏付ける投稿5件を選べず、根拠不足で失敗した。件数条件は緩めず、根拠不足は既存記事を維持して更新を見送る正常なskipped結果に変更した。ロック解除とlast_errorのクリアを確認するDenoテスト3件も通過。すべての外部検索が失敗した場合は実際の取得障害としてエラーを維持する。最終の[ニュース専用ワークフロー](https://github.com/toumeron/RaimuNoteSNS.github.io/actions/runs/38248365330)はsuccessで完了。GitHub Pagesへのpush・公開は行っていない。

## LimeNote記事が0件だった問題の追加対策

ユーザーからLimeNoteの記事が一切表示されないと指摘を受け、本番で保存記事が0件と確認。単にAIの「根拠不足」結果だけで投稿が存在しないと判断した説明は不十分だった。公開候補を実測すると直近5日以内は11投稿、LimeAI関連の公開投稿は全期間14件・5日以内5件。古い投稿を今の出来事として記事にすることは避け、日付の条件は維持した。

追加検索時に最初にAIが選ばなかった元候補を破棄していたため、候補全体と追加検索結果を統合してから同じ話題を再選別する方式へ修正。元候補10件・追加検索0件でも10件を選べるDeno回帰テストを追加。ユーザーの明示的な承認に従い、LimeNoteだけ最低1件で生成可、Blueskyは最低5件を維持。AIの話題選択・執筆・引用検証のすべてに同じ必要件数を渡し、入力の実件数を引用目標にする。少数の場合は短い記事を許可し、文字数を埋める創作を禁止。公開範囲・保護アカウント・日付・生成後の再検証は維持。

Denoの生成ハンドラ5テスト・Vitestニュース18テスト・Deno型チェック通過。修正したgenerate-newsを再配備。最終の[ニュースワークフロー](https://github.com/toumeron/RaimuNoteSNS.github.io/actions/runs/38249131688)はsuccess。LimeNote記事「LimeAI 6が公開　出力上限100万トークンへ大幅拡大」を4件の公開投稿を引用して生成した（記事ID `671c691e-b255-4e34-b192-963a276cf736`）。検索ページと同じ公開anon権限、source=limenote、public_sources_verified=trueの取得APIで200・記事1件を確認。DBの条件を緩めて非公開記事を公開する操作は行っていない。GitHub Pagesは未公開で、バックエンドの修正と生成済みデータが既存の公開フロントから利用できる。
