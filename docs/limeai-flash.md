# LimeAI-Flashの実行・配置

LimeAI-Flashは公開のQwen3-4B-Instruct-2507の4bit版を土台にした日本語の雑談・コーディング向けモデルです。元の自作モデルとは別の版です。土台の重みは約2.3GB、追加学習のアダプターは約1.3MBです。取得元・固定リビジョンは `scripts/limeai_flash/model-source.json` に記録しています。

## 現在の状態とMacでの作業制限

Macのクラッシュ後、ユーザーの指示により、このMacでのモデル学習・推論・実モデル評価・重いビルドを実行しません。ローカル作業は軽いコード編集と静的確認に限定します。実モデルの評価はリモートのGitHub Actionsで行う構成です。

実際のLimeAI指示を使う追加学習は途中で中断し、完成したアダプターはありません。同梱している以前の実験候補には、JSONの数値型、引用された命令、モデルの出自、Reactの説明などに誤りがあり、**本番採用前の開発用候補**です。評価結果と既知の問題を `scripts/limeai_flash/model-validation.json` に保存しています。モデルの品質改善が完了したという意味ではありません。

この候補を誤って本番へ配置しないよう、`release_check.py` が未評価・問題の残る状態ではサーバーの起動とDockerのモデル取得を止めます。実際の生成結果の確認後に選んだアダプターのSHA256も照合します。評価スクリプトは開発用候補を実行できますが、自動チェックだけで本番用の状態に書き換える処理はありません。

既存LimeAIの批判・不満に関する禁止規則は変更せず、通常会話・キャラクター会話の両方で原文を維持します。学習損失や単語の一致だけでは本番採用を判断せず、生成結果の意味と指示への追従を確認します。

## GitHub Actions

`.github/workflows/limeai-flash.yml` を手動実行すると、LinuxのCPUでモデル本体を取得し、重みと公式会話テンプレートのSHA256を検証して、実験候補を実際に実行します。`full` は固定19課題の生成結果をJSONへ逐次記録します。自動チェックに失敗しても評価結果のartifactを残し、生成内容を確認できます。`smoke` は起動・短い固定会話の確認だけで、品質評価の代用にはしません。テストに成功した場合だけ配置用パッケージを作成しますが、その成功も本番品質を保証しません。利用者の会話・個人設定をActionsへ送る処理はありません。

有料の実行を避けるため、公開リポジトリの標準ランナーに限定しています。非公開リポジトリではモデル実行ジョブをスキップします。手動実行と、専用の `codex/limeai-flash-evaluation` ブランチの評価関連ファイルへのpushだけが対象で、定期実行はありません。同時1件、上限60分です。現在このworkflowはローカルの変更であり、GitHubへのpushも実際の実行もまだ行っていません。専用ブランチへのpushはPagesの公開対象にはなりません。

評価ブランチには実行コードと明示した公開ソースのスナップショットだけを載せます。`snapshot_source.py` は指示・関連仕様の入力ファイルだけを `source_snapshot` にコピーし、SHA256を記録します。アプリ本体の未コミット変更を一括してpushせず、評価対象の指示・仕様を固定するためです。CIはこのスナップショットを参照します。個人のチャット、秘密情報、モデル本体は含めません。

