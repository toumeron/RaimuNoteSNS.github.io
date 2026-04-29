// src/types/index.ts

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
  authorId?: string; // DBの author_id をそのまま受け入れるために重要
  content: string;
  imageUrl?: string | null; 
  imageUrls: string[];
  createdAt: string;
  likesCount: number;
  commentsCount: number;
  likedByMe: boolean;
  clientName?: string;
  
  // --- リポスト機能用の追加 ---
  parentId?: string | null;
  isQuote?: boolean;
  repostsCount: number;
  repostedByMe: boolean;
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
  // 親投稿（リポスト元）も PostWithAuthor 型にすることで、
  // ネストされた投稿でも author にアクセスできるようにします
  parentPost?: PostWithAuthor | null; 
};

export type CommentWithAuthor = Comment & {
  author: User;
};