// Supabase Auth からログイン中のユーザーIDを取得する
import { supabase } from './supabase';

export async function getCurrentUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('ログインが必要です');
  return user.id;
}
