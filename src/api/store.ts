// デモ用インメモリストアは削除済み。全データは Supabase から取得します。

// ランダムID生成ユーティリティ（Supabase Insert 後は不要だが互換性のため残存）
export const newId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
