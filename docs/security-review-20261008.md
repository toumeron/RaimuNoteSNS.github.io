# セキュリティ確認・修正記録（2026-10-08）

## 状態と確認範囲

ローカルのアプリ、Supabase Edge Functions、リポジトリに存在するSQL、依存パッケージ、Git履歴を調査し、以下を修正した。UIのレイアウト・配色・アニメーションは変更していない。限定投稿の仕様は「投稿者がフォローしている相手に公開」。投稿者本人も自分の投稿を閲覧できる。投稿者をフォローしているだけの相手には公開しない。

**本番への適用は未実施。** この環境のSupabase CLIにはアクセストークンがなく、本番の基礎スキーマ・既存RPC・実際の権限・バックアップ先のIAM設定には接続できなかった。基礎テーブルの作成SQLもリポジトリに揃っていないため、DBテストは旧来の広い権限を再現した隔離PostgreSQL環境で実施している。本番の安全性や、過去に流出がなかったことを保証する結果ではない。

## 修正内容

|問題・リスク|対策|
|---|---|
|投稿の本文が限定公開でも添付をCloudinaryの公開URLに保存していた|新規投稿・返信の添付を非公開`post-media`へ保存。Storageの取得時にも、現在の投稿・返信のRLSに照らして閲覧可否を判断する。公開URLを新しい限定添付として登録する直接API操作も拒否。|
|古い幅広いポリシーが残ると他人の書き込みや私有データの取得が許可される危険|本人のIDを確認するrestrictiveポリシーを追加。投稿、返信、プロフィール、フォロー、各種リアクション、ブックマーク、チャット、Push購読、通知などを対象にした。restrictiveポリシーは既存のpermissiveポリシーとのANDで評価される。|
|閲覧不可の投稿のIDや活動が関連テーブルから見える危険|いいね、リアクション、リポスト、メンション、固定投稿、返信のリアクションに親投稿の閲覧制限を適用。通知の本文プレビューも閲覧不可投稿については読めないようにする。|
|公式・管理者フラグの自己変更の危険|クライアントからのプロフィール挿入・更新で特権フィールドを変更できないトリガーを追加。|
|Botプロンプトが公開プロフィールに含まれる|`profile_private_settings`へ移動。本人のSELECTとサーバーだけに許可し、既存公開カラムにはNULLだけを残す。設定画面とBot処理も新しい保存先を使用する。|
|Bot投稿・ニュース生成が管理専用の認証を持たなかった|それぞれ`BOT_CRON_SECRET`・`NEWS_CRON_SECRET`を必須化。匿名公開キーや一般ログインだけでは実行できない。|
|Push送信が秘密値未設定時に認証を省略していた|未設定・不一致とも401で拒否。Push前にも宛先ユーザーの現在の投稿閲覧権限を検証する。送信先はHTTPSの主要Push事業者に限定し、リダイレクトで署名を別ホストに渡さない。|
|旧Agoraエンドポイントが任意チャンネル・任意UIDの発言トークンを発行していた|現在のアプリは会員資格と発言権を確認する`space-token`を使う。使われていない旧エンドポイントからの発行は停止する。|
|AI・音声・リンク取得を大量に実行される危険|本人認証、DBに保存する分散レート制限、実際に読み込むバイト数の上限を追加。制限用DBが使えない場合も拒否する。AI公開検索からservice-role権限を除去する。|
|AIが生成したHTMLをアプリと同じoriginのBlobページとして開いていた|新しいタブでもsandbox付きiframeで表示し、openerも渡さない。生成コードのWorkerもopaque originへ隔離し、IndexedDBの個人データとアプリ宛のネットワークアクセスを遮断する。|
|背景・カスタム絵文字が公開のunsigned upload presetで誰でもアップロード可能|認証・容量制限・レート制限付きの`upload-profile-media`からサーバー署名でアップロードする方式へ変更。絵文字のDB書き込みも`uploaded_by`本人に制限。|
|秘密情報のGit混入・脆弱な開発サーバー|環境ファイルの各種派生名・秘密鍵をignore。開発サーバーをlocalhostだけにバインド。依存更新とDependabot設定を追加する。|

新しい画像は、PostgRESTの入れ子の応答（引用元・返信・プロフィール一覧を含む）から参照を解決し、閲覧者の認証情報を付けてStorageから取得する。アカウント変更前に始まったREST応答も破棄する。表示には端末内のBlob URLを使い、アカウント切り替え・ログアウト時に破棄する。アプリはこの経路で譲渡可能な署名付きURLを発行しない。閲覧を許可された人が画像を保存・再配布することや、既に取得された画像を後から回収することは防げない。

## 本番への適用

