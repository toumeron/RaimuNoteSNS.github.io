import { uploadPostMedia } from '@/lib/uploadPostMedia';
import { getClientName } from '@/lib/clientName';
import type { PostWithAuthor } from '@/types';
import type { User } from '@/types';
import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/currentUser';
import { getExternalPost, getExternalProfileReposts, isExternalPostId, toggleExternalRepost } from './external-posts';
import { getReplyPost, getProfileReplyReposts, isReplyPostId, toggleReplyRepost, replyToPost, REPLY_REPOST_SELECT } from './reply-reposts';

export type FeedCursor = { createdAt: string; id: string };

const POST_SELECT_QUERY = `
  *,
  profiles:user_id (id, username, display_name, bio, avatar_url, cover_url, created_at, is_official),
  parent_reply:quoted_reply_id (${REPLY_REPOST_SELECT}),
  parent_post:parent_id (
    *,
    profiles:user_id (id, username, display_name, bio, avatar_url, cover_url, created_at, is_official)
  )
`;

function rowToUser(profile: any): User {
  if (!profile) return {} as User;
  return {
    id: profile.id,
    username:    profile.username    ?? '',
    displayName: profile.display_name ?? '',
    bio:         profile.bio         ?? '',
    avatarUrl:   profile.avatar_url  ?? '',
    coverUrl:    profile.cover_url   ?? '',
    createdAt:   profile.created_at  ?? '',
    isOfficial:  profile.is_official  ?? false,
  };
}

function rowToPost(row: any, likedIds: Set<string>, repostedIds: Set<string>): PostWithAuthor {
  return {
    ...row,
    id:            row.id,
    userId:        row.user_id,
    content:       row.content,
    imageUrls:     row.image_urls   ?? [],
    createdAt:     row.created_at,
    likesCount:    row.likes_count  ?? 0,
    commentsCount: row.comments_count ?? 0,
    repostsCount:  row.reposts_count ?? 0,
    likedByMe:     likedIds.has(row.id),
    repostedByMe:  repostedIds.has(row.id),
    author:        rowToUser(row.profiles),
    clientName:    row.client_name,
    parentId:      row.parent_id,
    isQuote:       row.is_quote,
    visibility:    row.visibility,
    isBot:         row.is_bot ?? false, // AIフラグをマッピングに追加
    parentPost: row.parent_post ? rowToPost(row.parent_post, likedIds, repostedIds) : row.parent_reply ? replyToPost(row.parent_reply) : row.quoted_external_post ?? null,
  };
}

type ViewerPostRow = { id: string; parent_post?: { id: string } | null };

// Apply the same visibility rules to reposted and quoted originals.
async function filterVisibleRows(rows: any[], userId: string | null): Promise<any[]> {
  const restrictedAuthors = [...new Set(rows.filter(row => row.visibility && row.visibility !== 'public' && row.user_id !== userId).map(row => row.user_id))];
  if (!restrictedAuthors.length) return rows;
  if (!userId) return rows.filter(row => !row.visibility || row.visibility === 'public');
  const [follows, memberships] = await Promise.all([
    supabase.from('follows').select('follower_id').eq('followee_id', userId).in('follower_id', restrictedAuthors),
    supabase.from('memberships').select('creator_id').eq('member_id', userId).in('creator_id', restrictedAuthors),
  ]);
  const following = new Set((follows.data ?? []).map(row => row.follower_id));
  const members = new Set((memberships.data ?? []).map(row => row.creator_id));
  return rows.filter(row => !row.visibility || row.visibility === 'public' || row.user_id === userId
    || (row.visibility === 'following' && following.has(row.user_id))
    || (row.visibility === 'members' && members.has(row.user_id)));
}

