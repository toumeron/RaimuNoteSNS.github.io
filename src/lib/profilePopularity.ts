/** A complete ranking input: never publish a partially scanned chronological feed. */
export async function collectProfilePages<T, C>(load: (cursor: C | null) => Promise<{ posts: T[]; cursor: C | null }>, signal?: AbortSignal): Promise<T[]> {
  const posts: T[] = [];
  const seen = new Set<C>();
  let cursor: C | null = null;
  do {
    signal?.throwIfAborted();
    const page = await load(cursor);
    signal?.throwIfAborted();
    posts.push(...page.posts);
    cursor = page.cursor;
    if (cursor !== null) {
      if (seen.has(cursor)) throw new Error('投稿の取得カーソルが進みませんでした');
      seen.add(cursor);
    }
  } while (cursor !== null);
  return posts;
}
