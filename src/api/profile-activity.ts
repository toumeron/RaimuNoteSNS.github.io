import { supabase } from '@/lib/supabase';

/** Return the public aggregate, including restricted activity, without bodies. */
export async function getProfileActivityCount(userId: string): Promise<number> {
  const { data, error } = await supabase.rpc('get_profile_activity_count', { target_user_id: userId });
  if (error) throw error;
  if (typeof data !== 'number' && typeof data !== 'string') throw new Error('Invalid profile activity count');
  const count = Number(data);
  if (data == null || !Number.isSafeInteger(count) || count < 0) throw new Error('Invalid profile activity count');
  return count;
}