1. 管理端末でSupabase CLIにログインし、正しいプロジェクトをリンクする。本番の現在のスキーマとポリシーを確認する。`supabase/tests/security_catalog.sql`は行データ・関数本体・秘密値を返さない読み取り専用の確認SQL。RLSなしのテーブル、invokerではないビュー、公開RPCの権限、バケットを調査する。今回のrestrictiveポリシーは既存の正常なpermissiveポリシーを前提とするため、正当なユーザーが操作できる設定も確認する。
2. `supabase db push --dry-run`で未適用のSQLを確認する。この作業前から存在する未適用マイグレーションも含まれることに注意する。基礎スキーマが想定と異なる場合は先に調整する。今回のSQLは所有者カラムの相違があれば適用を中断する。
3. 次のマイグレーションを順序どおりに適用する。
   - `20261008120000_security_hardening.sql`
   - `20261008121000_private_post_media.sql`
   - `20261008122000_private_bot_settings.sql`
4. サーバーのSecretsに`NEWS_CRON_SECRET`、`BOT_CRON_SECRET`、`PUSH_WEBHOOK_SECRET`を設定する。それぞれ別の十分に長いランダムな値を使う。既存の`BACKUP_CRON_SECRET`は引き続き必要。秘密値をVITE変数・ソース・チャットに書かない。GitHub Actionsには同じ`NEWS_CRON_SECRET`をSecretsとして追加し、Botのスケジューラは`x-bot-secret`、ニュースは`x-news-secret`、Push webhookは`x-push-secret`を送信するよう設定する。
5. 次のEdge Functionsをデプロイする。`config.toml`ではcron/webhookは専用秘密値で検証し、ユーザー向け機能はJWTを検証する設定にした。独自のデプロイ設定で上書きしない。
   - `agora-token`, `space-token`, `chat-gemma`
   - `transcribe-call`, `synthesize-speech`, `link-preview`
   - `send-push`, `post-bot`, `generate-news`, `backup-table`, `upload-profile-media`
新しい画像アップロード処理には、背景削除処理と同様にサーバーの`CLOUDINARY_CLOUD_NAME`・`CLOUDINARY_API_KEY`・`CLOUDINARY_API_SECRET`が必要。フロントの切り替え後、Cloudinary側で古いunsigned upload presetを無効化する。無効化しない限り第三者によるサービスへの無断アップロードは残る。背景とカスタム絵文字は従来どおり公開画像として保存される。

6. フロントエンドをビルドして既存のGitHub Pagesへ反映する。**画像・Bot設定の新方式はDB、Functions、フロントの組み合わせが必要。** DBを先に適用し、すぐにFunctionsとフロントを切り替える保守時間を確保する。古いフロントからの限定画像の登録は安全のため拒否される。新しいSecretsが未設定のcronも安全のため停止する。
7. 本番のAuthにも12文字以上の最小パスワード長と安全なパスワード変更を設定する。今回の`config.toml`の変更だけでは、ホスト済みAuthの設定は更新されない。既存の招待コード制限・メール確認の運用を実際の設定と照合する。
8. 別アカウントで、作者本人・作者がフォローしている人・作者をフォローしているだけの人・未ログインの4通りを検証する。REST直アクセスとStorage直アクセスでも同じ結果になることを確認する。チャット、通知、プロフィール設定、スペースの発言権、Bot設定の読書きも確認する。

レート制限は、本人ごとに5分間でチャット30回、音声60回、通話トークン60回、リンク取得120回。音声認識と音声合成は共通の上限を使う。背景・絵文字のアップロードは20回。上限変更はサーバー側SQLで行い、ブラウザーからは変更できない。

## 過去の限定画像とバックアップ（未完了）

新規の添付経路を変えても、以前のCloudinaryのURLは引き続き公開されたままになる。これを放置して対策完了とは扱わない。

`scripts/migrate-private-media.mjs`を用意した。ローカル環境の`SUPABASE_URL`・`SUPABASE_SERVICE_ROLE_KEY`を使用し、引数なしでは件数の確認だけを行う。`CLOUDINARY_CLOUD_NAME`で画像ホストとcloudを明示し、`--apply`を付けた場合に、限定投稿とその返信の旧画像を非公開Storageへコピーする。DB参照はcompare-and-swapで更新し、変更中・削除済み・公開化済みの行を上書きしない。コピー・更新が失敗した場合は作成途中のStorageオブジェクトを削除する。Cloudinary以外のURLや10MB超の画像は個別に移行する必要がある。

```sh
node scripts/migrate-private-media.mjs
# 件数・対象を確認してから実行
node scripts/migrate-private-media.mjs --apply
```

**コピー後、Cloudinary側で元オブジェクトの削除・派生画像の削除・CDN無効化が必要。** 同じ画像を公開投稿でも使っていないか確認してから対応する。このスクリプトは外部の元画像を削除しない。削除後に旧URLと派生URLが実際に取得できなくなったことを検証する。閲覧者・第三者・ブラウザーが以前に保存したコピーは回収できない。

