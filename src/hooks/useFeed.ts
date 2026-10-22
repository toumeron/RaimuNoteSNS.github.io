import { completeSavedPosts } from "@/api/external-posts";
import { useMutation, useQuery, useInfiniteQuery, useQueryClient, type InfiniteData, type QueryKey } from "@tanstack/react-query";
import { createPost, getFeed, getFollowingFeed, getPostById, getPostsByUser, toggleLike, toggleRepost, getProfilePosts } from "@/api/posts";
import { supabase } from "@/lib/supabase";
import { getCurrentUserId } from "@/lib/currentUser";
import { type PostWithAuthor, type CommentWithAuthor, User } from "@/types/index";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { initialiseExternalAccounts, setExternalAccountOwner, completeExternalPostAuthors } from "@/lib/externalAccounts";
import { useAuth } from "@/hooks/useAuth";
import { fetchBlueskyAuthorFeed, getConfiguredExternalHandles } from "@/lib/bluesky";
import { createTimelineCursor, loadTimelinePage, searchTermSuggestions, watchTimelineSources, collectReadyTimelineSources, type TimelinePage } from "@/lib/utils";
import { createComment, getCommentsByPost, type CommentInput } from "@/api/external-posts";
import { getUserByUsername, updateProfile, getFollowStats, toggleFollow, getSearchFollowingUsers } from "@/api/users";

// useFeed
/**
 * クエリキー定義
 * 'feed' を親キーに持つことで、一括無効化を容易にします
 */
const feedKey = ['feed'] as const;

const feedKeys = {
  all: ['feed', 'all'] as const,
  following: ['feed', 'following'] as const,
};

const postKey = (id: string) => ['post', id] as const;
const userPostsKey = (userId: string) => ['posts', 'user', userId] as const;

const LIMIT = 10;

type ViewerPostAccess = {
  currentUserId: string | null;
  authorIdsFollowingViewer: Set<string>;
  creatorIdsViewerIsMemberOf: Set<string>;
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
      creatorIdsViewerIsMemberOf: new Set<string>(),
    };
  }

  const [followsRes, membershipsRes] = await Promise.all([
    supabase
      .from('follows')
      .select('follower_id')
      .eq('followee_id', currentUserId),
    supabase
      .from('memberships')
      .select('creator_id')
      .eq('member_id', currentUserId),
  ]);

  if (followsRes.error) throw followsRes.error;
  if (membershipsRes.error) throw membershipsRes.error;

  return {
    currentUserId,
    authorIdsFollowingViewer: new Set(
      (followsRes.data || [])
        .map((follow: any) => follow.follower_id)
        .filter(Boolean),
    ),
    creatorIdsViewerIsMemberOf: new Set(
      (membershipsRes.data || [])
        .map((membership: any) => membership.creator_id)
        .filter(Boolean),
    ),
  };
};

const canViewPost = (
  post: any,
  currentUserId: string | null,
  authorIdsFollowingViewer: Set<string>,
  creatorIdsViewerIsMemberOf: Set<string>,
) => {
  const visibility = post?.visibility ?? 'public';
  const postAuthorId = getPostAuthorId(post);

  if (visibility === 'public') return true;

  if (!currentUserId) return false;

  if (currentUserId === postAuthorId) return true;

  if (visibility === 'following') {
    return authorIdsFollowingViewer.has(postAuthorId);
  }

  if (visibility === 'members') {
    return creatorIdsViewerIsMemberOf.has(postAuthorId);
  }

  return false;
};

/**
 * タイムライン用フック
 * tabの状態に応じてフェッチ先とキャッシュキーを動的に切り替えます
 */
