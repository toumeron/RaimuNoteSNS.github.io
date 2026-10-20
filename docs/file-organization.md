# ファイル構成の整理（2026-10-19）

## 800行以下への対象拡大

追加で **73ファイルの実装・検証を主要ファイルに統合**した。`src` のコード・スタイルは **261 → 240**、`scripts` のコードは **63 → 18**。今回開始時からプロジェクト全体のコードファイルは **437 → 371（66個減）**。検証スクリプトの主要入口7個を新設したため、撤去したファイル数と純減は異なる。

- 投稿・プロフィールのデータ取得は `src/hooks/useFeed.ts`、推薦表示は `src/hooks/useRecommendedFeed.ts` に統合。
- アバター・非公開画像・プロフィールメディアは `src/components/ui/avatar.tsx`、投稿の反応操作は `src/components/feed/RepostButton.tsx`、動画埋め込みは `src/components/feed/PostCard.tsx` に集約。
- 通話・スペースの音声制御は `src/lib/callRecorder.ts`、サムネイル・添付アップロードは `src/lib/mediaThumbnail.ts`、プロフィール・リスト・DMのAPIは `src/api/users.ts` に集約。
- 設定表示の定義は `src/components/ui/button.tsx`、投稿表示用の純粋関数は `src/lib/utils.ts` に統合。
- 関連するユニットテスト9ファイルも既存の主要テストに統合し、全1,463ケースを維持。

### 検証スクリプトの入口

52ファイルを以下の7ファイルへ統合した。各コマンドは個別のNodeプロセスで実行し、指定した検証だけが依存ライブラリを読み込む。元の追加引数と環境変数はそのまま渡せる。DB検証はローカルのPGliteを使い、接続先DBは変更しない。

| 内容 | 実行例 | 検証数 |
| --- | --- | ---: |
| DB・RLS | `node scripts/verify-database.mjs anime-history` | 20 |
| 画面・プロフィール・地図 | `node scripts/verify-layout.mjs composer-list` | 9 |
| 外部SNS | `node scripts/verify-external.mjs fxtwitter` | 7 |
| メディア・投票・DM | `node scripts/verify-media.mjs poll-surfaces` | 4 |
| ローカルモデル | `node scripts/verify-models.mjs local-gemma-chat` | 2 |
| 推薦 | `node scripts/verify-recommendations.mjs recommended-feed-scroll personal-art animation` | 8 |
| ブラウザのセキュリティ | `node scripts/verify-security.mjs security-document` | 2 |

各入口の `--list` で選択できる検証名を表示できる。`npm run test:security-db` と `npm run test:security-browser`、既存の手順書も新しい入口に更新した。

### 維持した境界

800行以下でも、主要ファイルそのものや、Worker・ツール設定・デプロイ入口・マイグレーション履歴・独立したモック環境を持つテストは残している。地図の座標処理 `src/lib/mapLocation.ts` はDenoとブラウザで共用するため、ブラウザ向け依存を持つ `utils.ts` へ混ぜない。引用表示も投稿本体との依存・検証の分離を維持する。改行の水増しや再エクスポート専用ファイルの追加で行数基準を満たす変更は行っていない。

### 今回の検証と適用状態

