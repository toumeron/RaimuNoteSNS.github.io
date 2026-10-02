import type { QueryClient } from '@tanstack/react-query';

const CHILD_KEYS = ['pages', 'posts', 'post', 'parentPost', 'parent_post', 'comments', 'comment', 'replies'] as const;

// Preserve cache shape and references for rows unaffected by this update.
function updateCount(value: unknown, targetId: string, count: number): unknown {
  if (Array.isArray(value)) {
    const next = value.map(item => updateCount(item, targetId, count));
    return next.some((item, index) => item !== value[index]) ? next : value;
  }
  if (!value || typeof value !== 'object') return value;
  const row = value as Record<string, unknown>;
  let next = row;
  if (row.id === targetId && (row.likesCount !== count || row.likes_count !== count)) {
    next = { ...row, likesCount: count, likes_count: count };
  }
  for (const key of CHILD_KEYS) {
    if (!(key in row)) continue;
    const child = updateCount(row[key], targetId, count);
    if (child !== row[key]) {
      if (next === row) next = { ...row };
      next[key] = child;
    }
  }
  return next;
}

export function updateLikeCountCache(client: QueryClient, type: 'post' | 'comment', targetId: string, count: number) {
  const prefixes = type === 'post' ? ['feed', 'post', 'posts'] : ['comments', 'comment'];
  client.setQueriesData({
    predicate: query => prefixes.includes(String(query.queryKey[0])),
  }, data => updateCount(data, targetId, count));
}