バックアップには限定投稿、チャット、Push購読などの私有データも入る。Firebase/GCSバケットのIAMで`allUsers`・`allAuthenticatedUsers`への権限がないこと、公開URLで取得できないこと、サービスアカウント権限と保管期間が適切なことを本番側で確認する。このリポジトリにはバックアップ先のIAM/Storageルールがなく、こちらでは確認できていない。

## 依存パッケージの結果

npm公式のauditを実行。開始時は58件（Critical 3、High 13、Moderate 37、Low 5）。更新後は8件（Critical 0、High 5、Moderate 3、Low 0）。数はnpmの依存ツリー上の警告件数であり、独立した攻撃方法の数ではない。

Tiptap/ProseMirror、Vite、Vitest、React Router、関連パーサー・シリアライザーを更新。開発用のlovable-taggerを削除。更新後のNode.js要件は`package.json`に記載した。今回の環境はNode 24。

残る警告は2つの未修正版の問題に起因する。

- `braces`の深いパターンによるスタック枯渇。Tailwind 3、chokidar、fast-glob、micromatchへ波及する。ビルド・開発時に使われる依存であり、アプリがHTTP入力をこのパーサーへ渡すサーバーはこのリポジトリにはない。Tailwind 4への移行は生成CSS・表示へ影響するため今回のUI変更禁止の範囲では行っていない。[公開アドバイザリ](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
- `sprintf-js`の過大な精度指定によるDoS。mammoth→argparseのCLI依存に波及する。mammothでargparseを使う箇所は`bin/mammoth`で、ブラウザーのDOCXテキスト抽出からこのCLIは呼んでいない。未修正版のため依存ツリー上の警告は残る。ブラウザーのDOCX抽出全体について無制限なCPU・メモリ消費がないことまで保証してはいない。[公開アドバイザリ](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)

`npm audit fix --force`でCSSライブラリやDOCX処理を古い版へ変更して、見かけだけの件数削減はしていない。DependabotでnpmとGitHub Actionsの更新を継続検知する。

## 検証

- Vitest：70ファイル、432件通過。既存のUI関連テストも実行。
- `npm run test:security-db`：70項目通過。旧debug ALLポリシーがある状態でも、投稿者・正当な閲覧者・逆向きフォロワー・匿名、画像の取得、関係の解除、偽装書き込み、特権フラグ、Bot設定、レート制限を実際のPostgreSQLで検証。
- `npm run test:security-browser`：Chromeで生成コードの計算実行、opaque origin、IndexedDBアクセス拒否、アプリ宛fetch拒否、隔離HTMLの表示・ストレージアクセス拒否を確認。通常のChromeインストールを使用する。
- `tsc --noEmit -p tsconfig.app.json`：通過。
- 変更したEdge Functionsとaccount-exportの`deno check`：通過。共通セキュリティヘルパー2件とaccount-export7件、計9件のDenoテストが通過。
- `npm run build`：通過。既存の大きいチャンク等のビルド警告は残る。
- 秘密情報検査：Gitに追跡されている現在のファイルと履歴のテキスト・コード計22,311件を検査し、対象パターンの検出0件。履歴のメディアバイナリと2MB超のblobは除外。private key、GitHub token、AWS access key、Google API key、Supabase secret key・service-role JWTを対象にし、値自体を出力しない。公開anon JWTは秘密値として扱わない。このパターン検査はすべての種類の秘密情報が存在しないことの証明ではない。

本番DBのRLS・RPC、ホスト設定、過去の画像とバックアップについては、本番アクセスを得た上で上述の適用・確認を完了する必要がある。

## 開発環境で判明した互換性問題の修正

接続先を公開anonキーによる`limit=0`の読み取りで確認し、通常のプロフィールカラムはHTTP 200、`profile_private_settings`はHTTP 404 / `PGRST205`だった。非公開Bot設定の移行が未適用の状態で、この取得を通常のプロフィール反映より前に待機してしまい、投稿画面の表示名・ユーザー名・画像と設定画面に影響していた。

通常のプロフィール反映と非公開Bot設定取得を独立させた。設定画面も非公開設定の取得失敗で通常項目の反映を止めない。Bot指示を取得できていない場合は通常の保存に`bot_prompt`を含めず、空文字で既存の指示を上書きしない。プロフィールAPIの公開読み取りからBot指示を除外し、Bot指示を明示的に更新する経路は非公開設定の保存先が利用できなければ書き込み前に失敗させる。

Chromeの架空セッションとモック応答で、非公開設定404のまま投稿画面のDB表示名・プロフィールリンク、プロフィール本文、設定の表示名・自己紹介・場所・ユーザー名の表示を確認した。通常設定の保存が`bot_prompt`を含まないことと、ページの未処理例外がないことも確認した。実ユーザーの保存データはこの検証で変更していない。Bot指示の非公開保存と新しい添付画像用Storageを本番で利用するには、上述のマイグレーションの適用が引き続き必要。
