import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/currentUser';
import { fetchBlueskyPost } from '@/lib/bluesky';
import type { PostWithAuthor } from '@/types';

export const isExternalPostId = (id: string) => id.startsWith('bsky:at://') || /^misskey:https:\/\/misskey[.]io\/notes\/[A-Za-z0-9]+$/.test(id);

export async function getExternalRepostState(postId: string) {
  const userId = await getCurrentUserId();
  const [shares, quotes, own] = await Promise.all([
    supabase.from('external_reposts').select('*', { count: 'exact', head: true }).eq('post_id', postId),
    supabase.from('posts').select('*', { count: 'exact', head: true }).eq('quoted_external_post->>id', postId),
    userId ? supabase.from('external_reposts').select('post_id').eq('post_id', postId).eq('user_id', userId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (shares.error) throw shares.error;
  if (quotes.error) throw quotes.error;
  if (own.error) throw own.error;
  return { repostsCount: (shares.count ?? 0) + (quotes.count ?? 0), repostedByMe: Boolean(own.data) };
}

export async function getExternalPost(id: string): Promise<PostWithAuthor | null> {
  const post = await fetchBlueskyPost(id);
  if (!post) return null;
  const state = await getExternalRepostState(id);
  return { ...post, ...state, author: { bio: '', coverUrl: '', createdAt: post.createdAt, ...post.author } };
}

export async function toggleExternalRepost(id: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('ログインが必要です');
  const { data: existing, error } = await supabase.from('external_reposts').select('post_id')
    .eq('post_id', id).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (existing) {
    const result = await supabase.from('external_reposts').delete().eq('post_id', id).eq('user_id', userId);
    if (result.error) throw result.error;
  } else {
    const post = await fetchBlueskyPost(id);
    if (!post) throw new Error('引用元の投稿が見つかりません');
    const result = await supabase.from('external_reposts').insert({post_id: id, user_id: userId,
      post_snapshot: {...post, repostsCount: 0, repostedByMe: false} });
    if (result.error) throw result.error;
  }
  try {
    const state = await getExternalRepostState(id);
    return { reposted: !existing, repostsCount: state.repostsCount };
  } catch {
    return { reposted: !existing };
  }
}

export async function getExternalProfileReposts(userId: string, limit: number): Promise<PostWithAuthor[]> {
  const result = await supabase.from('external_reposts').select('post_snapshot, created_at')
    .eq('user_id', userId).order('created_at', { ascending: false }).order('post_id', { ascending: false }).range(0, limit - 1);
  if (result.error) throw result.error;
  return (result.data ?? []).map(row => ({ ...row.post_snapshot,
    profileRepostedAt: row.created_at, profileRepostedBy: userId } as PostWithAuthor));
}