const useFeed = (tab: 'all' | 'following' = 'all') =>
  useInfiniteQuery({
    queryKey: tab === 'all' ? feedKeys.all : feedKeys.following,
    queryFn: ({ pageParam = 0,signal }) => {
      return tab === 'all'
        ? getFeed(pageParam as number, LIMIT,undefined,signal)
        : getFollowingFeed(pageParam as number, LIMIT,undefined,signal);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      // 取得したデータがLIMIT未満なら次ページなし
      return lastPage.length < LIMIT ? undefined : allPages.length;
    },
    // タブ切り替え時に以前のデータを保持することで、
    // ローディング中の「ガタつき」や「表示消失」を防ぎます
    placeholderData: (previousData) => previousData,
    // キャッシュ保持時間の設定（必要に応じて）
    staleTime: 1000 * 60,
    retry:false,
  });

/**
 * 個別投稿取得
 */
const usePost = (id: string) =>
  useQuery({
    queryKey: postKey(id),
    queryFn: () => getPostById(id),
    enabled: !!id,
    retry:false,
  });

/**
 * 特定ユーザーの投稿一覧
 *
 * 限定公開 following の表示条件:
 * 閲覧者が投稿者をフォローしているかではなく、
 * 投稿者が閲覧者をフォローしている場合のみ表示します。
 *
 * メンバー限定 members の表示条件:
 * 閲覧者が投稿者(creator)のメンバーになっている場合のみ表示します。
 */
const useUserPosts = (userId: string | undefined) =>
  useQuery({
    queryKey: userPostsKey(userId ?? ''),
    queryFn: async () => {
      const [posts, { currentUserId, authorIdsFollowingViewer, creatorIdsViewerIsMemberOf }] =
        await Promise.all([getPostsByUser(userId!), getViewerPostAccess()]);

      return posts.filter((post: any) => {
        return canViewPost(
          post,
          currentUserId,
          authorIdsFollowingViewer,
          creatorIdsViewerIsMemberOf,
        );
      });
    },
    enabled: !!userId,
    retry:false,
  });

/**
 * 投稿作成
 */
const useCreatePost = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createPost,
    onSuccess: (post) => {
      if(post.scheduledAt){void qc.invalidateQueries({queryKey:['scheduled-posts']});toast.success('予約投稿を保存しました');return;}
      if (post.parentId) qc.invalidateQueries({ queryKey: postKey(post.parentId) });
      if (post.parentPost?.id) qc.invalidateQueries({ queryKey: ['repost-state', post.parentPost.id] });
      // 'feed' から始まる全てのキャッシュ（最新・フォロー中両方）を無効化
      qc.invalidateQueries({ queryKey: feedKey });
      qc.invalidateQueries({ queryKey: ['map-posts'] });
      qc.invalidateQueries({ queryKey: ['posts', 'user'] });
      toast.success('投稿しました');
    },
    onError: (error, input) => toast.error(input.mapLocation && ['42703', 'PGRST204'].includes(String((error as {code?:string}).code))
      ? '位置付きポストの保存設定が未適用です。' : input.video ? (['42703','PGRST204'].includes(String((error as {code?:string}).code)) ? '動画投稿の保存設定が未適用です。' : (error as Error).message || '動画を投稿できませんでした') : '投稿に失敗しました。もう一度お試しください。'),
  });
};

/**
 * キャッシュ内の投稿データを一括更新するためのヘルパー関数
 * いいねやリポストの状態を即座にUIへ反映（Optimistic Update）させるために使用します
 */
const updatePostInCache = (
  qc: ReturnType<typeof useQueryClient>,
  postId: string,
  flip: (p: PostWithAuthor) => PostWithAuthor,
) => {
  // Feeds can contain arrays, paged timelines, or query metadata. Walk only
  // actual post containers; never assume every cached page has a posts array.
  const update = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      const next = value.map(update);
      return next.some((item, index) => item !== value[index]) ? next : value;
    }
    if (!value || typeof value !== 'object') return value;
    const row = value as Record<string, unknown>;
    let next = row.id === postId ? flip(value as PostWithAuthor) as unknown as Record<string, unknown> : row;
    for (const key of ['pages', 'posts', 'parentPost'] as const) {
      if (!(key in row)) continue;
      const child = update(row[key]);
      if (child !== row[key]) {
        if (next === row) next = { ...row };
        next[key] = child;
      }
    }
    return next;
  };
  qc.setQueriesData({ queryKey: feedKey }, update);
  qc.setQueriesData({ queryKey: ['post'] }, update);
  qc.setQueriesData({ queryKey: ['posts', 'user'] }, update);
};

