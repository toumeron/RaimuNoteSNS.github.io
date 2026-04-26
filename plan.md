# わたなれ風 SNSアプリ（フロントエンドのみ）実装計画

「わたしが恋人になれるわけないじゃん、ムリムリ！」公式サイトのビジュアルを踏襲したSNSフロントエンドを構築します。バックエンド接続は行わず、後で自前のVite環境＋Supabase APIに繋げやすい構造で実装します。

---

## 1. デザインコンセプト（わたなれ踏襲・SNS最適化）

**配色（HSLトークン化 / `index.css`）**
- `--primary` ホットピンク `340 85% 62%`（「恋人」のピンク）
- `--accent` ティール `185 70% 55%`（「ムリムリ！」のティール）
- `--background` クリーム `45 50% 97%`（紙地ベージュ）
- `--secondary` ペールピンク `345 100% 95%`
- `--foreground` ダークブラウン `25 30% 20%`
- `--muted-foreground` グレージュ `25 10% 50%`
- ハート♥モチーフをアクセント装飾として使用

**タイポグラフィ（Google Fonts）**
- 見出し: `Zen Maru Gothic`
- 本文: `M PLUS Rounded 1c`

**コンポーネント形状**
- カード: 大きめ角丸 `--radius: 1rem`、薄ピンクのドロップシャドウ
- ボタン: 丸ピル型、ホバーで微小スケール
- 余白ゆったり（カード間 `gap-6`、内部 `p-6`）
- ハート/紙吹雪パターンを認証ページとヘッダー背景に薄く配置

---

## 2. ディレクトリ構成（後でAPI差し替えやすい二層構造）

```text
src/
├── types/             … User, Post, Comment, Like, Follow の型定義
├── data/              … ダミーJSON（users.json, posts.json, comments.json…）
├── api/               … getPosts(), createPost(), toggleLike() などの非同期関数
│                       現在は data/ から返却。後で fetch / supabase 呼び出しに差替え
├── hooks/             … useFeed, usePost, useProfile … TanStack Query ラッパ
├── components/
│   ├── layout/        … Header, BottomNav, SideNav, PageBackground
│   ├── feed/          … PostCard, PostComposer, FeedList, FeedSkeleton
│   ├── post/          … LikeButton, CommentList, CommentForm
│   └── profile/       … ProfileHeader, FollowButton, EditProfileForm
├── pages/             … Auth, Index(Feed), PostDetail, Profile, Settings
└── lib/               … utils, dayjs設定, zodスキーマ
```

**API層の例（差し替えやすい形）**
```ts
// src/api/posts.ts
export async function getPosts(): Promise<Post[]> {
  await new Promise(r => setTimeout(r, 300)); // 読込感を再現
  return postsData; // 後で fetch('/api/posts') 等に置換
}
```

---

## 3. ダミーデータ

- **users.json** … 8〜10名分（多様な表示名・自己紹介・アバター）
- **posts.json** … 25〜30件、画像有無混在、複数画像投稿あり、いいね・コメント数バラつき
- **comments.json** … 投稿に紐づくコメント数十件
- 画像は Unsplash の URL を使用（投稿画像・アバター・カバー）
- 「現在のログインユーザー」は固定のダミーIDを `src/lib/currentUser.ts` で定義

---

## 4. 画面構成

| ルート | 内容 |
|---|---|
| `/auth` | ログイン/サインアップ画面（タブ切替・装飾入りデザイン）。送信で固定ダミーユーザーとしてログイン扱い→`/`へ遷移 |
| `/` | タイムライン（PostComposer + 投稿一覧、新着順） |
| `/post/:id` | 投稿詳細（本文・画像 + コメント一覧 + コメント投稿） |
| `/u/:username` | プロフィール（カバー+アバター+自己紹介+フォロー数+本人投稿一覧+フォローボタン） |
| `/settings` | プロフィール編集（表示名・自己紹介・アバター/カバー画像アップロードUI。画像はObjectURLでプレビュー） |

共通レイアウト: 上部にロゴ風ヘッダー（「♥ムリムリSNS」風ロゴ）、デスクトップではサイドナビ、モバイルでは下部固定ナビ。

---

## 5. コア機能（フロントエンドのみで完結）

**認証画面（UIのみ）**
- メール/パスワードフォーム、zod バリデーション、エラー表示
- 送信成功で固定ダミーユーザーとして `/` に遷移
- ※ 実際のセッション管理は後でSupabase Authに繋ぐ前提でTODOコメント

**動的フィード**
- TanStack Query `useQuery(['posts'], getPosts)` でダミー取得
- 読込中: shadcn Skeleton で投稿カード3枚分のスケルトン
- 失敗時: sonner トースト＋再試行ボタン（API層でわざとrejectして検証可能）

**投稿コンポーザー**
- テキスト最大500文字（zod + 文字数カウンタ）
- 画像最大4枚、`URL.createObjectURL` でプレビュー、削除可能
- 送信で `createPost` 呼び出し→クエリinvalidate→フィードに即時反映

**いいね（ローカルstate模擬）**
- ハート♥ボタン、押下でカウント±1＆色反転（即時反映）
- リロードでダミーJSONの初期値に戻る（後でAPI接続時に永続化）

**コメント（ローカルstate模擬）**
- 投稿詳細でコメント一覧表示・フォーム送信→即時リスト追加
- リロードで初期値に戻る

**プロフィール**
- カバー画像 + アバター + 表示名 + @username + 自己紹介 + フォロー数/フォロワー数
- フォローボタン（ローカルstateでトグル）
- 本人投稿一覧（`getPostsByUser` で抽出）

**プロフィール編集**
- 表示名・自己紹介・アバター/カバー画像アップロードUI
- 画像はObjectURLでプレビューのみ、送信でローカルstate更新（永続化はTODO）

---

## 6. 技術スタック

- React 18 + Vite + TypeScript（既存）
- Tailwind CSS + shadcn/ui（既存）
- TanStack Query（既存）
- react-router-dom（既存）
- zod（バリデーション）
- sonner（トースト・既導入）
- dayjs（相対時刻表示「3分前」など）
- Google Fonts（Zen Maru Gothic / M PLUS Rounded 1c）

---

## 7. 実装順序

1. デザインシステム整備（`index.css` HSLトークン更新、`tailwind.config.ts` フォント追加、Google Fonts読込）
2. 型定義（`src/types/`）
3. ダミーデータ作成（`src/data/`）
4. API層作成（`src/api/` — Promise返却関数）
5. TanStack Queryフック（`src/hooks/`）
6. 共通レイアウト（Header / SideNav / BottomNav / 背景装飾）
7. 認証ページ（UI＋ダミーログイン）
8. タイムライン + 投稿コンポーザー
9. 投稿詳細 + いいね + コメント
10. プロフィール表示 + フォロー
11. プロフィール編集（画像アップロードUI）
12. 全画面のスケルトン・エラーハンドリング確認

---

## 8. 後でAPI接続するときの差し替えポイント（TODO設計）

- `src/api/*.ts` 内の各関数本体（ダミー返却 → fetch / supabase）
- `src/lib/currentUser.ts`（固定ID → セッション取得）
- `src/pages/Auth.tsx` の送信ハンドラ（ダミー遷移 → `supabase.auth.signIn`）
- 画像アップロード（ObjectURL → Storage upload）

各箇所に `// TODO: connect to Supabase` コメントを残します。
