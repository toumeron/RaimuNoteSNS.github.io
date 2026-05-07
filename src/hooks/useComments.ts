import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createComment, getCommentsByPost } from '@/api/comments';
import { feedKey, postKey } from './useFeed';
import { toast } from 'sonner';
import type { CommentWithAuthor, PostWithAuthor } from '@/types';
import { getCurrentUserId } from '@/lib/currentUser';
import { supabase } from '@/lib/supabase';

export const commentsKey = (postId: string) => ['comments', postId] as const;

export const useComments = (postId: string) => {
  return useQuery({
    queryKey: commentsKey(postId),
    queryFn: async () => {
      const [comments, currentUserId] = await Promise.all([
        getCommentsByPost(postId),
        getCurrentUserId()
      ]);

      if (!comments || comments.length === 0) return [];

      try {
        // 全コメントに対する「いいね」を全量取得して、フロントで集計する
        // これにより comments テーブルの likes_count カラムが古くても「真実」を表示できる
        const { data: allLikes, error: likeError } = await supabase
          .from('comment_likes')
          .select('comment_id, user_id')
          .in('comment_id', comments.map(c => c.id));

        if (likeError) throw likeError;

        // 集計用マップの作成
        const likeCountsMap: Record<string, number> = {};
        const likedByMeSet = new Set<string>();

        allLikes?.forEach(like => {
          likeCountsMap[like.comment_id] = (likeCountsMap[like.comment_id] || 0) + 1;
          if (currentUserId && like.user_id === currentUserId) {
            likedByMeSet.add(like.comment_id);
          }
        });

        // データの再構築
        return comments.map(comment => ({
          ...comment,
          likesCount: likeCountsMap[comment.id] || 0, // DBの実レコード数で上書き
          likedByMe: likedByMeSet.has(comment.id)    // 自分のいいね状態で上書き
        }));
      } catch (err) {
        console.error('Data sync failed, falling back to API data:', err);
        return comments;
      }
    },
    enabled: !!postId,
    staleTime: 0,
  });
};

export const useCreateComment = (postId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => createComment(postId, content),
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