import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>,
  calls: [] as { table: string; filters: Record<string, unknown>; select: string }[],
  errors: {} as Record<string, Error>,
}));
vi.mock('@/lib/currentUser', () => ({ getCurrentUserId: async () => 'viewer' }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const call = { table, filters: {} as Record<string, unknown>, select: '' };
      const builder = {
        select: (columns: string) => { call.select = columns; return builder; },
        eq: (column: string, value: unknown) => { call.filters[column] = value; return builder; },
        in: (column: string, values: unknown[]) => { call.filters[column] = values; return builder; },
        or: (value: string) => { call.filters.or = value; return builder; },
        ilike: () => builder,
        order: () => builder,
        range: (from: number, to: number) => { call.filters.range = [from, to]; return builder; },
        maybeSingle: () => { call.filters.single = true; return builder; },
        single: () => { call.filters.single = true; return builder; },
        then: (resolve: (value: unknown) => void) => {
          db.calls.push(call);
          let rows = (db.rows[table] ?? []).filter(row => Object.entries(call.filters).every(([key, value]) => {
            if (['or', 'range', 'single'].includes(key)) return true;
            return Array.isArray(value) ? value.includes(row[key]) : row[key] === value;
          }));
          if (Array.isArray(call.filters.range)) rows = rows.slice(Number(call.filters.range[0]), Number(call.filters.range[1]) + 1);
          return Promise.resolve({ data: db.errors[table] ? null : call.filters.single ? rows[0] ?? null : rows, error: db.errors[table] ?? null }).then(resolve);
        },
      };
      return builder;
    },
  },
}));

import { getUserByUsername } from './users';
import { getFeed, getFollowingFeed, getPostsByUser, getLikedPostsByUser, searchPosts } from './posts';

const post = (id: string, parent?: string) => ({
  id, user_id: 'author', content: 'post', image_urls: ['https://example.com/image.png'],
  created_at: '2026-10-02T00:00:00Z', visibility: 'public',
  profiles: { id: 'author', username: 'author', display_name: 'Author', avatar_url: 'avatar' },
  parent_post: parent ? { id: parent, content: 'quote', profiles: { id: 'parent-author' } } : null,
});

beforeEach(() => {
  db.calls.length = 0;
  db.errors = {};
  db.rows = {
    posts: [post('one', 'quoted'), post('two')],
    follows: [{ follower_id: 'viewer', followee_id: 'author' }, { follower_id: 'author', followee_id: 'viewer' }],
    memberships: [{ id: 'membership', creator_id: 'author', member_id: 'viewer' }],
    likes: [
      ...Array.from({ length: 10000 }, (_, i) => ({ user_id: 'viewer', post_id: `old-${i}` })),
      { user_id: 'viewer', post_id: 'one' }, { user_id: 'viewer', post_id: 'quoted' },
    ],
    reposts: [{ user_id: 'viewer', post_id: 'two' }],
  };
});

