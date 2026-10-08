import { supabase } from './supabase';
export async function getPrivateBotPrompt(userId: string): Promise<string> {
  const {data, error} = await supabase.from('profile_private_settings').select('bot_prompt').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data?.bot_prompt ?? '';
}
