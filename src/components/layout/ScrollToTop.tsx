import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export const ScrollToTop = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    // ページ（パス）が変わるたびに、スクロール位置を 0, 0 (左上) に戻す
    window.scrollTo(0, 0);
  }, [pathname]);

  return null; // 何も表示しない
};