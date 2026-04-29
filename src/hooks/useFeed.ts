import { 
  useMutation, 
  useQuery, 
  useInfiniteQuery, // 追加
  useQueryClient,
  InfiniteData 
} from '@tanstack/react-query';
import { 
  createPost, 
  getFeed, 
  getPostById, 
  getPostsByUser, 
  toggleLike, 
  toggleRepost 
} from '@/api/posts';
import type { PostWithAuthor } from '@/types';
import { toast } from 'sonner';

export const feedKey = ['feed'] as const;
export const postKey = (id: string) => ['post', id] as const;
export const userPostsKey = (userId: string) => ['posts', 'user', userId] as const;

// 1ページあたりの件数
const LIMIT = 5;

/**
 * 無限スクロール対応版 useFeed
 */
export const useFeed = () =>
  useInfiniteQuery({
    queryKey: feedKey,
    queryFn: ({ pageParam = 0 }) => getFeed(pageParam as number, LIMIT),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      // 取得したデータがLIMIT未満なら次のページはない
      return lastPage.length < LIMIT ? undefined : allPages.length;
    },
  });

export const usePost = (id: string) =>
  useQuery({ queryKey: postKey(id), queryFn: () => getPostById(id), enabled: !!id });

export const useUserPosts = (userId: string | undefined) =>
  useQuery({
    queryKey: userPostsKey(userId ?? ''),
    queryFn: () => getPostsByUser(userId!),
    enabled: !!userId,
  });

export const useCreatePost = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createPost,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: feedKey });
      qc.invalidateQueries({ queryKey: ['posts', 'user'] });
      toast.success('投稿しました');
    },
    onError: () => toast.error('投稿に失敗しました。もう一度お試しください。'),
  });
};

/**
 * キャッシュ内の投稿データを一括更新するためのヘルパー関数
 * 無限スクロール(InfiniteData)と通常の配列の両方に対応
 */
const updatePostInCache = (
  qc: ReturnType<typeof useQueryClient>,
  postId: string,
  flip: (p: PostWithAuthor) => PostWithAuthor
) => {
  // 1. 無限スクロールのキャッシュ (feed) を更新
  qc.setQueriesData<InfiniteData<PostWithAuthor[]>>({ queryKey: feedKey }, (old) => {
    if (!old) return old;
    return {
      ...old,
      pages: old.pages.map((page) => page.map((p) => (p.id === postId ? flip(p) : p))),
    };
  });

  // 2. 個別投稿のキャッシュを更新
  qc.setQueryData<PostWithAuthor>(postKey(postId), (old) => (old ? flip(old) : old));

  // 3. ユーザー投稿一覧のキャッシュを更新
  qc.getQueriesData<PostWithAuthor[]>({ queryKey: ['posts', 'user'] }).forEach(([key]) => {
    qc.setQueryData<PostWithAuthor[]>(key, (old) => 
      old ? old.map((p) => (p.id === postId ? flip(p) : p)) : old
    );
  });
};

export const useToggleLike = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) => toggleLike(postId),
    onMutate: async (postId) => {
      await qc.cancelQueries({ queryKey: feedKey });
      const prevFeed = qc.getQueryData<InfiniteData<PostWithAuthor[]>>(feedKey);
      const prevPost = qc.getQueryData<PostWithAuthor>(postKey(postId));

      const flip = (p: PostWithAuthor): PostWithAuthor => ({
        ...p,
        likedByMe: !p.likedByMe,
        likesCount: p.likesCount + (p.likedByMe ? -1 : 1),
      });

      updatePostInCache(qc, postId, flip);

      return { prevFeed, prevPost };
    },
    onError: (_err, postId, ctx) => {
      if (ctx?.prevFeed) qc.setQueryData(feedKey, ctx.prevFeed);
      if (ctx?.prevPost) qc.setQueryData(postKey(postId), ctx.prevPost);
      toast.error('いいねの更新に失敗しました');
    },
  });
};

export const useToggleRepost = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) => toggleRepost(postId),
    onMutate: async (postId) => {
      await qc.cancelQueries({ queryKey: feedKey });
      const prevFeed = qc.getQueryData<InfiniteData<PostWithAuthor[]>>(feedKey);
      const prevPost = qc.getQueryData<PostWithAuthor>(postKey(postId));

      const flip = (p: PostWithAuthor): PostWithAuthor => ({
        ...p,
        repostedByMe: !p.repostedByMe,
        repostsCount: p.repostsCount + (p.repostedByMe ? -1 : 1),
      });

      updatePostInCache(qc, postId, flip);

      return { prevFeed, prevPost };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: feedKey });
    },
    onError: (_err, postId, ctx) => {
      if (ctx?.prevFeed) qc.setQueryData(feedKey, ctx.prevFeed);
      if (ctx?.prevPost) qc.setQueryData(postKey(postId), ctx.prevPost);
      toast.error('リポストの更新に失敗しました');
    },
  });
};