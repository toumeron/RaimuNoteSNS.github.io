import { 
  useMutation, 
  useQuery, 
  useInfiniteQuery, 
  useQueryClient,
  InfiniteData 
} from '@tanstack/react-query';
import { getUserByUsername, updateProfile } from '@/api/users';
import { getFollowStats, toggleFollow } from '@/api/follows';
import { getPostsByUser } from '@/api/posts'; 
import type { PostWithAuthor } from '@/types';
import { toast } from 'sonner';

export const profileKey = (username: string) => ['profile', username] as const;
export const followStatsKey = (userId: string) => ['follow-stats', userId] as const;
export const userPostsKey = (userId: string) => ['posts', 'user', userId] as const;

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
 * プロフィール画面用：投稿一覧（無限スクロール版）
 */
export const useUserPostsInfinite = (userId: string | undefined) =>
  useInfiniteQuery({
    queryKey: userPostsKey(userId ?? ''),
    queryFn: ({ pageParam = 0 }) => getPostsByUser(userId!, pageParam as number, LIMIT),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      // 取得件数がLIMIT未満なら次はない
      return lastPage.length < LIMIT ? undefined : allPages.length;
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
      // フォロー状態が変わったので、ユーザーの投稿一覧も念のため再取得
      qc.invalidateQueries({ queryKey: ['posts', 'user', targetUserId] });
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
      // プロフィール情報と、そのユーザーに関連する投稿のキャッシュを更新
      qc.invalidateQueries({ queryKey: ['profile'] });
      qc.invalidateQueries({ queryKey: ['posts', 'user', userId] });
      toast.success('プロフィールを更新しました');
    },
    onError: () => toast.error('プロフィールの更新に失敗しました'),
  });
};