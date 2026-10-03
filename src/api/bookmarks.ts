import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/currentUser';
import { getPostById } from './posts';
import { isExternalPostId } from './external-posts';
import type { PostWithAuthor } from '@/types';

export type BookmarkTarget = { id: string } & Partial<PostWithAuthor>;
type BookmarkRow = { id: string; post_id: string | null; comment_id: string | null; external_id: string | null; external_snapshot?: PostWithAuthor | null; created_at: string };
const sourceId = (row: Pick<BookmarkRow, 'post_id' | 'comment_id' | 'external_id'>) => row.external_id ?? (row.comment_id ? `reply:${row.comment_id}` : row.post_id!);
function source(target: BookmarkTarget) {
  if (target.id.startsWith('reply:')) return { column: 'comment_id', value: target.id.slice(6) } as const;
  if (isExternalPostId(target.id)) return { column: 'external_id', value: target.id } as const;
  return { column: 'post_id', value: target.id } as const;
}
export async function getBookmarkIds(userId: string): Promise<string[]> {
  const ids: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from('bookmarks').select('post_id, comment_id, external_id').eq('user_id', userId).order('id').range(offset, offset + 999);
    if (error) throw error;
    ids.push(...(data ?? []).map(sourceId));
    if ((data?.length ?? 0) < 1000) return ids;
  }
}
export async function setBookmark(target: BookmarkTarget, saved: boolean, expectedUserId: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (userId !== expectedUserId) throw new Error('アカウントが切り替わりました。もう一度お試しください');
  const { column, value } = source(target);
  if (!saved) {
    const { error } = await supabase.from('bookmarks').delete().eq('user_id', userId).eq(column, value);
    if (error) throw error;
    return;
  }
  if (column === 'external_id' && (target.visibility !== 'public' || !target.author || typeof target.content !== 'string')) throw new Error('投稿を読み込んでからブックマークしてください');
  const snapshot = column === 'external_id' ? { ...target, parentPost: null, profileRepostedBy: undefined, profileRepostedAt: undefined } : null;
  const { error } = await supabase.from('bookmarks').insert({ user_id: userId, [column]: value, ...(snapshot ? { external_snapshot: snapshot } : {}) });
  if (error && error.code !== '23505') throw error;
}
export async function getBookmarkPage(userId: string, offset = 0, limit = 20): Promise<{ posts: PostWithAuthor[]; unavailable: number; next?: number }> {
  const { data, error } = await supabase.from('bookmarks').select('id, post_id, comment_id, external_id, external_snapshot, created_at').eq('user_id', userId).order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + limit - 1);
  if (error) throw error;
  const rows = (data ?? []) as BookmarkRow[];
  const posts = await Promise.all(rows.map(async row => {
    if (row.external_id) return row.external_snapshot?.id === row.external_id && row.external_snapshot.visibility === 'public' ? row.external_snapshot : null;
    // Always fetch native originals through their current visibility rules.
    return getPostById(sourceId(row));
  }));
  return { posts: posts.filter((post): post is PostWithAuthor => !!post), unavailable: posts.filter(post => !post).length, next: rows.length === limit ? offset + limit : undefined };
}