以下は構成整理完了時点の結果。続けて実施した使用量削減と追加テストは [DB・使用量の対策](database.md#supabase使用量の削減2026-10-19) を参照。

- TypeScript型チェック・本番ビルドを確認。
- 全ユニットテストは1,461件成功、既存の失敗1件、スキップ1件（合計1,463件）。
- DB検証20種類成功。ブラウザで投稿・リスト・チャット、検索のモバイル／デスクトップ表示、投票表示、モバイルのスワイプを確認。PWAのChrome検証3件成功。
- 変更前と同じPWAプリキャッシュ44件、約6,880KiB。任意機能のエンジンを初回に取得しない動作を維持。
- GitHub Pagesへの公開・push・接続先DBへの適用は行っていない。

### 今回の統合先一覧

| 元ファイル | 統合先 |
| --- | --- |
| `src/api/directMessages.ts` | `src/api/users.ts` |
| `src/api/lists.ts` | `src/api/users.ts` |
| `src/components/YouTubeEmbed.tsx` | `src/components/feed/PostCard.tsx` |
| `src/components/chat/PixelCat.test.tsx` | `src/components/chat/FriendProfile.test.tsx` |
| `src/components/post/Commentlikebutton.tsx` | `src/components/feed/RepostButton.tsx` |
| `src/components/post/PostSourceLabel.test.tsx` | `src/components/profile/PostTabMenu.test.tsx` |
| `src/components/profile/ProfileMediaPreview.tsx` | `src/components/ui/avatar.tsx` |
| `src/hooks/useComments.ts` | `src/hooks/useFeed.ts` |
| `src/hooks/useProfile.ts` | `src/hooks/useFeed.ts` |
| `src/hooks/useRecommendationImages.ts` | `src/hooks/useRecommendedFeed.ts` |
| `src/lib/bluesky.recommendations.test.ts` | `src/lib/fxTwitter.test.ts` |
| `src/lib/externalNotificationSources.test.ts` | `src/lib/registerPwa.test.ts` |
| `src/lib/localGemma.test.ts` | `src/lib/localGemmaConfig.test.ts` |
| `src/lib/mapLocation.test.ts` | `src/lib/postPresentation.test.ts` |
| `src/lib/postPresentation.ts` | `src/lib/utils.ts` |
| `src/lib/recommendationVisualInference.test.ts` | `src/lib/recommendationCatalog.test.ts` |
| `src/lib/search-trends.test.ts` | `src/lib/recommendationCatalog.test.ts` |
| `src/lib/settingsSections.ts` | `src/components/ui/button.tsx` |
| `src/lib/spacePlayback.ts` | `src/lib/callRecorder.ts` |
| `src/lib/stickers.test.ts` | `src/lib/postPresentation.test.ts` |
| `src/lib/uploadPostMedia.ts` | `src/lib/mediaThumbnail.ts` |
| `scripts/account-about-db-test.mjs` | `scripts/verify-database.mjs` の `account-about` |
| `scripts/account-reviews-db-test.mjs` | `scripts/verify-database.mjs` の `account-reviews` |
| `scripts/account-suspension-browser-test.mjs` | `scripts/verify-layout.mjs` の `account-suspension` |
| `scripts/account-suspension-db-test.mjs` | `scripts/verify-database.mjs` の `account-suspension` |
| `scripts/anime-history-db-test.mjs` | `scripts/verify-database.mjs` の `anime-history` |
| `scripts/bluesky-video-browser-test.mjs` | `scripts/verify-external.mjs` の `bluesky-video` |
| `scripts/composer-list-browser-test.mjs` | `scripts/verify-layout.mjs` の `composer-list` |
| `scripts/direct-messages-db-test.mjs` | `scripts/verify-database.mjs` の `direct-messages` |
| `scripts/dm-links-browser-test.mjs` | `scripts/verify-media.mjs` の `dm-links` |
| `scripts/external-accounts-db-test.mjs` | `scripts/verify-database.mjs` の `external-accounts` |
| `scripts/external-follows-db-test.mjs` | `scripts/verify-database.mjs` の `external-follows` |
| `scripts/external-likes-db-test.mjs` | `scripts/verify-database.mjs` の `external-likes` |
| `scripts/free-tier-db-test.mjs` | `scripts/verify-database.mjs` の `free-tier` |
| `scripts/fxtwitter-browser-test.mjs` | `scripts/verify-external.mjs` の `fxtwitter` |
| `scripts/lime-map-browser-test.mjs` | `scripts/verify-layout.mjs` の `lime-map` |
| `scripts/lists-db-test.mjs` | `scripts/verify-database.mjs` の `lists` |
| `scripts/local-gemma-chat-browser-test.mjs` | `scripts/verify-models.mjs` の `local-gemma-chat` |
| `scripts/local-gemma-inference-browser-test.mjs` | `scripts/verify-models.mjs` の `local-gemma-inference` |
| `scripts/maps-db-test.mjs` | `scripts/verify-database.mjs` の `maps` |
| `scripts/media-action-counts-browser-test.mjs` | `scripts/verify-media.mjs` の `media-action-counts` |
| `scripts/mobile-pwa-performance-browser-test.mjs` | `scripts/verify-layout.mjs` の `mobile-pwa-performance` |
| `scripts/mobile-sidebar-browser-test.mjs` | `scripts/verify-layout.mjs` の `mobile-sidebar` |
| `scripts/notifications-db-test.mjs` | `scripts/verify-database.mjs` の `notifications` |
| `scripts/poll-surfaces-browser-test.mjs` | `scripts/verify-media.mjs` の `poll-surfaces` |
| `scripts/polls-db-test.mjs` | `scripts/verify-database.mjs` の `polls` |
| `scripts/post-video-browser-test.mjs` | `scripts/verify-media.mjs` の `post-video` |
| `scripts/profile-data-consolidation-db-test.mjs` | `scripts/verify-database.mjs` の `profile-data-consolidation` |
| `scripts/profile-highlights-db-test.mjs` | `scripts/verify-database.mjs` の `profile-highlights` |
| `scripts/profile-loading-browser-test.mjs` | `scripts/verify-layout.mjs` の `profile-loading` |
| `scripts/profile-twitter-header-browser-test.mjs` | `scripts/verify-layout.mjs` の `profile-twitter-header` |
| `scripts/protected-accounts-db-test.mjs` | `scripts/verify-database.mjs` の `protected-accounts` |
| `scripts/recommendation-pixels-browser-test.mjs` | `scripts/verify-recommendations.mjs` の `recommendation-pixels` |
| `scripts/recommended-cold-live-test.mjs` | `scripts/verify-recommendations.mjs` の `recommended-cold` |
| `scripts/recommended-continuation-browser-test.mjs` | `scripts/verify-recommendations.mjs` の `recommended-continuation` |
| `scripts/recommended-feed-scroll-browser-test.mjs` | `scripts/verify-recommendations.mjs` の `recommended-feed-scroll` |
| `scripts/recommended-personal-art-browser-test.mjs` | `scripts/verify-recommendations.mjs` の `recommended-personal-art` |
| `scripts/recommended-recovery-browser-test.mjs` | `scripts/verify-recommendations.mjs` の `recommended-recovery` |
| `scripts/recommended-topic-feedback-browser-test.mjs` | `scripts/verify-recommendations.mjs` の `recommended-topic-feedback` |
| `scripts/recommended-twitter-live-test.mjs` | `scripts/verify-recommendations.mjs` の `recommended-twitter` |
| `scripts/scheduled-posts-db-test.mjs` | `scripts/verify-database.mjs` の `scheduled-posts` |
| `scripts/search-pwa-layout-browser-test.mjs` | `scripts/verify-layout.mjs` の `search-pwa-layout` |
| `scripts/security-browser-test.mjs` | `scripts/verify-security.mjs` の `security` |
| `scripts/security-db-test.mjs` | `scripts/verify-database.mjs` の `security` |
| `scripts/security-document-browser-test.mjs` | `scripts/verify-security.mjs` の `security-document` |
| `scripts/security-legacy-db-test.mjs` | `scripts/verify-database.mjs` の `security-legacy` |
| `scripts/stock-market-browser-test.mjs` | `scripts/verify-layout.mjs` の `stock-market` |
| `scripts/topics-db-test.mjs` | `scripts/verify-database.mjs` の `topics` |
| `scripts/twitter-elements-browser-test.mjs` | `scripts/verify-external.mjs` の `twitter-elements` |
| `scripts/twitter-follow-search-browser-test.mjs` | `scripts/verify-external.mjs` の `twitter-follow-search` |
| `scripts/twitter-live-detail-browser-test.mjs` | `scripts/verify-external.mjs` の `twitter-live-detail` |
| `scripts/twitter-quote-layout-browser-test.mjs` | `scripts/verify-external.mjs` の `twitter-quote-layout` |
| `scripts/twitter-search-fallback-live-test.mjs` | `scripts/verify-external.mjs` の `twitter-search-fallback` |

## 前回の200〜500行以下の整理


200行以下から500行以下へ対象を広げ、関連する処理を主要ファイルに集約した。今回の作業開始時から **202ファイルを統合**し、`src` 内のコード・スタイルファイルは **434 → 261** になった。機能やテストケースの削減による整理ではない。

## 主な保存先

| 対象 | 主要ファイル |
| --- | --- |
| 基本UI・入力・ダイアログ・通知表示 | `src/components/ui/button.tsx` |
| ナビゲーション・アカウント切り替え | `src/components/layout/AppLayout.tsx` |
| 投稿・引用・投票・返信 | `src/components/feed/QuotedPost.tsx`、`PostPoll.tsx`、`src/components/post/CommentList.tsx` |
| プロフィール・編集・フォロー | `src/components/profile/ProfileHeader.tsx`、`ProfileEditor.tsx` |
| 検索・リスト・通知・プロフィールAPI | `src/api/search-news.ts`、`lists.ts`、`directMessages.ts`、`users.ts` |
| 音声・通話・チャット | `src/lib/callRecorder.ts`、`src/lib/aiFriends.ts`、`src/components/chat/FriendProfile.tsx` |
| 地図・スペース | `src/components/maps/LimeMap.tsx`、`src/components/spaces/SpaceProvider.tsx` |
| スタイル | `src/index.css` |
| ブラウザ検証の設定 | `playwright.config.ts` |

## 動作上の境界

行数が少なくても、次の役割は分離を維持する。

- ReactのContextは循環参照を避けるため、小さな共有モジュールを維持する。
- Worker、MV3拡張機能のbackground/content/popup、Supabase Edge Functionの入口は、それぞれの実行環境に置く。
- 既存のDBマイグレーション履歴とツールが読む設定入口は維持する。
- ブラウザ・サーバー・Workerで共有する純粋な処理を、ブラウザ専用の初期化を含むファイルへ混ぜない。
- Node/jsdom/Denoの実行環境やモックの分離が必要なテストは独立させる。
- モデル保存・形式判定は `avatarModels.ts`、Three.jsを使う実行処理は `avatarRuntime.ts` にまとめ、3D機能を開く前のエンジン取得を防ぐ。
- 音楽の係数データは `src/assets/audio/space-spectrum.gz` に移した。元のデータとのバイト一致を確認した。音楽生成時に取得し、利用後のオフラインキャッシュも維持する。

各機能の主要実装は、500行以下であっても主要ファイルとして維持する。行数を増やすための改行削減や、実装を残したままの再エクスポート専用ファイルの追加は行わない。

## 検証

- 変更前・変更後の全ユニットテストは1,461件成功、既存の失敗1件、スキップ1件（合計1,463件）。既存の失敗は `src/api/recommendations.test.ts` の関連画像の推薦テスト。
- TypeScriptの型チェックと本番PWAビルドを実行。
- Denoの統合対象テスト30件、および影響するEdge Functionの型チェックを実行。
- Chromeで投稿・リスト・チャット、モバイルスワイプ、検索表示、視聴履歴フォームの明暗・画面幅を検証。
- Chrome PWAの起動・再起動・サーバー停止時のオフライン動作・更新時の再読み込みを検証。
- 集約した21個のブラウザ検証設定と従来の標準設定について、実行オプションが変更前と一致することを比較。

公開・push、DB変更、Edge Functionのデプロイは今回実施していない。

## ブラウザ検証

標準のアバター検証は従来どおり `npm run test:avatars`。個別の検証は例えば次のように実行する。

```sh
LIME_BROWSER_SUITE=bookmarks npx playwright test
LIME_BROWSER_SUITE=pwa npx playwright test --project=Chrome-PWA
LIME_BROWSER_SUITE=topics:topics npx playwright test
```

## 統合先一覧

| 旧ファイル | 統合先 |
| --- | --- |
| `src/api/account-about.ts` | `src/api/users.ts` |
| `src/api/accountPrivacy.ts` | `src/api/users.ts` |
| `src/api/bookmarks.ts` | `src/api/lists.ts` |
| `src/api/external-likes.ts` | `src/api/external-posts.ts` |
| `src/api/external-map-posts.ts` | `src/api/external-posts.ts` |
| `src/api/followLists.ts` | `src/api/users.ts` |
| `src/api/follows.ts` | `src/api/users.ts` |
| `src/api/notifications.ts` | `src/api/directMessages.ts` |
| `src/api/polls.ts` | `src/api/comments.ts` |
| `src/api/post-activity.ts` | `src/api/comments.ts` |
| `src/api/profile-highlights.ts` | `src/api/comments.ts` |
| `src/api/recommendation-feedback.ts` | `src/api/recommendations.ts` |
| `src/api/reply-reposts.ts` | `src/api/external-posts.ts` |
| `src/api/repost-state.ts` | `src/api/external-posts.ts` |
| `src/api/scheduledPosts.ts` | `src/api/comments.ts` |
| `src/api/spaces.ts` | `src/api/lists.ts` |
| `src/api/topic-feed.ts` | `src/api/topics.ts` |
| `src/api/trends.ts` | `src/api/topics.ts` |
| `src/api/twitter-trends.ts` | `src/api/search-news.ts` |
| `src/api/twitter-videos.ts` | `src/api/search-news.ts` |
| `src/components/NavLink.tsx` | `src/components/layout/AppLayout.tsx` |
| `src/components/SpotifyEmbed.tsx` | `src/components/YouTubeEmbed.tsx` |
| `src/components/account/AccountSuspension.tsx` | `src/components/layout/AppLayout.tsx` |
| `src/components/ai/ChatPostPreview.tsx` | `src/components/ai/PageCompanion.tsx` |
| `src/components/chat/DirectChatMessage.tsx` | `src/components/chat/FriendProfile.tsx` |
| `src/components/chat/DirectGroupDialogs.tsx` | `src/components/chat/FriendProfile.tsx` |
| `src/components/chat/PixelCat.tsx` | `src/components/chat/FriendProfile.tsx` |
| `src/components/chat/friend-profile.css` | `src/index.css` |
| `src/components/chat/pixel-cat.css` | `src/index.css` |
| `src/components/common/OfficialBadge.tsx` | `src/components/ui/avatar.tsx` |
| `src/components/feed/ComposerIcon.tsx` | `src/components/feed/PostPoll.tsx` |
| `src/components/feed/ExternalPostDetails.test.tsx` | `src/components/feed/QuotedPost.test.tsx` |
| `src/components/feed/PostCardSkeleton.tsx` | `src/components/feed/PostPoll.tsx` |
| `src/components/feed/PostImages.tsx` | `src/components/feed/QuotedPost.tsx` |
| `src/components/feed/PostPoll.test.tsx` | `src/components/feed/PollEditor.test.tsx` |
| `src/components/feed/QuoteModal.test.tsx` | `src/components/feed/QuotedPost.test.tsx` |
| `src/components/feed/quoted-post.css` | `src/index.css` |
| `src/components/layout/AccountSwitcher.tsx` | `src/components/layout/AppLayout.tsx` |
| `src/components/layout/BottomNav.tsx` | `src/components/layout/AppLayout.tsx` |
| `src/components/layout/DesktopSidebar.tsx` | `src/components/layout/AppLayout.tsx` |
| `src/components/layout/Logo.tsx` | `src/components/layout/AppLayout.tsx` |
| `src/components/layout/ScrollToTop.tsx` | `src/components/layout/AppLayout.tsx` |
| `src/components/layout/desktop-layout.css` | `src/index.css` |
| `src/components/maps/PostLocationEditor.tsx` | `src/components/maps/LimeMap.tsx` |
| `src/components/maps/maps.css` | `src/index.css` |
| `src/components/media/VideoLightboxPlayer.tsx` | `src/components/video/PostVideoPlayer.tsx` |
| `src/components/media/media-lightbox.css` | `src/index.css` |
| `src/components/post/BookmarkButton.tsx` | `src/components/feed/RepostButton.tsx` |
| `src/components/post/ExternalLikeButton.tsx` | `src/components/feed/RepostButton.tsx` |
| `src/components/post/LinkPreviewCard.tsx` | `src/components/feed/QuotedPost.tsx` |
| `src/components/post/PostActionSheet.tsx` | `src/components/feed/RepostButton.tsx` |
| `src/components/post/PostSourceLabel.tsx` | `src/components/feed/QuotedPost.tsx` |
| `src/components/post/ReplyChain.tsx` | `src/components/post/CommentList.tsx` |
| `src/components/post/ReplyShare.tsx` | `src/components/post/CommentList.tsx` |
| `src/components/post/post-actions.css` | `src/index.css` |
| `src/components/profile/AccountPrivacySettings.tsx` | `src/components/profile/ProfileEditor.tsx` |
| `src/components/profile/FollowButton.tsx` | `src/components/profile/ProfileHeader.tsx` |
| `src/components/profile/PostTabMenu.tsx` | `src/components/profile/ProfileMediaPreview.tsx` |
| `src/components/profile/ProfileImageCropper.tsx` | `src/components/profile/ProfileEditor.tsx` |
| `src/components/profile/ProfileVirtualizedRow.tsx` | `src/components/profile/ProfileMediaPreview.tsx` |
| `src/components/reviews/AccountReviewsTab.tsx` | `src/components/lists/ListDialogs.tsx` |
| `src/components/search/SearchExploreTabs.tsx` | `src/components/search/SearchExploreContent.tsx` |
| `src/components/search/StockMarketCard.tsx` | `src/components/search/SearchExploreContent.tsx` |
| `src/components/search/UserCard.tsx` | `src/components/search/SearchExploreContent.tsx` |
| `src/components/search/stock-market.css` | `src/index.css` |
| `src/components/spaces/SpacePostCard.tsx` | `src/components/spaces/SpaceProvider.tsx` |
| `src/components/spaces/SpaceRoom.tsx` | `src/components/spaces/SpaceProvider.tsx` |
| `src/components/spaces/spaces.css` | `src/index.css` |
| `src/components/stickers/OfflineBookmarkContext.ts` | `src/components/stickers/Stickers.tsx` |
| `src/components/ui/dialog.tsx` | `src/components/ui/button.tsx` |
| `src/components/ui/dropdown-menu.tsx` | `src/components/ui/button.tsx` |
| `src/components/ui/popover.tsx` | `src/components/ui/button.tsx` |
| `src/components/ui/sonner.tsx` | `src/components/ui/button.tsx` |
| `src/components/ui/tabs.tsx` | `src/components/ui/button.tsx` |
| `src/components/ui/toast.tsx` | `src/components/ui/button.tsx` |
| `src/components/video/PostVideoThumbnail.tsx` | `src/components/video/PostVideoPlayer.tsx` |
| `src/components/video/post-video.css` | `src/index.css` |
| `src/hooks/sharedPwaSubscriptions.test.tsx` | `src/hooks/useViewportWidth.test.tsx` |
| `src/hooks/use-mobile.tsx` | `src/hooks/useViewportWidth.ts` |
| `src/hooks/use-toast.ts` | `src/components/ui/button.tsx` |
| `src/hooks/useBlueskySession.ts` | `src/hooks/useAuth.tsx` |
| `src/hooks/useIncomingFriendCalls.ts` | `src/components/chat/CallSessionProvider.tsx` |
| `src/hooks/useLists.ts` | `src/hooks/useTopics.ts` |
| `src/hooks/useMembership.ts` | `src/hooks/useAuth.tsx` |
| `src/hooks/useOfflineBookmarks.ts` | `src/hooks/useSharedAccountLists.ts` |
| `src/hooks/usePostNotifications.ts` | `src/hooks/useOSNotification.ts` |
| `src/hooks/useProfileHighlights.ts` | `src/hooks/useTopics.ts` |
| `src/hooks/useRecommendationImpressions.ts` | `src/hooks/useRecommendationImages.ts` |
| `src/hooks/useSharedListUpdates.ts` | `src/hooks/useSharedAccountLists.ts` |
| `src/hooks/useTimelineFeed.ts` | `src/hooks/useFeed.ts` |
| `src/hooks/useTrendViews.ts` | `src/hooks/useTopics.ts` |
| `src/hooks/useTrends.ts` | `src/hooks/useTopics.ts` |
| `src/hooks/useUnreadNotifications.ts` | `src/hooks/useOSNotification.ts` |
| `src/lib/accountSearch.ts` | `src/api/users.ts` |
| `src/lib/agora.ts` | `src/components/spaces/SpaceProvider.tsx` |
| `src/lib/aiSpeech.ts` | `src/lib/callRecorder.ts` |
| `src/lib/avatarLipSync.ts` | `src/lib/avatarRuntime.ts` |
| `src/lib/blueskySearchRelay.ts` | `src/api/search-news.ts` |
| `src/lib/callTranscription.ts` | `src/lib/callRecorder.ts` |
| `src/lib/chatImageCache.ts` | `src/lib/aiFriends.ts` |
| `src/lib/chatImageStore.ts` | `src/lib/offlineBookmarks.ts` |
| `src/lib/chatModelFallback.test.ts` | `src/lib/callRecorder.test.ts` |
| `src/lib/chatModelFallback.ts` | `src/lib/aiFriends.ts` |
| `src/lib/clientName.ts` | `src/lib/utils.ts` |
| `src/lib/commentThread.test.ts` | `src/lib/postPresentation.test.ts` |
| `src/lib/commentThread.ts` | `src/lib/postPresentation.ts` |
| `src/lib/companionPreferences.ts` | `src/lib/aiFriends.ts` |
| `src/lib/companyLoginReturn.ts` | `src/lib/accountSuspension.ts` |
| `src/lib/devFunctionFetch.ts` | `src/lib/privateMediaFetch.ts` |
| `src/lib/documentText.ts` | `src/lib/sandboxExecution.ts` |
| `src/lib/externalProfileMetadata.ts` | `src/lib/externalAccounts.ts` |
| `src/lib/format.ts` | `src/lib/utils.ts` |
| `src/lib/highwayLabels.ts` | `src/components/maps/LimeMap.tsx` |
| `src/lib/highwayNumbering.ts` | `src/components/maps/LimeMap.tsx` |
| `src/lib/hlsPlayback.ts` | `src/components/video/PostVideoPlayer.tsx` |
| `src/lib/incomingRingtone.ts` | `src/lib/spacePlayback.ts` |
| `src/lib/likeCountCache.ts` | `src/lib/postPresentation.ts` |
| `src/lib/limeMapStyle.ts` | `src/components/maps/LimeMap.tsx` |
| `src/lib/linkPreview.test.ts` | `src/lib/postPresentation.test.ts` |
| `src/lib/linkPreview.ts` | `src/lib/mediaThumbnail.ts` |
| `src/lib/listLimits.ts` | `src/lib/accountSuspension.ts` |
| `src/lib/mapPostIcon.ts` | `src/components/maps/LimeMap.tsx` |
| `src/lib/marketData.ts` | `src/api/search-news.ts` |
| `src/lib/mediaThumbnail.test.ts` | `src/lib/mediaThumbnail.test.tsx` |
| `src/lib/microphone.ts` | `src/lib/callRecorder.ts` |
| `src/lib/mmdAvatar.test.ts` | `src/lib/avatarModels.test.ts` |
| `src/lib/mmdAvatar.ts` | `src/lib/avatarRuntime.ts` |
| `src/lib/mobileDrawerGesture.ts` | `src/lib/utils.ts` |
| `src/lib/notificationBadge.ts` | `src/lib/registerPwa.ts` |
| `src/lib/notificationToast.ts` | `src/lib/registerPwa.ts` |
| `src/lib/observePostElements.ts` | `src/hooks/useViewportWidth.ts` |
| `src/lib/polls.ts` | `src/lib/postPresentation.ts` |
| `src/lib/postVideo.ts` | `src/lib/mediaThumbnail.ts` |
| `src/lib/postVideoStorage.ts` | `src/lib/uploadPostMedia.ts` |
| `src/lib/privateProfile.ts` | `src/lib/accountSuspension.ts` |
| `src/lib/profileReplyThreads.test.ts` | `src/lib/postPresentation.test.ts` |
| `src/lib/profileReplyThreads.ts` | `src/lib/postPresentation.ts` |
| `src/lib/randomUUID.test.ts` | `src/lib/privateMediaFetch.test.ts` |
| `src/lib/randomUUID.ts` | `src/lib/utils.ts` |
| `src/lib/recommendationCatalog.ts` | `src/lib/recommendations.ts` |
| `src/lib/recommendationSignals.test.ts` | `src/lib/recommendations.test.ts` |
| `src/lib/recommendationSignals.ts` | `src/lib/recommendations.ts` |
| `src/lib/recommendationVisual.test.ts` | `src/lib/recommendations.test.ts` |
| `src/lib/recommendationVisualQueue.ts` | `src/lib/recommendationVisualInference.ts` |
| `src/lib/savedAccounts.test.ts` | `src/lib/savedAccounts.test.tsx` |
| `src/lib/search-trends.ts` | `src/lib/topics.ts` |
| `src/lib/sharedAccountDisplay.test.tsx` | `src/lib/savedAccounts.test.tsx` |
| `src/lib/sharedAccountDisplay.ts` | `src/lib/externalAccounts.ts` |
| `src/lib/spaceMusicScore.ts` | `src/lib/spaceMusic.ts` |
| `src/lib/spaceWaitingAudio.ts` | `src/lib/spacePlayback.ts` |
| `src/lib/stickers.ts` | `src/lib/utils.ts` |
| `src/lib/timelineTabs.test.ts` | `src/lib/postPresentation.test.ts` |
| `src/lib/topicRecommendations.ts` | `src/lib/recommendations.ts` |
| `src/lib/trendViews.test.ts` | `src/lib/recommendations.test.ts` |
| `src/lib/twitterReplyPaging.test.ts` | `src/lib/postPresentation.test.ts` |
| `src/lib/twitterReplyPaging.ts` | `src/lib/postPresentation.ts` |
| `src/lib/twitterSearch.ts` | `src/api/search-news.ts` |
| `src/lib/twitterSearchRelay.ts` | `src/api/search-news.ts` |
| `src/lib/uploadCommentImages.ts` | `src/lib/uploadPostMedia.ts` |
| `src/lib/videoSoundPreference.test.tsx` | `src/lib/mediaThumbnail.test.tsx` |
| `src/pages/AccountAboutPage.tsx` | `src/pages/Profile.tsx` |
| `src/pages/FollowersFollowingPage.tsx` | `src/pages/Bookmarks.tsx` |
| `src/pages/Lists.tsx` | `src/pages/Bookmarks.tsx` |
| `src/pages/NewsPage.tsx` | `src/pages/Topics.tsx` |
| `src/pages/NotFound.tsx` | `src/pages/Topics.tsx` |
| `src/pages/Notifications.tsx` | `src/pages/Topics.tsx` |
| `src/pages/PostActivity.tsx` | `src/pages/PostDetail.tsx` |
| `src/pages/ReplyDetail.tsx` | `src/pages/PostDetail.tsx` |
| `src/pages/Share.tsx` | `src/pages/PostDetail.tsx` |
| `src/pages/SpacePage.tsx` | `src/components/spaces/SpaceProvider.tsx` |
| `src/pages/direct-messages.css` | `src/index.css` |
| `src/pages/settings.css` | `src/index.css` |
| `src/pages/watch-history.css` | `src/index.css` |
| `supabase/functions/_shared/friendImages.ts` | `supabase/functions/_shared/chatContext.ts` |
| `supabase/functions/_shared/friendImages_test.ts` | `supabase/functions/_shared/chatContext_test.ts` |
| `supabase/functions/direct-media/signing.ts` | `supabase/functions/direct-media/index.ts` |
| `supabase/functions/link-preview/geoMaps.ts` | `supabase/functions/link-preview/maps.ts` |
| `supabase/functions/link-preview/geoMaps_test.ts` | `supabase/functions/link-preview/maps_test.ts` |
| `tests/account-switching/playwright.config.ts` | `playwright.config.ts` |
| `tests/bookmarks/offline-pwa.config.ts` | `playwright.config.ts` |
| `tests/bookmarks/playwright.config.ts` | `playwright.config.ts` |
| `tests/desktop-layout/playwright.config.ts` | `playwright.config.ts` |
| `tests/link-preview/playwright.config.ts` | `playwright.config.ts` |
| `tests/maps/playwright.config.ts` | `playwright.config.ts` |
| `tests/media-lightbox/playwright.config.ts` | `playwright.config.ts` |
| `tests/mobile-chat/playwright.config.ts` | `playwright.config.ts` |
| `tests/profile-fixes/playwright.config.ts` | `playwright.config.ts` |
| `tests/profile-highlights/playwright.config.ts` | `playwright.config.ts` |
| `tests/profile-highlights/reviews.config.ts` | `playwright.config.ts` |
| `tests/profile-pins/playwright.config.ts` | `playwright.config.ts` |
| `tests/pwa/playwright.config.ts` | `playwright.config.ts` |
| `tests/quotes/playwright.config.ts` | `playwright.config.ts` |
| `tests/recommendation-vision/visual.config.ts` | `playwright.config.ts` |
| `tests/search-explore/playwright.config.ts` | `playwright.config.ts` |
| `tests/settings/settings.config.ts` | `playwright.config.ts` |
| `tests/spaces/playwright.config.ts` | `playwright.config.ts` |
| `tests/stickers/playwright.config.ts` | `playwright.config.ts` |
| `tests/tablet-layout/playwright.config.ts` | `playwright.config.ts` |
| `tests/topics/topics.config.ts` | `playwright.config.ts` |
| `scripts/analyze-corrected-space-music.py` | `scripts/analyze-space-music.py` |
| `src/data/users.ts` | `src/data/posts.ts` |
| `src/data/comments.ts` | `src/data/posts.ts` |

## iOS PWA の性能検証（2026-10-19）

- `src/pages/Feed.tsx`: スクロール中の一覧先頭の位置計測をレイアウト変更時へ移し、実測高さの累積値を再利用して表示範囲を二分探索する。iOS PWAでは120pxの移動単位で一覧を更新し、前後4投稿の余裕を維持する。先頭80pxの通知境界や画面サイズ・投稿高さの変化は移動単位に関係なく反映する。
- `src/hooks/useViewportWidth.ts`: PWA判定を共有ストアにし、初回から正しいレイアウトを描画する。200個の利用箇所でもネイティブの監視は1つで、アンマウント時に解除する。
- `vite.config.ts`: 地図・DM・HLSの遅延読み込み用資産をインストール時の事前キャッシュから除外する。既存の機能用CacheFirstキャッシュは維持し、使った機能をキャッシュする。事前キャッシュは6890.72KiBから4964.42KiBへ削減した。

`node scripts/verify-layout.mjs timeline-notice` は、iPhone相当のUA・390px・CPU速度4分の1で通常サイトとPWAの同一スクロールを比較する。初回と高さ計測済みの再スクロールで空白が出ないこと、新着通知・タブ別の閲覧位置を維持すること、PWAの不要なReact更新が通常サイトより少ないことを確認する。`mobile-pwa-performance` コマンドでは80投稿と200利用箇所の購読・解除も検証する。

数値はChromeによる条件付き検証であり、iPhone実機のSafari/WebKitによるフレームレート測定ではない。初回に使う追加機能のダウンロードは必要になるため、初回とキャッシュ済みを分けて評価する。公開は別途明示的な指示がある場合に限る。

今回の比較では、同じ120回のスクロール操作で通常サイト119回、iOS相当PWAは初回89回・再スクロール72回のReact更新となった。空白フレームはすべて0。フレーム中央値はいずれも約33.3msで、この検証からFPSの向上は主張しない。PWA起動・再起動・オフライン起動・更新時の1回だけの再読み込みは、ChromeとWebKit-iPhoneの6ケースを通過した。

### PWAの追加改善・動画再生（2026-10-19）

プロフィールHeaderは名前・カバー・自己紹介のドキュメント上の位置をキャッシュし、ResizeObserver・画面サイズ変更・プロフィール情報更新時に再計測する。固定バーの装飾を書き換える前に計測を終え、スクロールごとの強制レイアウトを避ける。100フレームのプロフィールスクロールで対象要素の追加位置計測0回を確認。モバイルのキーボード監視もイベントを1フレームにまとめ、実際に下端位置が変わった場合だけReactを更新する。

`PostVideoPlayer.tsx` のネイティブプレイヤー（LimeNote・Twitter/X・Bluesky・Misskeyの直接MP4/HLS）には、対応OSのAudio SessionとMedia Sessionを登録する。音声オンの再生にだけロック画面の再生・停止・シークを結び付け、無音の自動再生では他の音声を奪わない。画面非表示を理由にアプリから一時停止する処理は追加しない。閉じる・別の動画に切り替える・ユーザーが停止する場合は従来どおり終了する。画面非表示中の再生位置によるReact更新は省く。

iOSなどネイティブHLSに対応する環境では、HLS用JavaScriptを読み込む前にネイティブ再生を選ぶ。公開された外部MP4は、既存のno-referrerポリシーの下で直接ストリーミングし、再生開始前の全ファイルBlob化を避ける。非公開のLimeNote動画の認証・Blob経路は維持する。標準PiPに加えSafariのpresentation-mode方式にも対応する。

OSによる音声中断や省電力停止をPWAから必ず回避できるとは保証しない。YouTube等の別オリジンのiframeはネイティブプレイヤーと別であり、この変更で提供元の制約を解除するものではない。画面ロック・他アプリ切替の継続性はiPhone実機で確認が必要。実装の基準は [W3C Audio Session](https://www.w3.org/TR/audio-session/) と [WebKitのMediaSession対応](https://webkit.org/blog/11989/new-webkit-features-in-safari-15/)。

### 投稿メディアの初期サイズ（2026-10-20）

投稿カード・投稿詳細・返信の単一画像は `mediaThumbnail.ts` の共通処理で初回の枠を確定する。外部SNSの縦横比、新規LimeNote画像の保存名に含む寸法、既知の寸法を優先し、不明な既存メディアには16:9の固定枠を使う。寸法が既知の画像のload・動画のloadedmetadataでは枠を変更せず、元画像はcontainで枠内に表示する。寸法不明の過去画像は、読み込み時に確保済みの高さを保って横幅だけ縦画像に合わせ、左右の大きな余白と縦方向のレイアウト移動を防ぐ。複数画像も絶対配置でグリッドの行高に実画像の高さが影響しないようにする。待機中はテーマの背景色と細い境界線のみで画像の場所を確保する。

新規のLimeNote画像・返信画像はローカルで寸法を読み、既存のStorageオブジェクト名を `UUID--幅x高さ.拡張子` にする。既存URL・保存先・認証方式を維持し、閲覧時に動画の全ダウンロードや寸法確認だけの追加通信は行わない。過去画像の一括ダウンロード・書換えは行わない。DBの互換ルール変更は適用・履歴登録済み。公開・pushは未実施。

### 引用・検索・保存済み投稿の表示修正（2026-10-20）

外部ブックマークといいねのスナップショットは、画像の縦横比、引用フラグ、公開された外部の引用元（深さ2まで）、認証情報を保存する。非公開の引用元や認証用トークンは保存しない。従来の保存済み投稿は不足がある場合だけ公開APIから補完し、同時実行3件・最大200件の5分キャッシュで重複読み込みを防ぐ。バックグラウンドの定期取得やDBの書換えは行わない。ネイティブ引用の再取得には現在の閲覧者、保存アカウントごとの参照には指定されたAccountReadContextを使い、RLSを維持する。いいね欄のauthor変換でもproviderVerificationを残す。

検索のアカウントタブだけを平らな一覧にし、アイコン・名前・ユーザー名・フォロー操作の下で自己紹介を横幅いっぱいに表示する。他のUserCard利用箇所のレイアウトと既存Headerは維持する。Bluesky・Misskeyの投稿検索は各提供元のカーソルを管理し、メディアに一致しないページを途中の終端と扱わない。表示待ちの結果が十分にある提供元は取得を休み、バッファを使ってから次のページへ進む。MisskeyのuntilIdは[公式API実装](https://github.com/misskey-dev/misskey/blob/develop/packages/backend/src/server/api/endpoints/notes/search.ts)に沿う。

DB変更・テーブル追加・公開・pushは行っていない。引用・バッジ・寸法不足の補完は既存の保存先と公開APIを使う。

### 公開フォローの引き継ぎ（2026-10-20）

設定の「その他のSNS連携」はTwitter／BlueskyのID欄と引き継ぎ操作に絞る。片方でも両方でも実行でき、公開アカウントのフォロー先を既存の `follows` に100件単位で追加する。重複する既存フォローは変更しない。登録済みアカウントの一覧、通常の追加ボタン、Blueskyログイン欄は削除した。他の画面のフォロー操作と保存済みBlueskyセッションは維持する。

引き継ぎで新しく挿入する行だけ、既存 `external_profile` JSONの `followImport` に `kind: public-follow-import`、version、batchId、source、actor、importedAtを記録する。「削除」は記録された対象がある時だけ引き継ぎボタンの横に表示し、同じ所有者のTwitter／Blueskyかつkindが一致する行だけ削除する。既存・手動追加・LimeNote内のフォローを巻き込まない。識別記録のない過去データは推測で削除しない。テーブル・DBカラムの追加は不要。

空の最終ページにカーソルが残る場合も終了し、同じページやIDの繰り返しは停止する。アカウント変更とキャンセルを確認し、取得と保存の待機時間を制限する。進行中表示は成功・失敗・中止で解除する。既存の外部フォロー読み込みは1,000件ごとにページングする。定期同期・ポーリングは追加していない。

Blueskyは匿名の公開APIで一覧と次ページカーソルの実取得を確認した。Twitterは[FxEmbedの公開フォローAPI仕様](https://docs.fxembed.com/api/twitter/operations/2profilehandlefollowing/)に対応するが、今回の実接続ではプロフィール・一覧とも404となった。API取得失敗を0件の移行成功として扱わず、ユーザー指定により画面にはエラーを表示しない。失敗時も処理中表示を解除し、再操作できるようにする。Twitterの成功系はAPIレスポンスを固定したブラウザ検証で確認しており、実データの移行完了を確認したものではない。公開・push・DB構造変更は未実施。

### 公開前検証（2026-10-20）

ユーザーの公開指示により、構成整理と各画面の修正をGitHub Pagesへ公開する。型チェック・本番ビルド・秘密情報検査が成功。全ユニットテストは1,531件成功、以前からの推薦テスト1件失敗、1件スキップ。フォロー引き継ぎのローカルDB検証、直近のPC／320pxモバイルの操作検証4件とEdge Function検証58件が成功（別途1件スキップ）。接続先DBの通知・いいね・画像寸法の適用履歴、フォローのJSON列とX対応制約、動画寸法、廃止モデル列の削除を読み取り確認し、追加DDLは不要と判断した。変更された既存Edge Functionと共有コードの利用先9件を配備した。Twitterの公開APIでの実移行成功は未確認であり、API障害が解消したことを示すものではない。
