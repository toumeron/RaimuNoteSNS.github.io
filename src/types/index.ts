// src/types/index.ts

export type User = {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  location?: string;
  avatarUrl: string;
  coverUrl: string;
  createdAt: string;
  isSuspended?: boolean;
  review?: boolean;
  isPrivate?: boolean;
  providerVerification?: { provider: 'twitter'; type: 'individual' | 'organization' | 'government' };
  isOfficial?: boolean;
  emojiEffect?: string; // 絵文字の雨機能用の追加

  // --- Bot代理投稿機能用の追加 ---
  bot_enabled?: boolean; // Bot機能のON/OFF
  bot_prompt?: string;   // AIへの指示内容
};

export type ExternalVideo = { playlist: string; format?: 'hls' | 'mp4'; thumbnail?: string; width: number; height: number; duration: number; alt?: string };

export type ExternalPostDetails = { views?:number; bookmarks?:number; reposts?:number; quotes?:number; poll?:import("@/lib/utils").Poll; communityNote?:string };

export type Post = {
  externalDetails?: ExternalPostDetails;
  externalPinned?: boolean;
  externalRepostedBy?: {id:string;displayName:string;username:string};
  externalVideo?: ExternalVideo;
  video?: import("@/lib/mediaThumbnail").PostVideo | null;
  scheduledAt?:string;
  poll?:import("@/lib/utils").Poll|null;
  mapLocation?: import("@/lib/mapLocation").MapLocation | null;
  languages?: string[];
  recommendationLanguages?: string[];
  imageAltTexts?: string[];
  imageDimensions?: Array<{width:number;height:number}|undefined>;
  contentLabels?: string[];
  recommendationTopics?: string[];
  recommendationSources?: string[];
  recommendationVisual?: import('@/lib/recommendationVisual').RecommendationVisual;
  recommendationVisualStatus?: 'checked'|'unavailable';
  recommendationAuthorTopics?: string[];
  source?: 'lime' | 'bluesky' | 'misskey' | 'x';
  blueskyUrl?: string;
  blueskyUri?: string;
  cid?: string;
  linkPreview?: {url:string;domain:string;title:string;image:string;description?:string};
  id: string;
  userId: string;
  authorId?: string; // DBの author_id をそのまま受け入れるために重要
  content: string;
  imageUrl?: string | null;
  imageUrls: string[];
  createdAt: string;
  likesCount: number;
  /**
   * DBのカラム名変更（comments_count）に合わせ、
   * フロントエンドで一貫して使用する名称に統一
   */
  commentsCount: number;
  likedByMe: boolean;
  clientName?: string;

  // --- リポスト機能用の追加 ---
  parentId?: string | null;
  isQuote?: boolean;
  repostsCount: number;
  repostedByMe: boolean;
  profileRepostedAt?: string;
  profileRepostedBy?: string;
  externalReplyToId?: string;
  externalReplyToUsername?: string;
  externalReplyParent?: PostWithAuthor | null;
  replyId?: string;
  replyPostId?: string;
  replyToUsername?: string;

  // --- 公開範囲制御用の追加 ---
  visibility?: 'public' | 'following'; // これを追加することでエラーが解消されます

  // --- AI生成フラグの追加 ---
  isBot?: boolean; // AIによる自動投稿かどうか
};

export type Comment = {
  clientName?: string;
  id: string;
  postId: string;
  userId: string;
  content: string;
  createdAt: string;
  parentCommentId?: string | null;
  imageUrls?: string[];
  commentsCount?: number;
  likesCount?: number;
  likedByMe?: boolean;
  likes_count?: number; // DBのスキーマに合わせたlikes_count
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
