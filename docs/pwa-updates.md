# PWAの自動更新

公開後の配信済みビルドに自動で切り替える。GitHub Pagesへの公開そのものは行わない。

- 起動時、前面への復帰、通信復帰に確認。前面表示中は1分ごとに確認する。非表示中・オフライン中には確認しない。
- Service Workerは `updateViaCache: none` で登録し、待機中の更新には `SKIP_WAITING` を送る。
- ビルドごとに `version.json` と実行コードへ同じIDを埋め込む。版の照合は `no-store` とクエリ付きのURLで行う。食い違いが残る場合はビルドID付きのSW URLで登録を更新する。以降の起動でもそのURLを維持する。
- 登録失敗は5秒から最大5分の間隔で再試行する。更新確認の同時実行と二重の再読み込みを防ぐ。
- 文書を再読み込みする前に `lime-pwa-before-reload` で各投稿欄の下書き保存を要求し、IndexedDBの画像・動画書き込み完了を待つ。保存失敗時は文書を維持し、自動再試行する。更新のためにIndexedDBや画像キャッシュを一括削除しない。
- 初回インストール時の制御開始では再読み込みしない。既存の旧クライアント向けSW通知・ACKの仕組みは維持する。
- OSが停止しているPWAを動かし続けることはできない。再び開いてオンラインになった時に確認する。

検証は `src/lib/registerPwa*.test.ts`、`src/components/feed/PostComposer.drafts.test.tsx`、TypeScript、ビルド生成物を対象とする。実機でのService Worker切り替えは別途確認が必要。

参考: [Vite PWAの自動更新](https://vite-pwa-org.netlify.app/guide/auto-update.html)、[Service Workerの更新とキャッシュ](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/updateViaCache)。
