import {
  useMutation,
  useQuery,
  useInfiniteQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { getUserByUsername, updateProfile } from '@/api/users';
import { getFollowStats, toggleFollow } from '@/api/follows';
import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/currentUser';
import { toast } from 'sonner';
import { User } from '@/types';

export const profileKey = (username: string) => ['profile', username] as const;
export const followStatsKey = (userId: string) => ['follow-stats', userId] as const;
export const userPostsKey = (userId: string) => ['posts', 'user', userId] as const;
export const userLikesKey = (userId: string) => ['posts', 'likes', userId] as const;
export const userMediaKey = (userId: string) => ['posts', 'media', userId] as const;
export const userReactionsKey = (userId: string) => ['posts', 'reactions', userId] as const;

const LIMIT = 10;
const LIKES_FETCH_LIMIT = 30;
const REACTIONS_FETCH_LIMIT = 30;

type ViewerPostAccess = {
  currentUserId: string | null;
  authorIdsFollowingViewer: Set<string>;
};

const toSafeAuthor = (author: any, fallbackUserId: string = '') => {
  const safeUsername = author?.username ?? '';
  const safeDisplayName = author?.display_name ?? author?.displayName ?? safeUsername;

  return {
    id: author?.id ?? fallbackUserId ?? '',
    username: safeUsername,
    display_name: safeDisplayName,
    displayName: safeDisplayName,
    bio: author?.bio ?? '',
    avatar_url: author?.avatar_url ?? author?.avatarUrl ?? null,
    avatarUrl: author?.avatarUrl ?? author?.avatar_url ?? null,
    cover_url: author?.cover_url ?? author?.coverUrl ?? null,
    coverUrl: author?.coverUrl ?? author?.cover_url ?? null,
    created_at: author?.created_at ?? author?.createdAt ?? new Date().toISOString(),
    createdAt: author?.createdAt ?? author?.created_at ?? new Date().toISOString(),
    is_official: !!(author?.is_official ?? author?.isOfficial),
    isOfficial: !!(author?.isOfficial ?? author?.is_official),
    emoji_effect: author?.emoji_effect ?? author?.emojiEffect ?? '',
    emojiEffect: author?.emojiEffect ?? author?.emoji_effect ?? '',
    bot_enabled: !!(author?.bot_enabled ?? author?.botEnabled),
    botEnabled: !!(author?.botEnabled ?? author?.bot_enabled),
    bot_prompt: author?.bot_prompt ?? author?.botPrompt ?? '',
    botPrompt: author?.botPrompt ?? author?.bot_prompt ?? '',
    bot_interval_hours: author?.bot_interval_hours ?? author?.botIntervalHours ?? 5,
    botIntervalHours: author?.botIntervalHours ?? author?.bot_interval_hours ?? 5,
    prefecture: author?.prefecture ?? '',
    city: author?.city ?? '',
  };
};

const toSafePost = (post: any, reaction?: any) => {
  if (!post) return null;

  const safeAuthor = toSafeAuthor(
    post.author ?? post.profiles ?? post.user,
    post.user_id ?? post.userId ?? '',
  );

  const imageUrls = Array.isArray(post.imageUrls)
    ? post.imageUrls
    : Array.isArray(post.image_urls)
      ? post.image_urls
      : [];

  const safeContent = post.content ?? '';

  return {
    ...post,

    id: post.id ?? '',
    user_id: post.user_id ?? post.userId ?? safeAuthor.id,
    userId: post.userId ?? post.user_id ?? safeAuthor.id,

    content: safeContent,

    image_urls: imageUrls,
    imageUrls,

    created_at: post.created_at ?? post.createdAt ?? new Date().toISOString(),
    createdAt: post.createdAt ?? post.created_at ?? new Date().toISOString(),

    likes_count: Number(post.likes_count ?? post.likesCount ?? 0),
    likesCount: Number(post.likesCount ?? post.likes_count ?? 0),

    comments_count: Number(post.comments_count ?? post.commentsCount ?? 0),
    commentsCount: Number(post.commentsCount ?? post.comments_count ?? 0),

    reposts_count: Number(post.reposts_count ?? post.repostsCount ?? 0),
    repostsCount: Number(post.repostsCount ?? post.reposts_count ?? 0),

    liked_by_me: !!(post.liked_by_me ?? post.likedByMe),
    likedByMe: !!(post.likedByMe ?? post.liked_by_me),

    reposted_by_me: !!(post.reposted_by_me ?? post.repostedByMe),
    repostedByMe: !!(post.repostedByMe ?? post.reposted_by_me),

    client_name: post.client_name ?? post.clientName ?? '',
    clientName: post.clientName ?? post.client_name ?? '',

    parent_id: post.parent_id ?? post.parentId ?? null,
    parentId: post.parentId ?? post.parent_id ?? null,

    is_quote: !!(post.is_quote ?? post.isQuote),
    isQuote: !!(post.isQuote ?? post.is_quote),

    visibility: post.visibility ?? 'public',

    is_bot: !!(post.is_bot ?? post.isBot),
    isBot: !!(post.isBot ?? post.is_bot),

    source_twitter: !!(post.source_twitter ?? post.sourceTwitter),
    sourceTwitter: !!(post.sourceTwitter ?? post.source_twitter),

    origin_url: post.origin_url ?? post.originUrl ?? '',
    originUrl: post.originUrl ?? post.origin_url ?? '',

    prefecture: post.prefecture ?? '',
    city: post.city ?? '',

    author: safeAuthor,
    profiles: safeAuthor,
    user: safeAuthor,

    reactionId: reaction?.id ?? post.reactionId ?? null,
    reactionEmoji: reaction?.emoji ?? post.reactionEmoji ?? '',
    reactionCreatedAt: reaction?.created_at ?? post.reactionCreatedAt ?? null,

    reactionEmojis: Array.isArray(post.reactionEmojis)
      ? post.reactionEmojis
      : reaction?.emoji
        ? [reaction.emoji]
        : [],
  };
};

const getPostAuthorId = (post: any) => {
  return post?.user_id ?? post?.userId ?? post?.author?.id ?? post?.profiles?.id ?? '';
};

const getViewerPostAccess = async (): Promise<ViewerPostAccess> => {
  const currentUserId = await getCurrentUserId();

  if (!currentUserId) {
    return {
      currentUserId: null,
      authorIdsFollowingViewer: new Set<string>(),
    };
  }

  const { data, error } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('followee_id', currentUserId);

  if (error) throw error;

  return {
    currentUserId,
    authorIdsFollowingViewer: new Set(
      (data || [])
        .map((follow: any) => follow.follower_id)
        .filter(Boolean),
    ),
  };
};

const canViewPost = (
  post: any,
  currentUserId: string | null,
  authorIdsFollowingViewer: Set<string>,
) => {
  const visibility = post?.visibility ?? 'public';
  const postAuthorId = getPostAuthorId(post);

  if (visibility === 'public') return true;

  if (!currentUserId) return false;

  if (currentUserId === postAuthorId) return true;

  if (visibility === 'following') {
    return authorIdsFollowingViewer.has(postAuthorId);
  }

  return false;
};

const canViewProfileOwnerFollowingPosts = (
  profileOwnerId: string,
  currentUserId: string | null,
  authorIdsFollowingViewer: Set<string>,
) => {
  if (!currentUserId) return false;

  if (currentUserId === profileOwnerId) return true;

  return authorIdsFollowingViewer.has(profileOwnerId);
};

/**
 * プロフィール基本情報
 */
export const useProfile = (username: string | undefined) =>
  useQuery({
    queryKey: profileKey(username ?? ''),
    queryFn: () => getUserByUsername(username!),
    enabled: !!username,
  });

/**
 * プロフィール画面用：投稿一覧
 *
 * 限定公開 following の正しい条件:
 * 投稿者が閲覧者をフォローしている場合のみ表示する。
 */
export const useUserPostsInfinite = (userId: string | undefined) =>
  useInfiniteQuery({
    queryKey: userPostsKey(userId ?? ''),
    queryFn: async ({ pageParam = 0 }) => {
      if (!userId) return [];

      const from = (pageParam as number) * LIMIT;
      const to = from + LIMIT - 1;

      const { currentUserId, authorIdsFollowingViewer } = await getViewerPostAccess();

      const canSeeFollowingPosts = canViewProfileOwnerFollowingPosts(
        userId,
        currentUserId,
        authorIdsFollowingViewer,
      );

      let query = supabase
        .from('posts')
        .select(`
          *,
          author:user_id(*)
        `)
        .eq('user_id', userId);

      if (currentUserId === userId) {
        // 自分のプロフィールでは全て表示
      } else if (canSeeFollowingPosts) {
        query = query.in('visibility', ['public', 'following']);
      } else {
        query = query.eq('visibility', 'public');
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;

      return (data || [])
        .map((post: any) => toSafePost(post))
        .filter(Boolean);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      return (lastPage?.length ?? 0) < LIMIT ? undefined : allPages.length;
    },
    enabled: !!userId,
  });

/**
 * プロフィール画面用：いいねした投稿一覧
 *
 * いいね欄でも、いいねした投稿そのものの閲覧権限を必ず見る。
 * 投稿者が閲覧者をフォローしていない following 投稿は表示しない。
 */
export const useUserLikesInfinite = (userId: string | undefined) =>
  useInfiniteQuery({
    queryKey: userLikesKey(userId ?? ''),
    queryFn: async ({ pageParam = 0 }) => {
      if (!userId) return [];

      const from = (pageParam as number) * LIKES_FETCH_LIMIT;
      const to = from + LIKES_FETCH_LIMIT - 1;

      const { currentUserId, authorIdsFollowingViewer } = await getViewerPostAccess();

      const { data, error } = await supabase
        .from('likes')
        .select(`
          *,
          posts!inner (
            *,
            author:user_id (
              id,
              username,
              display_name,
              bio,
              avatar_url,
              cover_url,
              created_at,
              is_official,
              emoji_effect,
              bot_enabled,
              bot_prompt,
              bot_interval_hours,
              prefecture,
              city
            )
          )
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;

      const visibleLikes = (data || [])
        .map((like: any) => {
          const post = toSafePost(like.posts);

          if (!post) return null;

          if (!canViewPost(post, currentUserId, authorIdsFollowingViewer)) {
            return null;
          }

          return {
            ...like,
            posts: post,
          };
        })
        .filter(Boolean);

      (visibleLikes as any).__hasMore = (data?.length ?? 0) === LIKES_FETCH_LIMIT;

      return visibleLikes;
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      return (lastPage as any)?.__hasMore ? allPages.length : undefined;
    },
    enabled: !!userId,
  });

/**
 * プロフィール画面用：メディア投稿一覧
 *
 * 限定公開 following の正しい条件:
 * 投稿者が閲覧者をフォローしている場合のみ表示する。
 */
export const useUserMediaInfinite = (userId: string | undefined) =>
  useInfiniteQuery({
    queryKey: userMediaKey(userId ?? ''),
    queryFn: async ({ pageParam = 0 }) => {
      if (!userId) return [];

      const from = (pageParam as number) * LIMIT;
      const to = from + LIMIT - 1;

      const { currentUserId, authorIdsFollowingViewer } = await getViewerPostAccess();

      const canSeeFollowingPosts = canViewProfileOwnerFollowingPosts(
        userId,
        currentUserId,
        authorIdsFollowingViewer,
      );

      let query = supabase
        .from('posts')
        .select(`
          *,
          author:user_id(*)
        `)
        .eq('user_id', userId);

      const imagePatterns = [
        '%.jpg%',
        '%.jpeg%',
        '%.png%',
        '%.webp%',
        '%.gif%',
        '%.svg%',
        '%pbs.twimg.com/media%',
        '%res.cloudinary.com%',
      ];

      const contentFilter = imagePatterns.map((pattern) => `content.ilike.${pattern}`).join(',');
      const orFilter = `image_urls.not.is.null,image_urls.neq.{},${contentFilter}`;

      query = query.or(orFilter);

      if (currentUserId === userId) {
        // 自分のプロフィールでは全て表示
      } else if (canSeeFollowingPosts) {
        query = query.in('visibility', ['public', 'following']);
      } else {
        query = query.eq('visibility', 'public');
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;

      return (data || [])
        .map((post: any) => toSafePost(post))
        .filter(Boolean);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      return (lastPage?.length ?? 0) < LIMIT ? undefined : allPages.length;
    },
    enabled: !!userId,
  });

/**
 * プロフィール画面用：リアクションした投稿一覧
 *
 * リアクション欄でも、リアクション対象投稿の投稿者ごとに閲覧権限を判定する。
 * 投稿者が閲覧者をフォローしていない following 投稿は表示しない。
 */
export const useUserReactionsInfinite = (userId: string | undefined) =>
  useInfiniteQuery({
    queryKey: userReactionsKey(userId ?? ''),
    queryFn: async ({ pageParam = 0 }) => {
      if (!userId) return [];

      const from = (pageParam as number) * REACTIONS_FETCH_LIMIT;
      const to = from + REACTIONS_FETCH_LIMIT - 1;

      const { currentUserId, authorIdsFollowingViewer } = await getViewerPostAccess();

      const { data, error } = await supabase
        .from('post_reactions')
        .select(`
          id,
          emoji,
          created_at,
          posts!inner (
            *,
            author:user_id (
              id,
              username,
              display_name,
              bio,
              avatar_url,
              cover_url,
              created_at,
              is_official,
              emoji_effect,
              bot_enabled,
              bot_prompt,
              bot_interval_hours,
              prefecture,
              city
            )
          )
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;

      const visibleReactions = (data || [])
        .map((reaction: any) => {
          const post = toSafePost(reaction.posts, reaction);

          if (!post) return null;

          if (!canViewPost(post, currentUserId, authorIdsFollowingViewer)) {
            return null;
          }

          return {
            ...reaction,
            posts: post,
          };
        })
        .filter(Boolean);

      (visibleReactions as any).__hasMore = (data?.length ?? 0) === REACTIONS_FETCH_LIMIT;

      return visibleReactions;
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      return (lastPage as any)?.__hasMore ? allPages.length : undefined;
    },
    enabled: !!userId,
  });

/**
 * フォロー・フォロワー統計
 */
export const useFollowStats = (userId: string | undefined) =>
  useQuery({
    queryKey: followStatsKey(userId ?? ''),
    queryFn: () => getFollowStats(userId!),
    enabled: !!userId,
  });

/**
 * フォロー・アンフォローの切り替え
 */
export const useToggleFollow = (targetUserId: string) => {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: () => toggleFollow(targetUserId),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: followStatsKey(targetUserId) });

      const prev = qc.getQueryData<{ followers: number; following: number; followedByMe: boolean }>(
        followStatsKey(targetUserId),
      );

      if (prev) {
        qc.setQueryData(followStatsKey(targetUserId), {
          ...prev,
          followedByMe: !prev.followedByMe,
          followers: prev.followers + (prev.followedByMe ? -1 : 1),
        });
      }

      return { prev };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['posts'] });
      qc.invalidateQueries({ queryKey: followStatsKey(targetUserId) });
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(followStatsKey(targetUserId), ctx.prev);
      toast.error('フォロー操作に失敗しました');
    },
  });
};

/**
 * プロフィール更新
 * bot_enabled, bot_prompt 等の新規プロパティを省略せずに受け入れ、
 * booleanのfalse値も確実に updateProfile へ渡します。
 */
export const useUpdateProfile = (userId: string) => {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (patch: Partial<User>) => updateProfile(userId, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile'] });
      qc.invalidateQueries({ queryKey: ['posts', 'user', userId] });
      qc.invalidateQueries({ queryKey: ['posts', 'likes', userId] });
      qc.invalidateQueries({ queryKey: ['posts', 'media', userId] });
      qc.invalidateQueries({ queryKey: ['posts', 'reactions', userId] });
      qc.invalidateQueries({ queryKey: ['auth-user'] });
      toast.success('プロフィールを更新しました');
    },
    onError: () => toast.error('プロフィールの更新に失敗しました'),
  });
};