import { getPostById } from './posts';
import type { User } from '@/types';

export type SearchNewsItem = {id: string; title: string; content: string; category: string; created_at: string; source?: 'limenote' | 'bluesky'; related_post_ids?: unknown; related_posts?: unknown};
export type NewsSources = {authors: User[]; postsCount: number};
function sourceIds(news: SearchNewsItem): string[] {
  const refs = [news.related_post_ids, news.related_posts].flatMap(value => Array.isArray(value) ? value : []);
  return [...new Set(refs.map(ref => typeof ref === 'string' ? ref : ref?.id).filter((id): id is string => typeof id === 'string' && !!id))];
}
export async function getNewsSources(news: SearchNewsItem[]): Promise<Record<string, NewsSources>> {
  const ids = [...new Set(news.flatMap(sourceIds))];
  const authors = new Map<string, User>();
  let next = 0;
  // Fetch current originals, rather than trusting persisted snapshots of restricted posts.
  await Promise.all(Array.from({length: Math.min(4, ids.length)}, async () => {
    while (next < ids.length) {
      const id = ids[next++];
      try { const post = await getPostById(id); if (post?.author) authors.set(id, post.author); } catch { /* Deleted or inaccessible sources have no avatar. */ }
    }
  }));
  return Object.fromEntries(news.map(item => {
    const visible = sourceIds(item).flatMap(id => authors.has(id) ? [authors.get(id)!] : []);
    return [item.id, {authors: [...new Map(visible.map(author => [author.id, author])).values()].slice(0, 3), postsCount: visible.length}];
  }));
}

export function latestNewsPerSource(news: SearchNewsItem[]): SearchNewsItem[] {
  // Each source owns one slot; never replace missing LimeNote news with Bluesky.
  return ['limenote', 'bluesky'].flatMap(source => {
    const latest = news.filter(item => (item.source || 'limenote') === source)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
    return latest ? [latest] : [];
  });
}
