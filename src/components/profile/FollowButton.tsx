import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFollowStats, useToggleFollow } from '@/hooks/useProfile';
import { cn } from '@/lib/utils';
import {
  isBlueskyProfileId,
  fetchBlueskyActorViewerState,
  followBlueskyUser,
  unfollowBlueskyUser,
} from '@/lib/bluesky';
import { useBlueskySession } from '@/hooks/useBlueskySession';

const followButtonClassName = (followed: boolean) =>
  cn(
    'group inline-flex h-10 items-center justify-center',
    'rounded-full px-5',
    'whitespace-nowrap',
    'border',
    'text-sm font-bold leading-none',
    'shadow-none',
    'transition-all duration-150',
    'hover:shadow-none',
    'focus-visible:ring-2 focus-visible:ring-black/20',
    'dark:focus-visible:ring-white/20',
    'disabled:pointer-events-none',
    'disabled:opacity-60',

    followed
      ? [
          // フォロー中
          'relative',
          'overflow-hidden',

          // ライトモード通常時
          'border-[#d9d9d9]',
          'bg-transparent',
          'text-[#111111]',

          // ライトモードホバー時
          'hover:bg-transparent',
          'hover:border-[#ff2d3f]',
          'hover:text-[#ff2d3f]',

          // 明るめの赤い半透明フィルター
          'after:pointer-events-none',
          'after:absolute',
          'after:inset-0',
          'after:rounded-full',
          'after:bg-[#ff4d5a]/15',
          'after:opacity-0',
          'after:transition-opacity',
          'after:duration-150',
          'hover:after:opacity-100',

          // ダークモード通常時
          'dark:border-[#555555]',
          'dark:bg-transparent',
          'dark:text-white',

          // ダークモードホバー時
          'dark:hover:bg-transparent',
          'dark:hover:border-[#ff2d3f]',
          'dark:hover:text-[#ff2d3f]',

          // ダークモードは少し暗めの赤フィルター
          'dark:after:bg-[#7f1d1d]/30',

          // フィルターより文字を前面に表示
          '[&>*]:relative',
          '[&>*]:z-10',

          // 押下時
          'active:brightness-90',
        ]
      : [
          // フォロー
          // ライトモード
          'border-[#111111]',
          'bg-[#111111]',
          'text-white',
          'hover:border-[#222222]',
          'hover:bg-[#222222]',
          'hover:text-white',

          // ダークモード
          'dark:border-white',
          'dark:bg-white',
          'dark:text-[#111111]',
          'dark:hover:border-[#dddddd]',
          'dark:hover:bg-[#dddddd]',
          'dark:hover:text-[#111111]',

          // 押下時
          'active:brightness-90',
        ],
  );

function FollowButtonLabel({
  isPending,
  followed,
}: {
  isPending: boolean;
  followed: boolean;
}) {
  if (isPending) {
    return <Loader2 className="relative z-10 h-4 w-4 animate-spin" />;
  }
  if (followed) {
    return (
      <>
        <span className="relative z-10 group-hover:hidden">フォロー中</span>
        <span className="relative z-10 hidden group-hover:inline">フォロー解除</span>
      </>
    );
  }
  return <span className="relative z-10">フォロー</span>;
}

/**
 * Bluesky投稿・プロフィール用のフォローボタン。
 * 自分のBlueskyアカウントでログインしている場合のみ表示・動作する
 * (呼び出し元でも session の有無をチェックして空欄を避けることを推奨するが、
 * 念のためこのコンポーネント自身も未ログイン時はnullを返す)。
 */
function BlueskyFollowButton({ did }: { did: string }) {
  const session = useBlueskySession(did);
  const [followUri, setFollowUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, setIsPending] = useState(false);
  const followed = Boolean(followUri);

  useEffect(() => {
    if (!session) {
      setFollowUri(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setFollowUri(null);
    setIsLoading(true);

    fetchBlueskyActorViewerState(did)
      .then((state) => {
        if (!cancelled) setFollowUri(state.followUri);
      })
      .catch(error=>{if(!cancelled) console.warn('External follow state unavailable',error);})
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [did, session?.did]);

  if (!session) return null;

  const handleClick = async () => {
    if (isPending || isLoading) return;
    setIsPending(true);

    try {
      if (followed && followUri) {
        await unfollowBlueskyUser(followUri);
        setFollowUri(null);
      } else {
        const uri = await followBlueskyUser(did);
        setFollowUri(uri);
      }
    } catch (error) {
      console.error('Bluesky Follow Toggle Error:', error);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Button
      type="button"
      onClick={handleClick}
      disabled={isPending || isLoading}
      aria-busy={isPending || isLoading}
      className={followButtonClassName(followed)}
    >
      <FollowButtonLabel isPending={isPending || isLoading} followed={followed} />
    </Button>
  );
}

/** Lime内部ユーザー同士の通常のフォローボタン */
function LimeFollowButton({ userId }: { userId: string }) {
  const { data, isLoading } = useFollowStats(userId);
  const { mutate, isPending } = useToggleFollow(userId);
  const followed = data?.followedByMe ?? false;
  // フォロー状態の初回取得が終わるまでは followedByMe が不明なため、
  // 「フォロー」を一瞬表示してしまわないよう、スピナー表示にして操作も無効にする。
  const isStatusLoading = isLoading && data === undefined;
  const isBusy = isPending || isStatusLoading;

  return (
    <Button
      type="button"
      onClick={() => mutate()}
      disabled={isBusy}
      aria-busy={isBusy}
      // 読み込み中は黒い「フォロー」ボタンではなく、枠線のみの中立的な見た目にする
      className={followButtonClassName(followed || isStatusLoading)}
    >
      <FollowButtonLabel isPending={isBusy} followed={followed} />
    </Button>
  );
}

export function FollowButton({ userId }: { userId: string }) {
  // BlueskyのDID(did:から始まるid)の場合は、Bluesky側のフォロー機能に分岐する。
  // 自分のBlueskyアカウントでログインしていない場合、BlueskyFollowButtonはnullを返す。
  if (isBlueskyProfileId(userId)) {
    return <BlueskyFollowButton did={userId} />;
  }

  return <LimeFollowButton userId={userId} />;
}