// Fetch fresh viewer state only for this page and its quoted parent posts.
async function getViewerReactions(userId: string, rows: ViewerPostRow[]) {
  const parents = rows.map((row: any) => row.parent_post).filter(Boolean);
  const visibleParents = new Set((await filterVisibleRows(parents, userId)).map(row => row.id));
  rows.forEach((row: any) => { if (row.parent_post && !visibleParents.has(row.parent_post.id)) row.parent_post = null; });
  const postIds = [...new Set(rows.flatMap((row) => [row.id, row.parent_post?.id]).filter(Boolean))];
  if (postIds.length === 0) return { likedIds: new Set<string>(), repostedIds: new Set<string>() };
  const [likesRes, repostsRes] = await Promise.all([
    supabase.from('likes').select('post_id').eq('user_id', userId).in('post_id', postIds),
    supabase.from('reposts').select('post_id').eq('user_id', userId).in('post_id', postIds),
  ]);
  // Viewer flags are optional enrichment. A missing reactions table or failed
  // request must not discard posts that were successfully fetched.
  // Keep each successful response even when the other one fails.
  return {
    likedIds: new Set<string>((likesRes.data ?? []).map((row) => String(row.post_id))),
    repostedIds: new Set<string>((repostsRes.data ?? []).map((row) => String(row.post_id))),
  };
}

/**
 * タイムライン取得（無限スクロール対応）
 * ロジック: 公開投稿、自分の投稿、自分をフォローしている人の投稿、
 * または自分がメンバーになっている投稿主のメンバー限定投稿を表示
 */
export async function getFeed(page: number = 0, limit: number = 10, before?: FeedCursor): Promise<PostWithAuthor[]> {
  const userId = await getCurrentUserId();
  
  const from = before ? 0 : page * limit;
  const to = from + limit - 1;

  // 「自分(userId)をフォローしている投稿主」のリストを取得
  const [{ data: followedByData }, { data: membershipsData }] = await Promise.all([
    supabase.from('follows').select('follower_id').eq('followee_id', userId),
    supabase.from('memberships').select('creator_id').eq('member_id', userId),
  ]);
  const authorsWhoFollowMe = followedByData?.map(f => f.follower_id) || [];

  const creatorsIAmMemberOf = membershipsData?.map(m => m.creator_id) || [];

  // OR条件の組み立て
  const conditions = [
    'visibility.eq.public', // 全体公開
    `user_id.eq.${userId}`   // 自分の投稿
  ];

  // 自分をフォローしている投稿主の投稿（限定公開分を含む）を条件に追加
  if (authorsWhoFollowMe.length > 0) {
    conditions.push(`and(user_id.in.(${authorsWhoFollowMe.join(',')}),visibility.eq.following)`);
  }

  // 自分がメンバーになっている投稿主の、メンバー限定投稿を条件に追加
  if (creatorsIAmMemberOf.length > 0) {
    conditions.push(`and(user_id.in.(${creatorsIAmMemberOf.join(',')}),visibility.eq.members)`);
  }

  const postsRes = await supabase
      .from('posts')
      .select(POST_SELECT_QUERY)
      .or(before
        ? `and(or(${conditions.join(',')}),or(created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})))`
        : conditions.join(','))
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to);
  if (postsRes.error) throw postsRes.error;
  const rows = postsRes.data ?? [];
  const { likedIds, repostedIds } = await getViewerReactions(userId, rows);
  return rows.map((row: any) => rowToPost(row, likedIds, repostedIds));
}

/**
 * フォローしているユーザーの投稿のみを取得（無限スクロール対応）
 * 「フォロー中」タブでも、フォローしている投稿主のメンバー限定投稿は
 * 自分がそのメンバーになっていれば表示する。
 */
