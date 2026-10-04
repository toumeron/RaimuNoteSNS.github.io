import { supabase } from '@/lib/supabase';
import type { LiveSpace, SpaceMember } from '@/components/spaces/SpaceContext';
export const SPACE_EMOJIS = ['😂', '😲', '😢', '💜', '💯', '👏', '✊', '👍', '👎', '👋', '✋'] as const;
export async function spaceRpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export const getLiveSpaces = () => spaceRpc<LiveSpace[]>('list_live_spaces');
export type SpaceState = { waiting?: boolean; space: LiveSpace | null; members: SpaceMember[]; anonymous_count: number; reactions: { id: string; emoji: string; created_at: string }[]; me?: { can_speak: boolean; requested: boolean; role: 'host' | 'speaker' | 'listener' } | null };
export const getSpaceState = (id: string) => spaceRpc<SpaceState>('get_space_state', { p_space_id: id });
export async function getSpaceToken(id: string, uid: number, publishing: boolean) {
  const { data, error } = await supabase.functions.invoke('space-token', { body: { spaceId: id, uid, publishing } });
  if (error) throw new Error('音声接続を開始できませんでした。もう一度お試しください。');
  if (!data?.token || !data?.appId) throw new Error(data?.error || '音声接続の設定を取得できませんでした。');
  return data as { token: string; appId: string; role: 'host' | 'audience' };
}