GitHub Actionsは開発・テスト・配布に使います。本番の会話ごとにworkflowを起動する仕組みではありません。GitHubの[Actions規約](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#actions)にある用途制限に従います。

以下は**GitHub Actionsなどのリモート環境専用**の実行手順です。このMacでは実行しません。

```sh
python -m pip install -r scripts/limeai_flash/requirements.txt
python scripts/limeai_flash/download_model.py
python -m unittest discover -s scripts/limeai_flash -p 'test_*.py' -v
python scripts/limeai_flash/evaluate.py --out flash-evaluation.json
python scripts/limeai_flash/bundle.py
```

macOSではApple Silicon、Linuxではglibc 2.35以降が必要です。MLXには[Linux CPU版](https://ml-explore.github.io/mlx/build/html/install.html#cpu-only-linux)があります。

## 無料クラウドの候補

Oracle CloudのAlways FreeのArm VMを候補にしています。現行の無料テナンシーは合計 **2 OCPU・12GB RAM** の範囲です。古い4 OCPU・24GBの案内を使わず、[現行の公式仕様](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm)と作成画面のAlways Free表示を確認してください。無料枠の空き容量や継続稼働は保証されません。有料の形状・無料枠を超える容量・期限付きトライアルクレジットを前提にしたリソースは作成しません。

アカウントの本人確認・支払い手段の確認・規約への同意は利用者自身が行う必要があります。現時点ではクラウドVMの作成、秘密情報の登録、DB適用、Pages公開は行っていません。

Hugging Face SpacesのCPU Basicは時間料金が無料ですが、現在はDocker/Gradioの新規作成に有料プランが必要です。無料ZeroGPUも日次上限があるため、この構成では常設の推論先として使いません。[公式仕様](https://huggingface.co/docs/hub/spaces-overview)

## 推論サーバー

`python scripts/limeai_flash/bundle.py` で `artifacts/limeai-flash-cloud` に、実行コード、アダプター、ライセンス、参照を許可したLimeNoteの公開ソースだけをまとめます。モデル本体、`.env`、チャット履歴はパッケージに含めません。モデル本体はDockerのビルド時に固定リビジョンから取得します。

VMにDockerとComposeを用意し、このパッケージを配置します。APIキーは32文字以上のランダム値をVM内で生成し、所有者だけが読める `/etc/limeai-flash.env` に `LIMEAI_FLASH_API_KEY=...` として保存します。チャットやGitには貼り付けないでください。

VMの公開IPへ解決するホスト名を `FLASH_HOSTNAME` に設定します。受信を許可するのはHTTPS用443番と証明書発行用80番です。推論APIの8000番はインターネットへ直接公開しません。

```sh
cd limeai-flash-cloud
export FLASH_HOSTNAME=モデル用のホスト名
docker compose up --build -d
```

HTTPSはCaddyが終端します。起動後 `https://ホスト名/health` は `ready:true` を返します。会話APIはBearerキーがなければ401を返します。

サーバーはモデルを一度ロードし、同時生成は1件、待機を含め最大8件に制限します。会話はファイルやログへ書かず、ジョブはメモリ内で最大15分保持し、期限後は取得できなくなります。処理の停止後に遅れて届いた結果は公開しません。再起動で待機中ジョブは消えます。常設クラウドのCPUでの応答時間は、実環境で別途計測が必要です。

## LimeNoteへの接続

既存の `chat_sessions` に `model` と `flash_job` を追加する `20261018010000_limeai_flash_jobs.sql` を適用します。新しいテーブルは作りません。`flash_job` はID・状態・期限のみで、入力・指示・返答を複製保存しません。会話履歴は既存の `messages` を使い、既存の所有者制限は維持します。

SupabaseのEdge Function `chat-flash` に、次の値をサーバー側のシークレットとして登録します。

- `LIMEAI_FLASH_URL`: 上記のHTTPS URL
- `LIMEAI_FLASH_API_KEY`: VMに設定したAPIキーと同じ値

`supabase functions deploy chat-flash` で関数を配置します。フロントエンドの環境変数には推論サーバーのAPIキーを置きません。

LimeAIの既存モデル選択に **LimeAI-Flash** を追加しています。選択時は指示とキャラクター設定を引き継いだ新しいチャットを作り、既存チャットのモデルは変更しません。Gemmaの端末内会話を途中で他のモデルへ変えない制約も維持します。LimeAI-Flashはテキスト向けで、ライブ音声・画像認識・投稿操作・検索ツールは備えていません。ほかのモデルへの自動切り替えは行いません。

Edge Functionはログイン・既存の停止アカウント制限・送信回数制限・チャットの所有者を確認し、推論サーバーへ転送します。待機中に確認するのは、利用者が明示的に送信した現在の会話ジョブだけです。通知の定期確認やバックグラウンドの自動ポーリングは登録しません。

モデルはLimeNoteの元の指示と関連する公開ソースを実行時に参照します。指示の抽出方法が変わった場合はエラーにし、知らない仕様や実行していない操作を完了したと説明しない方針です。現在の候補にはこの方針に反する生成結果もあり、本番配置に進む前に修正とリモートでの再評価が必要です。
