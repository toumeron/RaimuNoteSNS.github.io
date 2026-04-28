// ムリムリSNS 共通型定義

export type User = {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string;
  coverUrl: string;
  createdAt: string;
  isOfficial?: boolean; 
};

export type Post = {
  id: string;
  userId: string;
  content: string;
  imageUrls: string[];
  createdAt: string;
  likesCount: number;
  commentsCount: number;
  likedByMe: boolean;
  clientName?: string;
  // --- リポスト機能用の追加 ---
  parentId?: string | null;      // 親投稿のID
  isQuote?: boolean;             // 引用リポストかどうか
  repostsCount: number;          // リポスト数
  repostedByMe: boolean;         // 自分がリポスト済みか
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
  // 親投稿の情報（1階層分のみ保持）
  parentPost?: (Post & { author: User }) | null;
};

export type CommentWithAuthor = Comment & {
  author: User;
};