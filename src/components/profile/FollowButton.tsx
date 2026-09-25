import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFollowStats, useToggleFollow } from '@/hooks/useProfile';
import { cn } from '@/lib/utils';

export function FollowButton({ userId }: { userId: string }) {
  const { data } = useFollowStats(userId);
  const { mutate, isPending } = useToggleFollow(userId);
  const followed = data?.followedByMe ?? false;

  return (
    <Button
      type="button"
      onClick={() => mutate()}
      disabled={isPending}
      aria-busy={isPending}
      className={cn(
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
      )}
    >
      {isPending ? (
        <Loader2 className="relative z-10 h-4 w-4 animate-spin" />
      ) : followed ? (
        <>
          <span className="relative z-10 group-hover:hidden">
            フォロー中
          </span>
          <span className="relative z-10 hidden group-hover:inline">
            フォロー解除
          </span>
        </>
      ) : (
        <span className="relative z-10">フォロー</span>
      )}
    </Button>
  );
}