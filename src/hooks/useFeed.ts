import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  createPost, 
  getFeed, 
  getPostById, 
  getPostsByUser, 
  toggleLike, 
  toggleRepost // 追加
} from '@/api/posts';
import type { PostWithAuthor } from '@/types';
import { toast } from 'sonner';

export const feedKey = ['feed'] as const;
export const postKey = (id: string) => ['post', id] as const;
export const userPostsKey = (userId: string) => ['posts', 'user', userId] as const;

export const useFeed = () =>
  useQuery({ queryKey: feedKey, queryFn: getFeed });

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

export const useToggleLike = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) => toggleLike(postId),
    onMutate: async (postId) => {
      await qc.cancelQueries({ queryKey: feedKey });
      const prevFeed = qc.getQueryData<PostWithAuthor[]>(feedKey);
      const prevPost = qc.getQueryData<PostWithAuthor>(postKey(postId));

      const flip = (p: PostWithAuthor): PostWithAuthor => ({
        ...p,
        likedByMe: !p.likedByMe,
        likesCount: p.likesCount + (p.likedByMe ? -1 : 1),
      });

      if (prevFeed) {
        qc.setQueryData<PostWithAuthor[]>(
          feedKey,
          prevFeed.map((p) => (p.id === postId ? flip(p) : p)),
        );
      }
      if (prevPost) qc.setQueryData<PostWithAuthor>(postKey(postId), flip(prevPost));

      qc.getQueriesData<PostWithAuthor[]>({ queryKey: ['posts', 'user'] }).forEach(([key, list]) => {
        if (!list) return;
        qc.setQueryData<PostWithAuthor[]>(
          key,
          list.map((p) => (p.id === postId ? flip(p) : p)),
        );
      });

      return { prevFeed, prevPost };
    },
    onError: (_err, postId, ctx) => {
      if (ctx?.prevFeed) qc.setQueryData(feedKey, ctx.prevFeed);
      if (ctx?.prevPost) qc.setQueryData(postKey(postId), ctx.prevPost);
      toast.error('いいねの更新に失敗しました');
    },
  });
};

/**
 * リポストのトグル用フック
 */
export const useToggleRepost = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) => toggleRepost(postId),
    onMutate: async (postId) => {
      await qc.cancelQueries({ queryKey: feedKey });
      const prevFeed = qc.getQueryData<PostWithAuthor[]>(feedKey);
      const prevPost = qc.getQueryData<PostWithAuthor>(postKey(postId));

      const flip = (p: PostWithAuthor): PostWithAuthor => ({
        ...p,
        repostedByMe: !p.repostedByMe,
        repostsCount: p.repostsCount + (p.repostedByMe ? -1 : 1),
      });

      if (prevFeed) {
        qc.setQueryData<PostWithAuthor[]>(
          feedKey,
          prevFeed.map((p) => (p.id === postId ? flip(p) : p)),
        );
      }
      if (prevPost) qc.setQueryData<PostWithAuthor>(postKey(postId), flip(prevPost));

      // ユーザー投稿一覧も更新
      qc.getQueriesData<PostWithAuthor[]>({ queryKey: ['posts', 'user'] }).forEach(([key, list]) => {
        if (!list) return;
        qc.setQueryData<PostWithAuthor[]>(
          key,
          list.map((p) => (p.id === postId ? flip(p) : p)),
        );
      });

      return { prevFeed, prevPost };
    },
    onSuccess: () => {
      // リポストは新規投稿が作成される場合があるため、一覧を最新化する
      qc.invalidateQueries({ queryKey: feedKey });
    },
    onError: (_err, postId, ctx) => {
      if (ctx?.prevFeed) qc.setQueryData(feedKey, ctx.prevFeed);
      if (ctx?.prevPost) qc.setQueryData(postKey(postId), ctx.prevPost);
      toast.error('リポストの更新に失敗しました');
    },
  });
};