export async function getFollowingFeed(page: number = 0, limit: number = 10, before?: FeedCursor): Promise<PostWithAuthor[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const from = before ? 0 : page * limit;
  const to = from + limit - 1;

  const [{ data: followingData }, { data: followedByData }, { data: membershipsData }] = await Promise.all([
    supabase.from('follows').select('followee_id').eq('follower_id', userId),
    supabase.from('follows').select('follower_id').eq('followee_id', userId),
    supabase.from('memberships').select('creator_id').eq('member_id', userId),
  ]);
  const followingIds = followingData?.map(f => f.followee_id) || [];
  if (followingIds.length === 0) return [];
  const authorsWhoFollowMe = followedByData?.map(f => f.follower_id) || [];
  const creatorsIAmMemberOf = membershipsData?.map(m => m.creator_id) || [];

  // 4. クエリ条件の組み立て
  // 「フォローしている人の公開投稿」 OR 「フォローしており、かつ相手も自分をフォローしている限定公開投稿」
  // OR 「フォローしており、かつ自分がメンバーになっているメンバー限定投稿」
  let filterConditions = `and(user_id.in.(${followingIds.join(',')}),visibility.eq.public)`;
  
  // 相互フォロー（相手が自分をフォローしている）の人がいれば、その人の限定公開投稿も加える
  const mutualFollowIds = followingIds.filter(id => authorsWhoFollowMe.includes(id));
  if (mutualFollowIds.length > 0) {
    filterConditions += `,and(user_id.in.(${mutualFollowIds.join(',')}),visibility.eq.following)`;
  }

  // フォローしている人の中で、自分がメンバーになっている人のメンバー限定投稿も加える
  const followingCreatorsIAmMemberOf = followingIds.filter(id => creatorsIAmMemberOf.includes(id));
  if (followingCreatorsIAmMemberOf.length > 0) {
    filterConditions += `,and(user_id.in.(${followingCreatorsIAmMemberOf.join(',')}),visibility.eq.members)`;
  }

  const postsRes = await supabase
      .from('posts')
      .select(POST_SELECT_QUERY)
      .or(before
        ? `and(or(${filterConditions}),or(created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})))`
        : filterConditions)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to);
  if (postsRes.error) throw postsRes.error;
  const rows = postsRes.data ?? [];
  const { likedIds, repostedIds } = await getViewerReactions(userId, rows);
  return rows.map((row: any) => rowToPost(row, likedIds, repostedIds));
}

/**
 * 特定ユーザーの投稿取得
 * 閲覧可能な visibility は次の条件で決まる:
 * - public: 常に表示
 * - following: 投稿主が閲覧者をフォローしている場合のみ表示
 * - members: 閲覧者が投稿主のメンバーである場合のみ表示
 */
