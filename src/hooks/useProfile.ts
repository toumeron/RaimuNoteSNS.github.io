import { 
  useMutation, 
  useQuery, 
  useInfiniteQuery, 
  useQueryClient,
} from '@tanstack/react-query';
import { getUserByUsername, updateProfile } from '@/api/users';
import { getFollowStats, toggleFollow } from '@/api/follows';
import { getPostsByUser, getLikedPostsByUser } from '@/api/posts';
import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/currentUser';
import { toast } from 'sonner';

export const profileKey = (username: string) => ['profile', username] as const;
export const followStatsKey = (userId: string) => ['follow-stats', userId] as const;
export const userPostsKey = (userId: string) => ['posts', 'user', userId] as const;
export const userLikesKey = (userId: string) => ['posts', 'likes', userId] as const;
export const userMediaKey = (userId: string) => ['posts', 'media', userId] as const;

const LIMIT = 10;

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
 */
export const useUserPostsInfinite = (userId: string | undefined) =>
  useInfiniteQuery({
    queryKey: userPostsKey(userId ?? ''),
    queryFn: ({ pageParam = 0 }) => getPostsByUser(userId!, pageParam as number, LIMIT),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      return (lastPage?.length ?? 0) < LIMIT ? undefined : allPages.length;
    },
    enabled: !!userId,
  });

/**
 * プロフィール画面用：いいねした投稿一覧
 */
export const useUserLikesInfinite = (userId: string | undefined) =>
  useInfiniteQuery({
    queryKey: userLikesKey(userId ?? ''),
    queryFn: ({ pageParam = 0 }) => getLikedPostsByUser(userId!, pageParam as number, LIMIT),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      return (lastPage?.length ?? 0) < LIMIT ? undefined : allPages.length;
    },
    enabled: !!userId,
  });

/**
 * プロフィール画面用：メディア投稿一覧
 * 閲覧権限（自分、フォロワー、外部）に応じて取得対象を厳格に制限する
 */
export const useUserMediaInfinite = (userId: string | undefined) =>
  useInfiniteQuery({
    queryKey: userMediaKey(userId ?? ''),
    queryFn: async ({ pageParam = 0 }) => {
      if (!userId) return [];

      const from = (pageParam as number) * LIMIT;
      const to = from + LIMIT - 1;

      // 1. 閲覧者の特定
      const currentUserId = await getCurrentUserId();
      const isOwner = currentUserId === userId;

      // 2. フォロー状態の確認（自分自身でない場合のみ）
      let isFollowing = false;
      if (currentUserId && !isOwner) {
        const { data: follow } = await supabase
          .from('follows')
          .select('follower_id')
          .eq('follower_id', currentUserId)
          .eq('followee_id', userId)
          .maybeSingle();
        isFollowing = !!follow;
      }

      // 3. クエリ構築
      let query = supabase
        .from('posts')
        .select(`
          *,
          author:user_id(*)
        `)
        .eq('user_id', userId);

      // 画像判定フィルタ
      const imagePatterns = [
        '%.jpg%', '%.jpeg%', '%.png%', '%.webp%', '%.gif%', '%.svg%',
        '%pbs.twimg.com/media%', '%res.cloudinary.com%'
      ];
      const contentFilter = imagePatterns.map(p => `content.ilike.${p}`).join(',');
      const orFilter = `image_urls.not.is.null,image_urls.neq.{},${contentFilter}`;
      query = query.or(orFilter);

      // 4. 閲覧制限の適用（PostCard.tsx の visibility ロジックに準拠）
      // 「閲覧制限＝その権限がない場合は画像（投稿）を取得させない」
      if (!isOwner) {
        if (isFollowing) {
          // フォロワーなら public と following の両方を取得可能
          query = query.in('visibility', ['public', 'following']);
        } else {
          // 非フォロワーなら public のみ
          query = query.eq('visibility', 'public');
        }
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;
      return data || [];
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      return (lastPage?.length ?? 0) < LIMIT ? undefined : allPages.length;
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
 */
export const useUpdateProfile = (userId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Parameters<typeof updateProfile>[1]) => updateProfile(userId, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile'] });
      qc.invalidateQueries({ queryKey: ['posts', 'user', userId] });
      qc.invalidateQueries({ queryKey: ['auth-user'] }); 
      toast.success('プロフィールを更新しました');
    },
    onError: () => toast.error('プロフィールの更新に失敗しました'),
  });
};