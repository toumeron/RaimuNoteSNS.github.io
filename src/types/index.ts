// ムリムリSNS 共通型定義
// 後でSupabaseの型と差し替えやすいよう、最小プロパティで定義

export type User = {
  id: string;
  username: string;        // 半角英数字 (例: "hanako_03")
  displayName: string;     // 表示名 (例: "ハナコ")
  bio: string;             // 自己紹介
  avatarUrl: string;
  coverUrl: string;
  createdAt: string;       // ISO
};

export type Post = {
  id: string;
  userId: string;
  content: string;
  imageUrls: string[];
  createdAt: string;       // ISO
  likesCount: number;
  commentsCount: number;
  likedByMe: boolean;
　clientName?: string;     // ← これを追加！ (オプショナル型にしておくのが安全です)
};

export type Comment = {
  id: string;
  postId: string;
  userId: string;
  content: string;
  createdAt: string;
};

export type Follow = {
  followerId: string;
  followingId: string;
};

// 投稿カードに渡しやすくするための拡張型
export type PostWithAuthor = Post & {
  author: User;
};

export type CommentWithAuthor = Comment & {
  author: User;
};
