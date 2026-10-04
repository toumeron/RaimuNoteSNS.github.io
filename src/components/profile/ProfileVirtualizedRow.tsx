import { memo, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { useInView } from 'react-intersection-observer';
const PROFILE_VIRTUALIZATION_ROOT_MARGIN = '1600px 0px 1600px 0px';

const useProfileRowVisibility = (
  rowKey: string,
  heightCache: MutableRefObject<Map<string, number>>
) => {
  // initialInView: true にすることで、新しく読み込まれた（＝今まさに
  // 画面付近にある）カードは今まで通り即座にフル描画される。実際に
  // 遠くへスクロールされたと Observer が判定して初めて非表示化される
  // ため、初回表示時のちらつき・見た目の変化は発生しない。
  const { ref: inViewRef, inView } = useInView({
    initialInView: true,
    fallbackInView: true,
    rootMargin: PROFILE_VIRTUALIZATION_ROOT_MARGIN,
  });

  const measureRef = useRef<HTMLDivElement>(null);
  const [placeholderHeight, setPlaceholderHeight] = useState<number | undefined>(
    () => heightCache.current.get(rowKey)
  );

  useEffect(() => {
    if (!inView && placeholderHeight) return;

    const node = measureRef.current;
    if (!node) return;

    const measure = () => {
      const height = node.offsetHeight;
      if (height > 0) {
        heightCache.current.set(rowKey, height);
        setPlaceholderHeight(height);
      }
    };

    measure();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    // 画像読み込み完了などでカードの高さが後から変わるケースに備え、
    // 表示中は継続的に高さを追従してキャッシュを更新する。
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(node);

    return () => {
      resizeObserver.disconnect();
    };
  }, [inView, rowKey, heightCache, placeholderHeight]);

  return { inViewRef, measureRef, inView, placeholderHeight };
};

export const ProfileVirtualizedListItem = memo(function ProfileVirtualizedListItem({
  rowKey,
  heightCache,
  children,
}: {
  rowKey: string;
  heightCache: MutableRefObject<Map<string, number>>;
  children: ReactNode;
}) {
  const { inViewRef, measureRef, inView, placeholderHeight } = useProfileRowVisibility(rowKey, heightCache);

  return (
    <div ref={inViewRef} data-lime-profile-row={rowKey}>
      {inView || !placeholderHeight ? (
        <div ref={measureRef}>{children}</div>
      ) : (
        <div style={{ height: placeholderHeight ? `${placeholderHeight}px` : undefined }} aria-hidden="true" />
      )}
    </div>
  );
});