/**
 * いいねトグル
 */
const useToggleLike = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) => toggleLike(postId),
    onMutate: async (postId) => {
      // 進行中のリフェッチをキャンセルして、楽観的更新と衝突しないようにする
      await qc.cancelQueries({ queryKey: feedKey });
      await qc.cancelQueries({ queryKey: postKey(postId) });

      const flip = (p: PostWithAuthor): PostWithAuthor => ({
        ...p,
        likedByMe: !p.likedByMe,
        likesCount: p.likesCount + (p.likedByMe ? -1 : 1),
      });

      updatePostInCache(qc, postId, flip);
    },
    onError: (err, postId) => {
      // 失敗時は整合性を保つためリフェッチを実行
      qc.invalidateQueries({ queryKey: feedKey });
      qc.invalidateQueries({ queryKey: postKey(postId) });
      toast.error('いいねの更新に失敗しました');
    },
  });
};

/**
 * リポストトグル
 */
const useToggleRepost = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) => toggleRepost(postId),
    onMutate: async (postId) => {
      await qc.cancelQueries({ queryKey: feedKey });
      await qc.cancelQueries({ queryKey: postKey(postId) });

      await qc.cancelQueries({ queryKey: ['posts', 'user'] });

      const flip = (p: PostWithAuthor): PostWithAuthor => ({
        ...p,
        repostedByMe: !p.repostedByMe,
        repostsCount: Math.max(0, (p.repostsCount ?? 0) + (p.repostedByMe ? -1 : 1)),
      });

      updatePostInCache(qc, postId, flip);
    },
    onSuccess: (result, postId) => {
      qc.invalidateQueries({ queryKey: ['repost-state', postId] });
      updatePostInCache(qc, postId, post => ({ ...post, repostedByMe: result.reposted, repostsCount: result.repostsCount ?? post.repostsCount }));
      qc.invalidateQueries({ queryKey: ['posts', 'user'] });
      qc.invalidateQueries({ queryKey: feedKey });
      qc.invalidateQueries({ queryKey: postKey(postId) });
    },
    onError: (_err, postId) => {
      updatePostInCache(qc, postId, post => ({ ...post, repostedByMe: !post.repostedByMe,
        repostsCount: Math.max(0, (post.repostsCount ?? 0) + (post.repostedByMe ? -1 : 1)) }));
      qc.invalidateQueries({ queryKey: ['posts', 'user'] });
      qc.invalidateQueries({ queryKey: feedKey });
      qc.invalidateQueries({ queryKey: postKey(postId) });
      toast.error('リポストの更新に失敗しました');
    },
  });
};

