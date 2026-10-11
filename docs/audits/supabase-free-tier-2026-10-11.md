# Supabase無料枠の見直し（2026-10-11）

対象: LimeNote / `wrxaayteittkjoblgauk`。公式仕様、本番の集計値、ソースコード、既存cron、GitHub Actionsを確認した。個別ユーザーの本文・メール・Secretは記録していない。

## 公式の無料枠

| 項目 | 無料枠 | 集計範囲・注意点 |
| --- | --- | --- |
| Database | 500MB | プロジェクト単位。テーブル・インデックス等を含む |
| Storage | 1GB | DB容量とは別枠 |
| Egress | 非キャッシュ5GB/月、キャッシュ5GB/月 | 独立した枠。DB/Auth/Storage/Edge/Realtime等の転送を含む |
| Auth MAU | 50,000/月 | 登録ユーザー数とMAUは異なる |
| Edge Function | 500,000回/月 | ブラウザのPostgREST/RPC呼び出しとは別の指標 |
| Realtime | 2,000,000メッセージ/月、ピーク接続200 | DB内の変更検出クエリ回数とは異なる |
| Edge runtime | 256MB RAM、CPU 2秒/リクエスト、worker最大150秒 | I/O待ち時間はCPU時間に含まれない |
| Edge登録数 / Secrets | 100 / 100 | プロジェクト単位 |
| プロジェクト | アクティブ2個、非活動1週間で停止対象 | 稼働維持だけのリクエストは追加しない |

主要枠は組織内で共有される。DBの500MBはプロジェクトごとの上限。無料枠超過時は通知後にサービス制限があり得るため、「APIリクエスト無制限」を「容量・通信・CPUも無制限」と解釈しない。

出典:
- https://supabase.com/pricing
- https://supabase.com/docs/guides/platform/billing-on-supabase
- https://supabase.com/docs/guides/platform/manage-your-usage/egress
- https://supabase.com/docs/guides/functions/limits
- https://supabase.com/docs/guides/platform/billing-faq

## 本番の実測

測定時点: 2026-10-11夜。SQLで個人情報を含まない集計を取得した。

- DB: 85,757,075 bytes = 約85.8MB / 81.8MiB。500MBに対して約17%。publicテーブルと関連インデックスは約10.3MB。WALの128MBはこのDB実測に加算していない。
- Storage: 47,193,606 bytes = 約47.2MB / 45.0MiB。1GBに対して約4.7%。66オブジェクト。
- 登録ユーザー26人。最終ログイン時刻が直近30日内のユーザー12人。この12人は請求上のMAUそのものではない。
- Edge Functionは18本、登録上限100本の18%。
- Realtime publicationは8テーブル。利用中の画面・共有対象アカウントに応じて購読する。
- 学習データ17件、JSONBの保存サイズ合計2,821 bytes。16アカウントのprivate設定行を集計。30日・各アカウント2,000件の上限あり。
- 統計の起点は2026-04-08。pg_stat_statementsの呼び出し数はその期間の累積で、当月の通信量・Realtime課金メッセージ数に置き換えられない。

**未測定**: 当月の請求Egress、キャッシュEgress、Edge実行回数、Realtimeメッセージ数・ピーク接続、ログ取込量。DBのSQL集計だけでは取得できない。容量に余裕があることから、これらも枠内だと断定しない。確認先は組織のUsage画面: https://supabase.com/dashboard/org/ltnwvfkmbnvbalxyyaod/usage 。

## 機能ごとの確認

