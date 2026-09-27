import { memo, useEffect, useRef, useState } from 'react';

// PostCard.tsx の実レイアウトに合わせたローディングスケルトン。
// 以前はPC版と同じ「角丸カード」の見た目をモバイルにもそのまま出していたが、
// 実際の PostCard は isMobile のとき
//   - 角丸カードではなく、左右余白なし(px-0)・上下だけpy-3
//   - カードの区切りは枠線ではなく、下部の全幅ボーダー1本
//   - アバター h-11 w-11 (translate-y-1)
//   - 本文フォントは text-[16px]
//   - アクション行の高さは h-8 (PCは h-9)
// という別レイアウトになっている。読み込み完了の瞬間にレイアウトが
// カクッと変わって見えないよう、PostCard.tsx と全く同じ isMobile 判定と
// 同じクラス値を使ってモバイル/PCそれぞれのスケルトンを描画する。
//
// バグ修正: 最新/フォロー中/トレンドタブを切り替えると、このコンポーネントが
// 新規マウントされる瞬間に isMobile の初期値が常に false(PC版レイアウト)に
// なっていたため、実際の画面幅に関わらず一瞬だけPC版の「角丸カード」が
// 描画され、直後にuseEffectでモバイル用へ切り替わるという二段階レンダーに
// なっていた。これがタブ切り替え時に見える「PC版カードの残像」の原因。
// useState の lazy initializer でマウント時点から正しい値を持たせることで、
// 初回描画から正しいレイアウトになるようにする(Feed.tsx の
// initialMobileBackgroundFrame と同じ考え方)。
function PostCardSkeletonComponent() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === 'undefined' ? false : window.innerWidth < 640
  );
  const isMobileRef = useRef(false);
  const resizeRafRef = useRef<number | null>(null);

  useEffect(() => {
    // 初期値は useState の lazy initializer で既に確定しているため、
    // ここでは ref を同期するだけにする。以前あった updateMobileState() の
    // 即時呼び出しは、初回マウント時に不要な再レンダーを発生させる
    // (＝一瞬PC版→モバイル版に切り替わる二段階レンダー)原因だったため削除した。
    isMobileRef.current = isMobile;

    const updateMobileState = () => {
      const nextIsMobile = window.innerWidth < 640;
      if (isMobileRef.current === nextIsMobile) return;

      isMobileRef.current = nextIsMobile;
      setIsMobile(nextIsMobile);
    };

    const checkMobile = () => {
      if (resizeRafRef.current !== null) return;

      resizeRafRef.current = window.requestAnimationFrame(() => {
        resizeRafRef.current = null;
        updateMobileState();
      });
    };

    window.addEventListener('resize', checkMobile);

    return () => {
      if (resizeRafRef.current !== null) {
        window.cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      window.removeEventListener('resize', checkMobile);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      role="presentation"
      aria-hidden="true"
      className={
        isMobile
          ? 'relative mx-auto w-full max-w-[600px] px-0 py-3'
          : 'rounded-3xl border border-border/60 bg-card p-5 shadow-soft relative'
      }
    >
      {/* モバイルは角丸カードではなく、下部の全幅ボーダー1本で区切る
          (PostCard.tsx の isMobile && !timelineGlass の分岐と同じ) */}
      {isMobile && (
        <div className="pointer-events-none absolute bottom-0 left-1/2 w-screen -translate-x-1/2 border-b border-border/60" />
      )}

      <div className="flex animate-pulse items-start gap-3">
        {/* アバター: PostCard.tsx と同じ h-11 w-11 + translate-y-1 */}
        <div className="h-11 w-11 shrink-0 translate-y-1 rounded-full bg-muted" />

        <div className="min-w-0 flex-1">
          {/* 名前 + @ハンドル + 時刻 */}
          <div className="mb-1 flex items-center gap-2">
            <div className={isMobile ? 'h-4 w-24 rounded-full bg-muted' : 'h-4 w-28 rounded-full bg-muted'} />
            <div className={isMobile ? 'h-3.5 w-16 rounded-full bg-muted/60' : 'h-3.5 w-20 rounded-full bg-muted/60'} />
            <div className="h-3.5 w-6 rounded-full bg-muted/40" />
          </div>

          {/* 本文2行分 */}
          <div className={isMobile ? 'mt-1 space-y-2' : 'mt-1 space-y-2.5'}>
            <div className={isMobile ? 'h-4 w-[92%] rounded-full bg-muted' : 'h-4 w-[95%] rounded-full bg-muted'} />
            <div className={isMobile ? 'h-4 w-[68%] rounded-full bg-muted' : 'h-4 w-[74%] rounded-full bg-muted'} />
          </div>

          {/* アクション行: いいね・コメント・リアクション追加・共有
              PostCard.tsx と同じ高さ(モバイルh-8 / PC h-9)に合わせる */}
          <div
            className={
              isMobile
                ? 'relative mt-2 flex h-8 items-center gap-1 text-muted-foreground'
                : 'relative mt-3 flex h-9 items-center gap-1 text-muted-foreground'
            }
          >
            <div className={isMobile ? 'h-6 w-11 rounded-full bg-muted/55' : 'h-7 w-12 rounded-full bg-muted/55'} />
            <div className={isMobile ? 'h-6 w-11 rounded-full bg-muted/55' : 'h-7 w-12 rounded-full bg-muted/55'} />
            <div className={isMobile ? 'h-6 w-8 rounded-full bg-muted/45' : 'h-7 w-9 rounded-full bg-muted/45'} />
            <div className={isMobile ? 'ml-auto h-6 w-8 rounded-full bg-muted/45' : 'ml-auto h-7 w-9 rounded-full bg-muted/45'} />
          </div>
        </div>
      </div>
    </div>
  );
}

export const PostCardSkeleton = memo(PostCardSkeletonComponent);
PostCardSkeleton.displayName = 'PostCardSkeleton';