import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createComment, getCommentsByPost } from '@/api/comments';
import { feedKey, postKey } from './useFeed';
import { toast } from 'sonner';
import type { CommentWithAuthor, PostWithAuthor } from '@/types';

export const commentsKey = (postId: string) => ['comments', postId] as const;

export const useComments = (postId: string) =>
  useQuery({ queryKey: commentsKey(postId), queryFn: () => getCommentsByPost(postId), enabled: !!postId });

export const useCreateComment = (postId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => createComment(postId, content),
    onMutate: async (content) => {
      await qc.cancelQueries({ queryKey: commentsKey(postId) });
      const prev = qc.getQueryData<CommentWithAuthor[]>(commentsKey(postId));
      // 投稿のカウントも楽観的に+1
      const prevPost = qc.getQueryData<PostWithAuthor>(postKey(postId));
      if (prevPost) qc.setQueryData(postKey(postId), { ...prevPost, commentsCount: prevPost.commentsCount + 1 });
      return { prev, prevPost };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: commentsKey(postId) });
      qc.invalidateQueries({ queryKey: feedKey });
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(commentsKey(postId), ctx.prev);
      if (ctx?.prevPost) qc.setQueryData(postKey(postId), ctx.prevPost);
      toast.error('コメントの送信に失敗しました');
    },
  });
};