| 対象 | 確認結果・対応 |
| --- | --- |
| TL・検索・プロフィール・返信 | 一般APIはページングあり。大きなプロフィール結合・画像の転送が成長時の主因になり得る。元の投稿読み込み方式は変更しない |
| おすすめ学習 | 学習をGitHubに置き、Edgeでは数値の木だけを推論。最大80候補、1.5秒のクライアント待機、障害時のバックオフ、モデル有効期限を確認。日次学習は維持 |
| 学習保存 | 1操作1RPCで、JSONB配列を更新する。現在の件数は小さい。ユーザー増加時は、同一利用者の複数観測をまとめて1回書く改善が優先。精度維持のため勝手にサンプルを間引かない |
| フレンド・グループチャット | AIはGroq、障害時Cloudflare。直近の履歴を制限して取得する。Edge回数と音声の転送量は別途消費する |
| フレンド通話 | 24kHz・16bit・monoのPCMで48,000 bytes/秒、約172.8MB/時。5GBは音声だけなら約28.9時間分。実際は他サービスとの共有枠なので使える時間はこれより少ない。音声形式の変更は今回は行わない |
| スペース | 一覧15秒→30秒間隔、15秒のキャッシュ。部屋の3秒更新は前面のみ。20秒の参加heartbeatは維持し、同時の状態取得はReact Queryに統合して重複を減らした。音声を継続するためのheartbeatを消さない |
| 通知・共有 | 外部SNS通知の定期確認・履歴削除は登録しない。開いている共有画面のRealtime購読と終了時の解除を確認。常時接続を外部Pushの代用にしない |
| Storage・メディア | 新しいpost-mediaとDMは非公開・サイズ上限あり。privateメディアはRLSで再確認する設計を維持。古い公開avatars/posts/coversに上限未設定のものが残る。既存ファイルを削除・公開状態変更していない |
| 外部SNS・プレビュー | Bluesky直接読込、Misskey/一部画像・地図はEdgeプロキシを使う。プレビューのサーバーキャッシュはあるが、キャッシュヒットでもEdgeの呼び出し自体は計上される |
| バックアップ | posts全件15分毎、critical毎時、secondary毎日。gzip圧縮あり。新しいprivate設定・DM・bookmarks等は現在のallowlist外。復旧範囲と頻度を合わせて見直す余地がある |
| News・bot・cron | 7件の既存DB cron。GitHubのnewsは15分毎に起動し、サーバー側で5時間の実生成間隔を守る。スケジュールを追加していない |
| DB性能 | 権限を維持したauth.uid()の評価最適化と、非制約の完全重複インデックス2組を整理。制約に紐付く重複2組は保持 |

## バックアップ転送量の見積もり

postsのrow_to_json合計は2,237,140 bytes。現状の投稿全件バックアップ96回/日とcritical内のposts24回/日を同じ件数のまま30日実行すると、**未圧縮の論理JSON量**は約8.05GB/月になる。これはAPIレスポンスの圧縮・ネットワーク計測・実際の実行成功率を含まない見積もりで、請求Egress実測とは異なる。Firebaseへのアップロードは既にgzipされている。

優先する追加対応は、15分の復旧間隔を保ちながら差分保存と定期フルスナップショットを組み合わせる設計、および現在allowlist外の復旧対象の確認。今回は頻度を下げたりバックアップを止めたりしていない。既存バックアップやユーザーデータの削除も行わない。

## 今回の変更と適用状態

- ローカル: `SpaceProvider`の不要な通信とバックグラウンドの部屋ポーリングを削減。参加heartbeatは維持。
- 本番DB: `20261011230000_free_tier_performance.sql`で、サブクエリのないRLS式だけを対象にauth.uid()をInitPlan化。既存のrole・command・許可条件は維持。
- 本番DB: `idx_posts_created_at_desc` / `idx_posts_parent_id`は、同一定義の保持用インデックスと一致し制約依存がない場合だけ削除。unique制約は保持。
- Edge Function / GitHub Actions: 今回はコード配備・スケジュール変更なし。
- GitHub Pages: 未公開。スペースのフロント改善は次回の公開から反映。

検証: 所有者だけ読書きできるPGliteテスト、SpaceProviderの更新間隔・バックグラウンド停止の統合テスト、TypeScript、ビルド、既存DBセキュリティテスト。本番適用完了。適用後のRLS InitPlan警告は92→14、重複インデックスは4→2。複数permissive policy警告147件は維持した（この件数はrole/commandごとの警告であり、147個の独立したポリシーを意味しない）。サブクエリ・auth.role()等を含む残りの式は個別レビュー対象とし、権限を変更するポリシー統合は行っていない。スペース関連6テスト、新しいPGlite改善テスト、隔離DBでの既存セキュリティ70チェック、TypeScript、ビルドが成功。
