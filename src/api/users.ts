import type { User } from '@/types';
import { supabase } from '@/lib/supabase';

// Supabase の profiles テーブル行をアプリの User 型に変換
// DB側: snake_case / アプリ側: camelCase
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toUser(row: any): User {
  return {
    id: row.id as string,
    username: row.username as string,
    displayName: (row.display_name ?? '') as string,
    bio: (row.bio ?? '') as string,
    avatarUrl: (row.avatar_url ?? '') as string,
    coverUrl: (row.cover_url ?? '') as string,
    createdAt: (row.created_at ?? '') as string,
  };
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('username', username)
    .single();

  if (error || !data) return null;
  return toUser(data);
}

export async function getUserById(id: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return null;
  return toUser(data);
}

export async function updateProfile(
  id: string,
  patch: Partial<Pick<User, 'displayName' | 'bio' | 'avatarUrl' | 'coverUrl'>>,
): Promise<User> {
  // アプリ側 camelCase → DB側 snake_case に変換してから送信
  const dbPatch: Record<string, unknown> = {};
  if (patch.displayName !== undefined) dbPatch.display_name = patch.displayName;
  if (patch.bio !== undefined) dbPatch.bio = patch.bio;
  if (patch.avatarUrl !== undefined) dbPatch.avatar_url = patch.avatarUrl;
  if (patch.coverUrl !== undefined) dbPatch.cover_url = patch.coverUrl;

  const { data, error } = await supabase
    .from('profiles')
    .update(dbPatch)
    .eq('id', id)
    .select('*')
    .single();

  if (error || !data) throw new Error('ユーザーが見つかりません');
  return toUser(data);
}
