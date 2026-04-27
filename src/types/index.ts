// ムリムリSNS 共通型定義

export type User = {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string;
  coverUrl: string;
  createdAt: string;
  // --- ここを追加！ ---
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
};

// ...以下、Comment や Follow は変更なし
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
