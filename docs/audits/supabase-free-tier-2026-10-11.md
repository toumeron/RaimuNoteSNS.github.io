# Supabase無料枠の見直し（2026-10-11）

2026年10月11日時点のSupabase無料枠と、LimeNoteのリソース使用設計をまとめる。無料枠の条件は下記の公式資料を参照する。

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

## 使用量の確認

DBとStorageの容量は個別に計測する。請求Egress、Edge実行回数、Realtimeメッセージ数・ピーク接続はSupabaseのUsage画面で確認する。SQLの累積呼び出し数を当月の通信量や課金メッセージ数として扱わない。

## 機能ごとの確認

| 対象 | 確認結果・対応 |
| --- | --- |
| TL・検索・プロフィール・返信 | 一般APIはページングあり。大きなプロフィール結合・画像の転送が成長時の主因になり得る。元の投稿読み込み方式は変更しない |
| おすすめ学習 | 学習をGitHubに置き、Edgeでは数値の木だけを推論。最大80候補、1.5秒のクライアント待機、障害時のバックオフ、モデル有効期限を確認。日次学習は維持 |
| 学習保存 | 1操作1RPCで、JSONB配列を更新する。複数の観測をまとめて1回書くことで通信回数を抑えられる。学習サンプルの間引きには精度への影響評価が必要 |
| フレンド・グループチャット | AIはGroq、障害時Cloudflare。直近の履歴を制限して取得する。Edge回数と音声の転送量は別途消費する |
| フレンド通話 | 24kHz・16bit・monoのPCMで48,000 bytes/秒、約172.8MB/時。5GBは音声だけなら約28.9時間分。実際は他サービスとの共有枠なので使える時間はこれより少ない |
| スペース | 一覧15秒→30秒間隔、15秒のキャッシュ。部屋の3秒更新は前面のみ。20秒の参加heartbeatは維持し、同時の状態取得はReact Queryに統合して重複を減らした。音声を継続するためのheartbeatを消さない |
| 通知・共有 | 外部SNS通知の定期確認・履歴削除は登録しない。開いている共有画面のRealtime購読と終了時の解除を確認。常時接続を外部Pushの代用にしない |
| Storage・メディア | 新しいpost-mediaとDMは非公開・サイズ上限あり。privateメディアはRLSで再確認する設計を維持。古い公開avatars/posts/coversに上限未設定のものが残る。既存ファイルを削除・公開状態変更していない |
| 外部SNS・プレビュー | Bluesky直接読込、Misskey/一部画像・地図はEdgeプロキシを使う。プレビューのサーバーキャッシュはあるが、キャッシュヒットでもEdgeの呼び出し自体は計上される |
| バックアップ | posts全件15分毎、critical毎時、secondary毎日。gzip圧縮あり。新しいprivate設定・DM・bookmarks等は現在のallowlist外。復旧範囲と頻度を合わせて見直す余地がある |
| News・bot・cron | 7件の既存DB cron。GitHubのnewsは15分毎に起動し、サーバー側で5時間の実生成間隔を守る。スケジュールを追加していない |
| DB性能 | 権限を維持したauth.uid()の評価最適化と、非制約の完全重複インデックス2組を整理。制約に紐付く重複2組は保持 |

## バックアップ転送量の見積もり

postsのrow_to_json合計は2,237,140 bytes。現状の投稿全件バックアップ96回/日とcritical内のposts24回/日を同じ件数のまま30日実行すると、**未圧縮の論理JSON量**は約8.05GB/月になる。これはAPIレスポンスの圧縮・ネットワーク計測・実際の実行成功率を含まない見積もりで、請求Egress実測とは異なる。Firebaseへのアップロードは既にgzipされている。

優先する追加対応は、15分の復旧間隔を保ちながら差分保存と定期フルスナップショットを組み合わせる設計、および現在allowlist外の復旧対象の確認。

## DB・通信の最適化

`SpaceProvider`はバックグラウンドの部屋ポーリングを抑制し、参加heartbeatを継続する。

`20261011230000_free_tier_performance.sql` は、サブクエリのないRLS式の `auth.uid()` をInitPlan化する。role・command・許可条件を保持し、権限を変更するポリシー統合は行わない。`idx_posts_created_at_desc` と `idx_posts_parent_id` は、同一定義の保持用インデックスがあり、制約に依存しない場合だけ削除する。unique制約は保持する。

権限の回帰検証はPGliteと隔離DB、通信の回帰検証は `SpaceProvider` の統合テストで行う。
