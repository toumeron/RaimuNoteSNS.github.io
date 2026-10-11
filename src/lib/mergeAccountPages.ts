export type AccountPage<T> = { buffer: T[]; next?: number; started: boolean };
export type MergedCursor<T> = { sources: Record<string, AccountPage<T>>; seen: string[] };
/** Merge ordered account streams before publishing a page, so later pages cannot jump above it. */
export async function mergeAccountPage<T>(ids: string[], previous: MergedCursor<T> | null, load: (id: string, offset: number) => Promise<{items: T[]; next?: number}>, compare: (a: T,b: T) => number, identity: (item: T) => string, limit: number, signal?: AbortSignal) {
  const sources = Object.fromEntries(ids.map(id => [id, previous?.sources[id]
    ? {...previous.sources[id], buffer: [...previous.sources[id].buffer]}
    : { buffer: [] as T[], next: 0, started: false }]));
  const seen = new Set(previous?.seen ?? []);
  const items: T[] = [];
  while (items.length < limit) {
    signal?.throwIfAborted();
    await Promise.all(ids.map(async id => {
      const source = sources[id];
      while (!source.buffer.length && source.next !== undefined) {
        const offset = source.next;
        const page = await load(id, offset);
        signal?.throwIfAborted();
        if (page.next !== undefined && page.next <= offset) throw new Error('読み込み位置が更新されませんでした');
        source.buffer = [...page.items].sort(compare);
        source.next = page.next; source.started = true;
      }
    }));
    const available = ids.filter(id => sources[id].buffer.length);
    if (!available.length) break;
    available.sort((a,b) => compare(sources[a].buffer[0],sources[b].buffer[0]) || a.localeCompare(b));
    const item = sources[available[0]].buffer.shift()!;
    const key = identity(item);
    if (!seen.has(key)) { seen.add(key); items.push(item); }
  }
  const hasNext = ids.some(id => sources[id].buffer.length || sources[id].next !== undefined);
  return { items, next: hasNext ? { sources, seen: [...seen] } as MergedCursor<T> : undefined };
}