// useTimelineFeed
function useTimelineFeed(tab: 'all' | 'following', enabled = true) {
  const {user,loading}=useAuth();
  const client=useQueryClient();
  const [handles, setHandles] = useState(getConfiguredExternalHandles);
  useEffect(() => {
    if(tab!=='following')return;
    const update = () => setHandles(getConfiguredExternalHandles());
    setExternalAccountOwner(user?.id??null);
    update();
    if(user)void initialiseExternalAccounts().then(update).catch(()=>{});
    const storage = (event: StorageEvent) => {
      if (event.key?.startsWith('lime_misskey_') || event.key === 'lime_bluesky_author_handles' || event.key === null) update();
    };
    window.addEventListener('lime-bluesky-handles-changed', update);
    window.addEventListener('lime-misskey-changed', update);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener('lime-bluesky-handles-changed', update);
      window.removeEventListener('lime-misskey-changed', update);
      window.removeEventListener('storage', storage);
    };
  }, [user?.id,tab]);

  const sourceHandles=tab==='following'?handles:[];
  const queryKey=['feed',tab,tab==='all'?'timeline-native-v3':'timeline-v2',user?.id,sourceHandles];
  const query=useInfiniteQuery({
    enabled:enabled&&!loading&&!!user,
    queryKey,
    initialPageParam: createTimelineCursor(sourceHandles),
    queryFn: ({ pageParam, signal }) => loadTimelinePage(pageParam, {
      lime: (page,limit,before)=>(tab === 'all' ? getFeed : getFollowingFeed)(page,limit,before,signal),
      bluesky: (actor,cursor,limit)=>fetchBlueskyAuthorFeed({actor,cursor,limit,signal}),
    }),
    getNextPageParam: lastPage => lastPage.next,
    staleTime: 1000 * 60,
    retry:false,
  });
  useTimelineSourceUpdates(queryKey,query.data,query.isFetching,enabled);
  return query;
}

// useComments
const commentsKey = (postId: string) => ['comments', postId] as const;

const normalizeCommentAuthor = (comment: any, profileMap: Record<string, any>) => {
  const author = comment.author ?? {};
  const authorId =
    author.id ??
    comment.userId ??
    comment.user_id ??
    comment.userId ??
    '';

  const profile = profileMap[authorId] ?? null;

  return {
    ...comment,
    userId: comment.userId ?? comment.user_id ?? authorId,
    user_id: comment.user_id ?? comment.userId ?? authorId,
    postId: comment.postId ?? comment.post_id ?? '',
    post_id: comment.post_id ?? comment.postId ?? '',
    createdAt: comment.createdAt ?? comment.created_at ?? '',
    created_at: comment.created_at ?? comment.createdAt ?? '',
    likesCount: Number(comment.likesCount ?? comment.likes_count ?? 0),
    likes_count: Number(comment.likes_count ?? comment.likesCount ?? 0),
    likedByMe: !!(comment.likedByMe ?? comment.liked_by_me),
    liked_by_me: !!(comment.liked_by_me ?? comment.likedByMe),
    author: {
      ...author,
      id: authorId,
      username:
        author.username ??
        profile?.username ??
        '',
      displayName:
        author.displayName ??
        author.display_name ??
        profile?.display_name ??
        profile?.username ??
        'ユーザー',
      display_name:
        author.display_name ??
        author.displayName ??
        profile?.display_name ??
        profile?.username ??
        'ユーザー',
      avatarUrl:
        author.avatarUrl ??
        author.avatar_url ??
        profile?.avatar_url ??
        '',
      avatar_url:
        author.avatar_url ??
        author.avatarUrl ??
        profile?.avatar_url ??
        '',
      isOfficial: !!(
        author.isOfficial ??
        author.is_official ??
        profile?.is_official ??
        false
      ),
      is_official: !!(
        author.is_official ??
        author.isOfficial ??
        profile?.is_official ??
        false
      ),
      bio:
        author.bio ??
        profile?.bio ??
        '',
      createdAt:
        author.createdAt ??
        author.created_at ??
        profile?.created_at ??
        '',
      created_at:
        author.created_at ??
        author.createdAt ??
        profile?.created_at ??
        ''
    }
  };
};

