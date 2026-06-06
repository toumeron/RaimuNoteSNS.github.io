import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createComment, getCommentsByPost } from '@/api/comments';
import { feedKey, postKey } from './useFeed';
import { toast } from 'sonner';
import type { CommentWithAuthor, PostWithAuthor } from '@/types';
import { getCurrentUserId } from '@/lib/currentUser';
import { supabase } from '@/lib/supabase';

export const commentsKey = (postId: string) => ['comments', postId] as const;

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

export const useComments = (postId: string) => {
  const qc = useQueryClient();

  useEffect(() => {
    if (!postId) return;

    const channel = supabase
      .channel(`comments-profiles-${postId}-${Math.random().toString(36).slice(2)}`)
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
      .subscribe();

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