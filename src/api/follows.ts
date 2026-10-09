import {getAccountFollowState, toggleAccountFollow} from './accountPrivacy';
import { supabase } from '@/lib/supabase';

// ── 修正内容 ──────────────────────────────────────────────────────────────
// DB の follows テーブルの実際のカラム名は follower_id / followee_id。
// コードが following_id を使っていたため 42703(column does not exist) が発生。
// また id カラムが存在しないため select('id') も 42703 エラーになっていた。
//   select('id', { count: 'exact' })
//     → select('*', { count: 'exact', head: true })  に変更
//   following_id  →  followee_id  に全箇所置換
// ─────────────────────────────────────────────────────────────────────────

export async function getFollowStats(userId: string): Promise<{
  followers: number;
  following: number;
  followedByMe: boolean;
  requestedByMe?: boolean;
  canView?: boolean;
}> {
  // External provider IDs are not UUIDs in Lime's follows table.
  if (userId.startsWith('misskey-user:') || userId.startsWith('did:')) {
    return { followers: 0, following: 0, followedByMe: false };
  }
  const state = await getAccountFollowState(userId);

  const [followersRes, followingRes] = await Promise.all([
    // 自分をフォローしている人の数 (userId が followee_id 側)
    supabase
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('followee_id', userId),
    // userId がフォローしている人の数 (userId が follower_id 側)
    supabase
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('follower_id', userId),
  ]);

  return {
    followers:    followersRes.count    ?? 0,
    following:    followingRes.count    ?? 0,
    followedByMe: state.followed,
    requestedByMe: state.requested,
    canView: state.canView,
  };
}

export async function toggleFollow(targetUserId: string): Promise<{ followed: boolean; requested?: boolean }> {
  return toggleAccountFollow(targetUserId);
}

export type KnownFollower = { id: string; username: string; displayName: string; avatarUrl: string };

/** Visible, accepted followers that the viewer already follows. */
export async function getKnownFollowers(viewerId: string, targetId: string): Promise<{total:number;users:KnownFollower[]}> {
  const empty={total:0,users:[] as KnownFollower[]};
  if(!viewerId||viewerId===targetId||targetId.startsWith('did:')||targetId.startsWith('misskey-user:'))return empty;
  const followedIds=new Set<string>();
  for(let offset=0;;offset+=1000){
    const {data,error}=await supabase.from('follows').select('followee_id').eq('follower_id',viewerId).eq('approved',true).order('followee_id').range(offset,offset+999);
    if(error)throw error;
    for(const row of data??[])if(row.followee_id&&row.followee_id!==viewerId)followedIds.add(row.followee_id);
    if((data?.length??0)<1000)break;
  }
  const ids=[...followedIds];
  let total=0;const users:KnownFollower[]=[];
  for(let offset=0;offset<ids.length;offset+=200){
    const {data,count,error}=await supabase.from('follows').select('profile:profiles!follows_follower_id_fkey(id,username,display_name,avatar_url)',{count:'exact'}).eq('followee_id',targetId).eq('approved',true).in('follower_id',ids.slice(offset,offset+200)).order('follower_id').range(0,2);
    if(error)throw error;
    total+=count??0;
    for(const row of data??[]){
      const profile=Array.isArray(row.profile)?row.profile[0]:row.profile;
      if(profile&&users.length<3)users.push({id:profile.id,username:profile.username,displayName:profile.display_name||profile.username,avatarUrl:profile.avatar_url||''});
    }
  }
  return {total,users};
}