const useComments = (postId: string) => {
  const qc = useQueryClient();

  useEffect(() => {
    if (!postId) return;

    const channel = supabase
      .channel(`comments-profiles-${postId}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'comments', filter: `post_id=eq.${postId}`,
      }, () => {
        qc.invalidateQueries({ queryKey: commentsKey(postId) });
        qc.invalidateQueries({ queryKey: postKey(postId) });
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'comments', filter: `post_id=eq.${postId}`,
      }, () => {
        qc.invalidateQueries({ queryKey: commentsKey(postId) });
      })
      // DELETE payloads only carry the primary key and cannot be filtered by
      // post_id. Refresh the open thread so removed replies/counts stay live.
      .on('postgres_changes', {
        event: 'DELETE', schema: 'public', table: 'comments',
      }, () => {
        qc.invalidateQueries({ queryKey: commentsKey(postId) });
        qc.invalidateQueries({ queryKey: postKey(postId) });
      })
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles'
        },
        () => {
          qc.invalidateQueries({ queryKey: commentsKey(postId) });
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          qc.invalidateQueries({ queryKey: commentsKey(postId) });
          qc.invalidateQueries({ queryKey: postKey(postId) });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [postId, qc]);

  return useQuery({
    queryKey: commentsKey(postId),
    queryFn: async () => {
      const [comments, currentUserId] = await Promise.all([
        getCommentsByPost(postId),
        getCurrentUserId()
      ]);

      if (!comments || comments.length === 0) return [];
      const replyCounts = new Map<string, number>();
      comments.forEach(comment => {
        if (comment.parentCommentId) replyCounts.set(comment.parentCommentId, (replyCounts.get(comment.parentCommentId) ?? 0) + 1);
      });
      comments.forEach(comment => { comment.commentsCount = replyCounts.get(comment.id) ?? 0; });

      const authorIds = Array.from(
        new Set(
          comments
            .map((comment: any) => {
              return (
                comment.author?.id ??
                comment.userId ??
                comment.user_id ??
                ''
              );
            })
            .filter(Boolean)
        )
      );

      let profileMap: Record<string, any> = {};

      if (authorIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles')
          .select(`
            id,
            username,
            display_name,
            bio,
            avatar_url,
            created_at,
            is_official
          `)
          .in('id', authorIds);

        if (profilesError) throw profilesError;

        profileMap = (profiles ?? []).reduce((acc: Record<string, any>, profile: any) => {
          acc[profile.id] = profile;
          return acc;
        }, {});
      }

      try {
        const { data: allLikes, error: likeError } = await supabase
          .from('comment_likes')
          .select('comment_id, user_id')
          .in('comment_id', comments.map((c: any) => c.id));

        if (likeError) throw likeError;

        const likeCountsMap: Record<string, number> = {};
        const likedByMeSet = new Set<string>();

        allLikes?.forEach((like: any) => {
          likeCountsMap[like.comment_id] = (likeCountsMap[like.comment_id] || 0) + 1;

          if (currentUserId && like.user_id === currentUserId) {
            likedByMeSet.add(like.comment_id);
          }
        });

        return comments.map((comment: any) => {
          const normalized = normalizeCommentAuthor(comment, profileMap);

          return {
            ...normalized,
            likesCount: likeCountsMap[comment.id] || 0,
            likes_count: likeCountsMap[comment.id] || 0,
            likedByMe: likedByMeSet.has(comment.id),
            liked_by_me: likedByMeSet.has(comment.id)
          };
        });
      } catch (err) {
        console.error('Data sync failed, falling back to API data:', err);

        return comments.map((comment: any) => {
          return normalizeCommentAuthor(comment, profileMap);
        });
      }
    },
    enabled: !!postId,
    staleTime: 0,
  });
};

const useCreateComment = (postId: string) => {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: string | CommentInput) => createComment(postId, input),
    onMutate: async (content) => {
      await qc.cancelQueries({ queryKey: commentsKey(postId) });

      const prev = qc.getQueryData<CommentWithAuthor[]>(commentsKey(postId));

      const prevPost = qc.getQueryData<PostWithAuthor>(postKey(postId));

      if (prevPost) {
        qc.setQueryData(postKey(postId), {
          ...prevPost,
          commentsCount: (prevPost.commentsCount || 0) + 1
        });
      }

      return { prev, prevPost };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['posts', 'user'] });
      qc.invalidateQueries({ queryKey: commentsKey(postId) });
      qc.invalidateQueries({ queryKey: feedKey });
      qc.invalidateQueries({ queryKey: postKey(postId) });
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(commentsKey(postId), ctx.prev);
      if (ctx?.prevPost) qc.setQueryData(postKey(postId), ctx.prevPost);
      toast.error('コメントの送信に失敗しました');
    },
  });
};

// useProfile
const profileKey = (username: string) => ['profile', username] as const;
const followStatsKey = (userId: string) => ['follow-stats', userId] as const;
const useProfileUserPostsKey = (userId: string) => ['posts', 'user', userId] as const;
const userLikesKey = (userId: string) => ['posts', 'likes', userId] as const;
const userMediaKey = (userId: string) => ['posts', 'media', userId] as const;
const userReactionsKey = (userId: string) => ['posts', 'reactions', userId] as const;

const UseProfileLIMIT = 10;
const LIKES_FETCH_LIMIT = 30;
const REACTIONS_FETCH_LIMIT = 30;
// All author fields consumed by toSafeAuthor; omit unrelated profile settings.
const POST_AUTHOR_COLUMNS = 'id, username, display_name, bio, avatar_url, cover_url, created_at, is_official, is_private, emoji_effect, bot_enabled, bot_prompt, bot_interval_hours, prefecture, city';

type UseProfileViewerPostAccess = {
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
    isPrivate: !!(author?.isPrivate ?? author?.is_private),
    providerVerification: author?.providerVerification,
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

const useProfileGetPostAuthorId = (post: any) => {
  return post?.user_id ?? post?.userId ?? post?.author?.id ?? post?.profiles?.id ?? '';
};

const useProfileGetViewerPostAccess = async (profileOwnerId?: string): Promise<UseProfileViewerPostAccess> => {
  const currentUserId = await getCurrentUserId();

  if (!currentUserId) {
    return {
      currentUserId: null,
      authorIdsFollowingViewer: new Set<string>(),
    };
  }

  if (profileOwnerId === currentUserId) {
    return { currentUserId, authorIdsFollowingViewer: new Set<string>() };
  }
  let query = supabase.from('follows').select('follower_id').eq('followee_id', currentUserId);
  if (profileOwnerId) query = query.eq('follower_id', profileOwnerId);
  const { data, error } = await query;

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

const useProfileCanViewPost = (
  post: any,
  currentUserId: string | null,
  authorIdsFollowingViewer: Set<string>,
) => {
  const visibility = post?.visibility ?? 'public';
  const postAuthorId = useProfileGetPostAuthorId(post);

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
const useProfile = (username: string | undefined) =>
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
const useUserPostsInfinite = (userId: string | undefined) =>
  useInfiniteQuery({
    queryKey: useProfileUserPostsKey(userId ?? ''),
    queryFn: async ({ pageParam = 0 }) => {
      if (!userId) return [];

      return getProfilePosts(userId, pageParam as number, UseProfileLIMIT);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      return (lastPage?.length ?? 0) < UseProfileLIMIT ? undefined : allPages.length;
    },
    enabled: !!userId,
  });

/**
 * プロフィール画面用：いいねした投稿一覧
 *
 * いいね欄でも、いいねした投稿そのものの閲覧権限を必ず見る。
 * 投稿者が閲覧者をフォローしていない following 投稿は表示しない。
 */
const useUserLikesInfinite = (userId: string | undefined) => {
  const qc=useQueryClient();
  const query=useInfiniteQuery({
    queryKey: userLikesKey(userId ?? ''),
    queryFn: async ({ pageParam = 0 }) => {
      if (!userId) return [];

      const from = (pageParam as number) * LIKES_FETCH_LIMIT;
      const to = from + LIKES_FETCH_LIMIT - 1;

      const { currentUserId, authorIdsFollowingViewer } = await useProfileGetViewerPostAccess();

      const { data, error } = await supabase
        .from('likes')
        .select(`
          *,
          posts (
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
              is_private,
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
          const post = toSafePost(like.post_snapshot??like.posts);

          if (!post) return null;

          if (!useProfileCanViewPost(post, currentUserId, authorIdsFollowingViewer)) {
            return null;
          }

          return {
            ...like,
            posts: post,
          };
        })
        .filter(Boolean);

      const completed=await completeSavedPosts(visibleLikes.map((like:any)=>like.posts));
      completed.forEach((post,index)=>{(visibleLikes[index] as any).posts=post;});

      (visibleLikes as any).__hasMore = (data?.length ?? 0) === LIKES_FETCH_LIMIT;

      return visibleLikes;
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      return (lastPage as any)?.__hasMore ? allPages.length : undefined;
    },
    enabled: !!userId,
  });
  useEffect(()=>{
    if(!query.data||!userId)return;
    const missing=query.data.pages.flat().filter((like:any)=>/^(bsky:|misskey:)/.test(like.posts?.id??'')&&(!like.posts.author?.avatarUrl||!like.posts.author?.displayName));
    if(!missing.length)return;
    let cancelled=false;const controller=new AbortController();
    void completeExternalPostAuthors(missing.map((like:any)=>like.posts),controller.signal).then(posts=>{
      if(cancelled)return;
      const changed=new Map(posts.filter((post,index)=>post!==missing[index].posts).map(post=>[post.id,post]));
      if(!changed.size)return;
      qc.setQueryData(userLikesKey(userId),(previous:any)=>previous?{...previous,pages:previous.pages.map((page:any)=>{
        const next=page.map((like:any)=>changed.has(like.posts?.id)?{...like,posts:changed.get(like.posts.id)}:like);
        next.__hasMore=page.__hasMore;return next;
      })}:previous);
    });
    return()=>{cancelled=true;controller.abort();};
  },[query.data,userId,qc]);
  return query;
};

