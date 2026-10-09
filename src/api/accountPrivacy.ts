import { supabase } from '@/lib/supabase';
export type AccountFollowState = { followed: boolean; requested: boolean; canView: boolean };
export type FollowRequest = { id: string; username: string; displayName: string; avatarUrl: string; isPrivate: boolean; isOfficial: boolean };
export async function getAccountFollowState(id: string): Promise<AccountFollowState> {
 const { data, error } = await supabase.rpc('get_account_follow_state', { target_user_id: id });
 if (error) throw error;
 return data;
}
export async function toggleAccountFollow(id: string): Promise<AccountFollowState> {
 const { data, error } = await supabase.rpc('toggle_account_follow', { target_user_id: id });
 if (error) throw error;
 return data;
}
export async function getFollowRequests(): Promise<FollowRequest[]> {
 const { data, error } = await supabase.rpc('get_account_follow_requests');
 if (error) throw error;
 return data ?? [];
}
export async function respondFollowRequest(id: string, accept: boolean) {
 const { error } = await supabase.rpc('respond_account_follow_request', { requester_id: id, accept_request: accept });
 if (error) throw error;
}
