import {supabase} from '@/lib/supabase';
import { getPostById } from './posts';
import type { PostWithAuthor, User } from '@/types';

export type SearchNewsItem = {id: string; title: string; content: string; category: string; created_at: string; source?: 'limenote' | 'bluesky'; updated_at?: string; source_post_ids?: unknown; related_post_ids?: unknown; related_posts?: unknown};
export type NewsSources = {authors: User[]; postsCount: number};
export function sourceIds(news: SearchNewsItem): string[] {
  const refs = [news.related_post_ids, news.related_posts, news.source_post_ids].flatMap(value => Array.isArray(value) ? value : []);
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

/** Publish article and citation metadata together so late avatars cannot shift the row. */
export async function getLatestSearchNews() {
  const results=await Promise.all(['limenote','bluesky'].map(source=>supabase
    .from('news_summaries').select('*').eq('source',source)
    .eq('public_sources_verified',true).order('created_at',{ascending:false}).limit(1)));
  const error=results.find(result=>result.error)?.error;
  if(error)throw error;
  const items:SearchNewsItem[]=results.flatMap(result=>result.data??[]);
  return {items,sources:await getNewsSources(latestNewsPerSource(items))};
}


export async function getNewsStory(id: string | null): Promise<SearchNewsItem | null> {
  let query = supabase.from('news_summaries').select('*');
  if (id) query = query.eq('id', id);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function getNewsHistory(offset = 0): Promise<SearchNewsItem[]> {
  const { data, error } = await supabase.from('news_summaries').select('id,title,content,category,source,created_at')
    .order('created_at', { ascending: false }).range(offset, offset + 19);
  if (error) throw error;
  return data ?? [];
}

export async function getNewsRelatedPosts(news: SearchNewsItem): Promise<PostWithAuthor[]> {
  const ids = sourceIds(news).slice(0, 30);
  const posts: PostWithAuthor[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
    while (next < ids.length) {
      const id = ids[next++];
      try { const post = await getPostById(id); if (post) posts.push(post); }
      catch { /* Deleted or inaccessible originals must not use stale saved snapshots. */ }
    }
  }));
  return posts;
}