/**
 * プロフィール画面用：メディア投稿一覧
 *
 * 限定公開 following の正しい条件:
 * 投稿者が閲覧者をフォローしている場合のみ表示する。
 */
const useUserMediaInfinite = (userId: string | undefined) =>
  useInfiniteQuery({
    queryKey: userMediaKey(userId ?? ''),
    queryFn: async ({ pageParam = 0 }) => {
      if (!userId) return [];

      const from = (pageParam as number) * UseProfileLIMIT;
      const to = from + UseProfileLIMIT - 1;

      const { currentUserId, authorIdsFollowingViewer } = await useProfileGetViewerPostAccess(userId);

      const canSeeFollowingPosts = canViewProfileOwnerFollowingPosts(
        userId,
        currentUserId,
        authorIdsFollowingViewer,
      );

      let query = supabase
        .from('posts')
        .select(`
          *,
          author:user_id(${POST_AUTHOR_COLUMNS})
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
      const orFilter = `video.not.is.null,image_urls.neq.{},${contentFilter}`;

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
      return (lastPage?.length ?? 0) < UseProfileLIMIT ? undefined : allPages.length;
    },
    enabled: !!userId,
  });

/**
 * プロフィール画面用：リアクションした投稿一覧
 *
 * リアクション欄でも、リアクション対象投稿の投稿者ごとに閲覧権限を判定する。
 * 投稿者が閲覧者をフォローしていない following 投稿は表示しない。
 */
const useUserReactionsInfinite = (userId: string | undefined) =>
  useInfiniteQuery({
    queryKey: userReactionsKey(userId ?? ''),
    queryFn: async ({ pageParam = 0 }) => {
      if (!userId) return [];

      const from = (pageParam as number) * REACTIONS_FETCH_LIMIT;
      const to = from + REACTIONS_FETCH_LIMIT - 1;

      const { currentUserId, authorIdsFollowingViewer } = await useProfileGetViewerPostAccess();

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
              is_private,
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

          if (!useProfileCanViewPost(post, currentUserId, authorIdsFollowingViewer)) {
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
const useFollowStats = (userId: string | undefined) =>
  useQuery({
    queryKey: followStatsKey(userId ?? ''),
    queryFn: () => getFollowStats(userId!),
    enabled: !!userId,
  });

/**
 * フォロー・アンフォローの切り替え
 */
const useToggleFollow = (targetUserId: string) => {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: () => toggleFollow(targetUserId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['posts'] });
      qc.invalidateQueries({ queryKey: ['profile'] });
      qc.invalidateQueries({ queryKey: followStatsKey(targetUserId) });
      qc.invalidateQueries({ queryKey: ['follow-stats', 'known-followers'] });
      qc.invalidateQueries({ queryKey: ['follow-list'] });
    },
    onError: () => {
      toast.error('フォロー操作に失敗しました');
    },
  });
};

/**
 * プロフィール更新
 * bot_enabled, bot_prompt 等の新規プロパティを省略せずに受け入れ、
 * booleanのfalse値も確実に updateProfile へ渡します。
 */
const useUpdateProfile = (userId: string) => {
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
    onError: (error) => toast.error(error instanceof Error ? error.message : 'プロフィールの更新に失敗しました'),
  });
};

export { feedKey };
export { feedKeys };
export { postKey };
export { userPostsKey };
export { useFeed };
export { usePost };
export { useUserPosts };
export { useCreatePost };
export { useToggleLike };
export { useToggleRepost };
export { useTimelineFeed };
export { commentsKey };
export { useComments };
export { useCreateComment };
export { profileKey };
export { followStatsKey };
export { useProfileUserPostsKey };
export { userLikesKey };
export { userMediaKey };
export { userReactionsKey };
export { useProfile };
export { useUserPostsInfinite };
export { useUserLikesInfinite };
export { useUserMediaInfinite };
export { useUserReactionsInfinite };
export { useFollowStats };
export { useToggleFollow };
export { useUpdateProfile };


// useSearchFollowing
export function useSearchFollowing(enabled=true){
 const {user}=useAuth();
 return useQuery({queryKey:['follow-list','search-priority',user?.id],queryFn:({signal})=>getSearchFollowingUsers(user!.id,signal),enabled:enabled&&!!user?.id,staleTime:60_000,refetchOnWindowFocus:false});
}


// useSearchTermSuggestions
export function useSearchTermSuggestions(query:string,enabled=true){
 const [terms,setTerms]=useState<string[]>([]);
 useEffect(()=>{
  setTerms([]);if(!enabled||!query.trim())return;
  const controller=new AbortController();
  const timer=setTimeout(()=>{void searchTermSuggestions(query,controller.signal).then(values=>{if(!controller.signal.aborted)setTerms(values);}).catch(()=>{});},250);
  return()=>{controller.abort();clearTimeout(timer);};
 },[query,enabled]);
 return terms;
}


// useTimelineSourceUpdates
/** Publish every delayed account as it finishes, even if the user has not scrolled again. */
export function useTimelineSourceUpdates(queryKey:QueryKey,data:InfiniteData<TimelinePage>|undefined,fetching:boolean,enabled=true){
 const client=useQueryClient(),key=JSON.stringify(queryKey);
 useEffect(()=>{
  const cursor=data?.pages.at(-1)?.next;if(!enabled||fetching||!cursor)return;
  return watchTimelineSources(cursor,()=>{
   if(client.getQueryState(queryKey)?.fetchStatus==='fetching')return;
   client.setQueryData<InfiniteData<TimelinePage>>(queryKey,current=>{
    const last=current?.pages.at(-1);if(!current||last?.next!==cursor)return current;
    const ready=collectReadyTimelineSources(cursor);if(!ready)return current;
    const seen=new Set(current.pages.flatMap(page=>page.posts.map(post=>post.id)));
    const posts=ready.posts.filter(post=>{if(seen.has(post.id))return false;seen.add(post.id);return true;});
    return {...current,pages:[...current.pages.slice(0,-1),{posts:[...last.posts,...posts],next:ready.next}]};
   });
  });
 },[client,key,data,fetching,enabled]);
}