export async function getPostsByUser(targetUserId: string, page: number = 0, limit: number = 10): Promise<PostWithAuthor[]> {
  const userId = await getCurrentUserId();
  
  const from = page * limit;
  const to = from + limit - 1;

  const [{ data: authorFollowsMe }, { data: membershipRow }] = await Promise.all([
    userId !== targetUserId
      ? supabase.from('follows').select('follower_id')
          .eq('follower_id', targetUserId).eq('followee_id', userId).maybeSingle()
      : Promise.resolve({ data: null }),
    userId !== targetUserId
      ? supabase.from('memberships').select('id')
          .eq('creator_id', targetUserId).eq('member_id', userId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const viewerIsMember = Boolean(membershipRow);

  let query = supabase
    .from('posts')
    .select(POST_SELECT_QUERY)
    .eq('user_id', targetUserId);

  // 本人以外の場合は、条件を満たす visibility のみに絞り込む
  if (userId !== targetUserId) {
    const allowedVisibilities: string[] = ['public'];
    if (authorFollowsMe) allowedVisibilities.push('following');
    if (viewerIsMember) allowedVisibilities.push('members');

    query = query.in('visibility', allowedVisibilities);
  }

  const postsRes = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to);
  if (postsRes.error) throw postsRes.error;
  const rows = postsRes.data ?? [];
  const { likedIds, repostedIds } = await getViewerReactions(userId, rows);
  return rows.map((row: any) => rowToPost(row, likedIds, repostedIds));
}

/**
 * 特定ユーザーがいいねした投稿取得
 */
export async function getLikedPostsByUser(targetUserId: string, page: number = 0, limit: number = 10): Promise<any[]> {
  const userId = await getCurrentUserId();
  
  const from = page * limit;
  const to = from + limit - 1;

  // RLSが適切に設定されていれば、フロントエンド側でvisibilityによる複雑なorフィルタをlikesテーブルに対してかける必要はありません。
  // ポストの公開・非公開はposts側のRLSで制御すべきですが、現状の400エラーを回避するためにor条件を削除または修正します。
  const { data: likesData, error: likesErr } = await supabase
    .from('likes')
    .select(`
      created_at,
      posts!inner (${POST_SELECT_QUERY})
    `)
    .eq('user_id', targetUserId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (likesErr) throw likesErr;
  if (!likesData) return [];

  const { likedIds, repostedIds } = await getViewerReactions(
    userId, likesData.map((row) => row.posts as unknown as ViewerPostRow).filter(Boolean),
  );

  return likesData.map((likeRow: any) => {
    const post = rowToPost(likeRow.posts, likedIds, repostedIds);
    return {
      created_at: likeRow.created_at,
      posts: post
    };
  });
}

/**
 * 投稿検索
 * タイムライン(getFeed)と同様に、自分がメンバーになっている投稿主の
 * メンバー限定投稿も検索結果に含める。
 */
export async function searchPosts(query: string, page: number = 0, limit: number = 10): Promise<PostWithAuthor[]> {
  const userId = await getCurrentUserId();
  
  const from = page * limit;
  const to = from + limit - 1;

  const [{ data: followedByData }, { data: membershipsData }] = await Promise.all([
    supabase.from('follows').select('follower_id').eq('followee_id', userId),
    supabase.from('memberships').select('creator_id').eq('member_id', userId),
  ]);
  const authorsWhoFollowMe = followedByData?.map(f => f.follower_id) || [];

  const creatorsIAmMemberOf = membershipsData?.map(m => m.creator_id) || [];

  const conditions = [
    'visibility.eq.public',
    `user_id.eq.${userId}`
  ];

  if (authorsWhoFollowMe.length > 0) {
    conditions.push(`and(user_id.in.(${authorsWhoFollowMe.join(',')}),visibility.eq.following)`);
  }

  if (creatorsIAmMemberOf.length > 0) {
    conditions.push(`and(user_id.in.(${creatorsIAmMemberOf.join(',')}),visibility.eq.members)`);
  }

  const postsRes = await supabase
      .from('posts')
      .select(POST_SELECT_QUERY)
      .ilike('content', `%${query}%`)
      .or(conditions.join(','))
      .order('created_at', { ascending: false })
      .range(from, to);
  if (postsRes.error) throw postsRes.error;
  const rows = postsRes.data ?? [];
  const { likedIds, repostedIds } = await getViewerReactions(userId, rows);
  return rows.map((row: any) => rowToPost(row, likedIds, repostedIds));
}

export async function getHighlightedPosts(userId: string, page = 0, limit = 10): Promise<PostWithAuthor[]> {
  const viewerId = await getCurrentUserId();
  const { data, error } = await supabase.from('profile_highlights')
    .select(`post_id, posts!inner (${POST_SELECT_QUERY})`)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .order('post_id', { ascending: false })
    .range(page * limit, (page + 1) * limit - 1);
  if (error) throw error;
  const rows = ((data ?? []) as unknown as { posts: ViewerPostRow }[]).map(row => row.posts).filter(Boolean);
  const { likedIds, repostedIds } = await getViewerReactions(viewerId, rows);
  return rows.map(row => rowToPost(row, likedIds, repostedIds));
}

export async function getPostById(id: string): Promise<PostWithAuthor | null> {
  if (isReplyPostId(id)) return getReplyPost(id);
  if (isExternalPostId(id)) return getExternalPost(id);
  const userId = await getCurrentUserId();
  
  const postRes = await supabase.from('posts').select(POST_SELECT_QUERY).eq('id', id).single();

  if (postRes.error || !postRes.data) return null;

  // visibilityが'following'の場合、投稿主があなたをフォローしているかチェックする
  if (postRes.data.visibility === 'following' && postRes.data.user_id !== userId) {
    const { data: authorFollowsMe } = await supabase
      .from('follows')
      .select('*')
      .eq('follower_id', postRes.data.user_id)
      .eq('followee_id', userId)
      .maybeSingle();
    
    if (!authorFollowsMe) return null;
  }

  // visibilityが'members'の場合、あなたが投稿主のメンバーであるかチェックする
  if (postRes.data.visibility === 'members' && postRes.data.user_id !== userId) {
    if (!userId) return null;

    const { data: membershipRow } = await supabase
      .from('memberships')
      .select('id')
      .eq('creator_id', postRes.data.user_id)
      .eq('member_id', userId)
      .maybeSingle();

    if (!membershipRow) return null;
  }

  const { likedIds, repostedIds } = await getViewerReactions(userId, [postRes.data]);
  return rowToPost(postRes.data, likedIds, repostedIds);
}

export async function createPost(input: {
  content: string;
  imageUrls: string[];
  parentId?: string;
  isQuote?: boolean;
  visibility?: 'public' | 'following';
  isBot?: boolean; // 追加
}): Promise<PostWithAuthor> {
  const userId = await getCurrentUserId();
  const newId = crypto.randomUUID();

  const IMAGE_URL_PATTERN = /(https?:\/\/.*\.(?:png|jpg|jpeg|gif|webp|svg|avif)(?:\?.*)?)/gi;
  const detectedUrls = input.content.match(IMAGE_URL_PATTERN) || [];

  const clientSource = getClientName();
  const externalParent = input.parentId && isExternalPostId(input.parentId)
    ? await getExternalPost(input.parentId) : null;
  if (input.parentId && isExternalPostId(input.parentId) && !externalParent) throw new Error('引用元の投稿が見つかりません');
  const replyParent = input.parentId && isReplyPostId(input.parentId) ? await getReplyPost(input.parentId) : null;
  if (input.parentId && isReplyPostId(input.parentId) && !replyParent) throw new Error('引用元の返信を閲覧できません');

  if (!userId) throw new Error('ログインしてください');
  const finalImageUrls = await uploadPostMedia(input.imageUrls, userId, newId, input.visibility === 'following');

  const MENTION_PATTERN = /@(\w+)/g;
  const mentionedUsernames = Array.from(new Set([...input.content.matchAll(MENTION_PATTERN)].map(match => match[1])));

  const { error } = await supabase.from('posts').insert({
    id:          newId,
    user_id:     userId,
    content:     input.content,
    image_urls:  finalImageUrls, 
    client_name: clientSource,
    parent_id:   externalParent || replyParent ? null : input.parentId || null,
    ...(replyParent ? { quoted_reply_id: replyParent.replyId } : {}),
    ...(externalParent ? { quoted_external_post: externalParent } : {}),
    is_quote:    input.isQuote || false,
    visibility:  input.visibility || 'public',
    is_bot:      input.isBot || false // AIフラグをDBに保存
  });

  if (error) throw error;

  if (mentionedUsernames.length > 0) {
    const { data: mentionedUsers } = await supabase
      .from('profiles')
      .select('id, username')
      .in('username', mentionedUsernames);

    if (mentionedUsers && mentionedUsers.length > 0) {
      const mentionInserts = mentionedUsers.map(user => ({
        post_id: newId,
        mentioned_user_id: user.id
      }));
      await supabase.from('mentions').insert(mentionInserts);
    }
  }


  const post = await getPostById(newId);
  if (!post) throw new Error('投稿の取得に失敗しました');
  return post;
}

export async function toggleLike(postId: string): Promise<{ liked: boolean; likesCount: number }> {
  const userId = await getCurrentUserId();
  const { data: existing } = await supabase.from('likes').select('post_id').eq('post_id', postId).eq('user_id', userId).maybeSingle();

  if (existing) {
    await supabase.from('likes').delete().eq('post_id', postId).eq('user_id', userId);
  } else {
    await supabase.from('likes').insert({ post_id: postId, user_id: userId });
  }

  const { count } = await supabase.from('likes').select('*', { count: 'exact', head: true }).eq('post_id', postId);
  const likesCount = count ?? 0;
  await supabase.from('posts').update({ likes_count: likesCount }).eq('id', postId);

  return { liked: !existing, likesCount };
}

export async function toggleRepost(postId: string): Promise<{ reposted: boolean; repostsCount?: number }> {
  if (isReplyPostId(postId)) return toggleReplyRepost(postId);
  if (isExternalPostId(postId)) return toggleExternalRepost(postId);
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("ログインが必要です");

  const { data: existing, error: lookupError } = await supabase
    .from('reposts')
    .select('post_id')
    .eq('post_id', postId)
    .eq('user_id', userId)
    .maybeSingle();

  if (lookupError) throw lookupError;
  const result = existing
    ? await supabase.from('reposts').delete().eq('post_id', postId).eq('user_id', userId)
    : await supabase.from('reposts').insert({ post_id: postId, user_id: userId });
  if (result.error) throw result.error;

  // Persistence succeeded. A failed count refresh must not report this as a
  // failed repost, which would invite a retry that actually undoes it.
  const countResult = await supabase.from('posts').select('reposts_count').eq('id', postId).single();
  return {
    reposted: !existing,
    repostsCount: countResult.error || !countResult.data ? undefined : Number(countResult.data.reposts_count ?? 0),
  };
}

export async function deletePost(postId: string): Promise<void> {
  const userId = await getCurrentUserId();
  const { error } = await supabase.from('posts').delete().eq('id', postId).eq('user_id', userId);
  if (error) throw error;
}

export async function getPostLikers(postId: string): Promise<User[]> {
  const { data, error } = await supabase.from('likes').select(`profiles (*)`).eq('post_id', postId);
  if (error) throw error;
  return (data ?? []).map((row: any) => rowToUser(row.profiles));
}

/** Merge before paging so repost time, rather than original post time, determines order. */
export async function getProfilePosts(userId: string, page = 0, limit = 10): Promise<PostWithAuthor[]> {
  const viewerId = await getCurrentUserId();
  const end = (page + 1) * limit;
  const loadReposts = async () => {
    const visible: any[] = [];
    let offset = 0;
    while (visible.length < end) {
      const result = await supabase.from('reposts').select(`created_at, posts!inner (${POST_SELECT_QUERY})`)
        .eq('user_id', userId).order('created_at', { ascending: false }).order('post_id', { ascending: false }).range(offset, offset + end - 1);
      if (result.error) throw result.error;
      const entries = result.data ?? [];
      const rows = entries.map((entry: any) => ({ ...entry.posts, reposted_at: entry.created_at }));
      visible.push(...await filterVisibleRows(rows, viewerId));
      if (entries.length < end) break;
      offset += end;
    }
    return visible.slice(0, end);
  };
  const [postsResult, repostsResult, externalResult, repliesResult] = await Promise.allSettled([getPostsByUser(userId, 0, end), loadReposts(), getExternalProfileReposts(userId, end), getProfileReplyReposts(userId, end)]);
  if (postsResult.status === 'rejected') throw postsResult.reason;
  const ownPosts = postsResult.value;
  if (repostsResult.status === 'rejected') {
    console.error('Profile reposts could not be loaded:', repostsResult.reason);
  }
  const visibleRows = repostsResult.status === 'fulfilled' ? repostsResult.value : [];
  const { likedIds, repostedIds } = await getViewerReactions(viewerId, visibleRows);
  const shared = visibleRows.map(row => ({ ...rowToPost(row, likedIds, repostedIds),
    profileRepostedAt: row.reposted_at, profileRepostedBy: userId }));
  const externalShares = externalResult.status === 'fulfilled' ? externalResult.value : [];
  const replyShares = repliesResult.status === 'fulfilled' ? repliesResult.value : [];
  if (shared.length === 0 && externalShares.length === 0 && replyShares.length === 0) return ownPosts.slice(page * limit, end);
  return [...ownPosts, ...shared, ...externalShares, ...replyShares].sort((a, b) => {
    const dateA = a.profileRepostedAt ?? a.createdAt;
    const dateB = b.profileRepostedAt ?? b.createdAt;
    return dateB.localeCompare(dateA) || b.id.localeCompare(a.id);
  }).slice(page * limit, end);
}
