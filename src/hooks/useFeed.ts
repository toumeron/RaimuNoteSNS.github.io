import {
  useMutation,
  useQuery,
  useInfiniteQuery,
  useQueryClient,
  InfiniteData,
} from '@tanstack/react-query';
import {
  createPost,
  getFeed,
  getFollowingFeed,
  getPostById,
  getPostsByUser,
  toggleLike,
  toggleRepost,
} from '@/api/posts';
import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/currentUser';
import type { PostWithAuthor } from '@/types';
import { toast } from 'sonner';

/**
 * クエリキー定義
 * 'feed' を親キーに持つことで、一括無効化を容易にします
 */
export const feedKey = ['feed'] as const;

export const feedKeys = {
  all: ['feed', 'all'] as const,
  following: ['feed', 'following'] as const,
};

export const postKey = (id: string) => ['post', id] as const;
export const userPostsKey = (userId: string) => ['posts', 'user', userId] as const;

const LIMIT = 10;

type ViewerPostAccess = {
  currentUserId: string | null;
  authorIdsFollowingViewer: Set<string>;
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

/**
 * タイムライン用フック
 * tabの状態に応じてフェッチ先とキャッシュキーを動的に切り替えます
 */
export const useFeed = (tab: 'all' | 'following' = 'all') =>
  useInfiniteQuery({
    queryKey: tab === 'all' ? feedKeys.all : feedKeys.following,
    queryFn: ({ pageParam = 0 }) => {
      return tab === 'all'
        ? getFeed(pageParam as number, LIMIT)
        : getFollowingFeed(pageParam as number, LIMIT);
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
  });

/**
 * 個別投稿取得
 */
export const usePost = (id: string) =>
  useQuery({
    queryKey: postKey(id),
    queryFn: () => getPostById(id),
    enabled: !!id,
  });

/**
 * 特定ユーザーの投稿一覧
 *
 * 限定公開 following の表示条件:
 * 閲覧者が投稿者をフォローしているかではなく、
 * 投稿者が閲覧者をフォローしている場合のみ表示します。
 */
export const useUserPosts = (userId: string | undefined) =>
  useQuery({
    queryKey: userPostsKey(userId ?? ''),
    queryFn: async () => {
      const posts = await getPostsByUser(userId!);
      const { currentUserId, authorIdsFollowingViewer } = await getViewerPostAccess();

      return posts.filter((post: any) => {
        return canViewPost(post, currentUserId, authorIdsFollowingViewer);
      });
    },
    enabled: !!userId,
  });

/**
 * 投稿作成
 */
export const useCreatePost = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createPost,
    onSuccess: () => {
      // 'feed' から始まる全てのキャッシュ（最新・フォロー中両方）を無効化
      qc.invalidateQueries({ queryKey: feedKey });
      qc.invalidateQueries({ queryKey: ['posts', 'user'] });
      toast.success('投稿しました');
    },
    onError: () => toast.error('投稿に失敗しました。もう一度お試しください。'),
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
  // 1. 全てのタイムライン（最新、フォロー中など 'feed' を含むもの全て）を更新
  qc.setQueriesData<InfiniteData<PostWithAuthor[]>>({ queryKey: feedKey }, (old) => {
    if (!old) return old;
    return {
      ...old,
      pages: old.pages.map((page) =>
        page.map((p) => (p.id === postId ? flip(p) : p)),
      ),
    };
  });

  // 2. 個別投稿詳細のキャッシュを更新
  qc.setQueryData<PostWithAuthor>(postKey(postId), (old) => (old ? flip(old) : old));

  // 3. 各ユーザーの投稿一覧キャッシュをスキャンして更新
  qc.getQueriesData<PostWithAuthor[]>({ queryKey: ['posts', 'user'] }).forEach(([key]) => {
    qc.setQueryData<PostWithAuthor[]>(key, (old) =>
      old ? old.map((p) => (p.id === postId ? flip(p) : p)) : old,
    );
  });
};

/**
 * いいねトグル
 */
export const useToggleLike = () => {
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
export const useToggleRepost = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) => toggleRepost(postId),
    onMutate: async (postId) => {
      await qc.cancelQueries({ queryKey: feedKey });
      await qc.cancelQueries({ queryKey: postKey(postId) });

      const flip = (p: PostWithAuthor): PostWithAuthor => ({
        ...p,
        repostedByMe: !p.repostedByMe,
        repostsCount: p.repostsCount + (p.repostedByMe ? -1 : 1),
      });

      updatePostInCache(qc, postId, flip);
    },
    onSuccess: (_, postId) => {
      // リポストは自身のフォロワーのタイムラインに影響するため、
      // 成功後にバックグラウンドで最新状態を取得し直すのが安全
      qc.invalidateQueries({ queryKey: feedKey });
    },
    onError: (err, postId) => {
      qc.invalidateQueries({ queryKey: feedKey });
      qc.invalidateQueries({ queryKey: postKey(postId) });
      toast.error('リポストの更新に失敗しました');
    },
  });
};