// Supabase Auth からログイン中のユーザーIDを取得する
import { supabase } from './supabase';

export async function getCurrentUserId(): Promise<string> {
  // getUser() は毎回サーバーに通信するため、無限ループの原因になります。
  // getSession() はメモリ/ローカルストレージのキャッシュを返すため、高速でループしません。
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  
  if (!user) throw new Error('ログインが必要です');
  return user.id;
}