describe('bounded fresh post viewer state', () => {
  it.each([
    ['feed', () => getFeed()],
    ['following', () => getFollowingFeed()],
    ['profile posts', () => getPostsByUser('author')],
    ['search', () => searchPosts('post')],
  ])('%s only requests this page and quoted parent IDs', async (_, load) => {
    const rows = await load();
    expect(rows).toHaveLength(2);
    expect(rows[0].likedByMe).toBe(true);
    expect(rows[0].parentPost?.likedByMe).toBe(true);
    expect(rows[1].repostedByMe).toBe(true);
    expect(rows[0].imageUrls).toEqual(['https://example.com/image.png']);
    for (const call of db.calls.filter(c => ['likes', 'reposts'].includes(c.table))) {
      expect(call.filters.user_id).toBe('viewer');
      expect(call.filters.post_id).toEqual(['one', 'quoted', 'two']);
    }
    expect(db.calls.find(c => c.table === 'posts')?.select).not.toContain('profiles:user_id (*)');
  });

  it('does not fetch reaction history for an empty page', async () => {
    db.rows.posts = [];
    expect(await getFeed()).toEqual([]);
    expect(db.calls.some(c => ['likes', 'reposts'].includes(c.table))).toBe(false);
  });

  it('reads updated state again without extending freshness or caching it', async () => {
    expect((await getFeed())[0].likedByMe).toBe(true);
    db.rows.likes = [];
    expect((await getFeed())[0].likedByMe).toBe(false);
  });

  it('retains following and membership visibility filters', async () => {
    await getFeed();
    expect(db.calls.find(c => c.table === 'posts')?.filters.or).toBe(
      'visibility.eq.public,user_id.eq.viewer,and(user_id.in.(author),visibility.eq.following),and(user_id.in.(author),visibility.eq.members)',
    );
    db.calls.length = 0;
    await getPostsByUser('author');
    expect(db.calls.find(c => c.table === 'posts')?.filters.visibility).toEqual(['public', 'following', 'members']);
  });

  it('uses scoped viewer state for liked post lists too', async () => {
    db.rows.likes.push({ user_id: 'author', created_at: 'now', posts: post('one', 'quoted') });
    const rows = await getLikedPostsByUser('author');
    expect(rows[0].posts.likedByMe).toBe(true);
    expect(db.calls.filter(c => c.table === 'likes' && c.filters.user_id === 'viewer')[0].filters.post_id).toEqual(['one', 'quoted']);
    expect(db.calls.some(c => c.table === 'follows')).toBe(false);
  });

  it.each([
    ['latest', () => getFeed()],
    ['following', () => getFollowingFeed()],
    ['profile posts', () => getPostsByUser('author')],
    ['search', () => searchPosts('post')],
  ])('%s keeps posts and likes when the reposts table is missing', async (_, load) => {
    db.errors.reposts = new Error('PGRST205: public.reposts is missing');
    const rows = await load();
    expect(rows.map(row => row.id)).toEqual(['one', 'two']);
    expect(rows[0].likedByMe).toBe(true);
    expect(rows[0].parentPost?.likedByMe).toBe(true);
    expect(rows[1].repostedByMe).toBe(false);
  });

  it('retains posts and successful repost flags if likes cannot be loaded', async () => {
    db.errors.likes = new Error('offline');
    const rows = await getFeed();
    expect(rows).toHaveLength(2);
    expect(rows[0].likedByMe).toBe(false);
    expect(rows[1].repostedByMe).toBe(true);
  });

  it('still rejects an actual posts request failure', async () => {
    db.errors.posts = new Error('posts failed');
    await expect(getFeed()).rejects.toThrow('posts failed');
  });
});

 it('loads profile display fields without unrelated large settings', async () => {
   db.rows.profiles = [{
     id: 'author', username: 'author', display_name: 'Author', bio: 'bio',
     avatar_url: 'avatar', cover_url: 'cover', created_at: 'now', is_official: true,
     emoji_effect: 'effect', bot_enabled: true, bot_prompt: 'prompt',
     timeline_background_url: 'large-unused-background',
   }];
   expect(await getUserByUsername('author')).toEqual({
     id: 'author', username: 'author', displayName: 'Author', bio: 'bio',
     avatarUrl: 'avatar', coverUrl: 'cover', createdAt: 'now', isOfficial: true,
     emojiEffect: 'effect', bot_enabled: true, bot_prompt: 'prompt',
   });
   const call = db.calls.find(c => c.table === 'profiles');
   expect(call?.select).not.toBe('*');
   expect(call?.select).not.toContain('timeline_background_url');
 });

 it.each([getFeed, getFollowingFeed])('retains visibility checks while paging from a timestamp/ID boundary', async load => {
   const before = { createdAt: '2026-10-02T00:00:00Z', id: 'one' };
   await load(3, 10, before);
   const call = db.calls.find(c => c.table === 'posts');
   expect(call?.filters.range).toEqual([0, 9]);
   expect(String(call?.filters.or)).toContain('and(or(');
   expect(String(call?.filters.or)).toContain('visibility.eq.public');
   expect(String(call?.filters.or)).toContain('visibility.eq.following');
   expect(String(call?.filters.or)).toContain('visibility.eq.members');
   expect(String(call?.filters.or)).toContain('created_at.lt.2026-10-02T00:00:00Z');
   expect(String(call?.filters.or)).toContain('id.lt.one');
 });
