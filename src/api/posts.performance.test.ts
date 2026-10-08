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
import { getFeed, getFollowingFeed, getPostsByUser, getLikedPostsByUser, searchPosts, getProfilePosts, getPostById, getHighlightedPosts } from './posts';

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
     id: 'author', username: 'author', displayName: 'Author', bio: 'bio', location: '',
     avatarUrl: 'avatar', coverUrl: 'cover', createdAt: 'now', isOfficial: true,
     emojiEffect: 'effect', bot_enabled: true, bot_prompt: undefined,
   });
   const call = db.calls.find(c => c.table === 'profiles');
   expect(call?.select).not.toBe('*');
   expect(call?.select).not.toContain('timeline_background_url');
   expect(call?.select).not.toContain('bot_prompt');
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

describe('reposts and quoted originals', () => {
  it('normalizes quoted parent fields into the same model as regular posts', async () => {
    db.rows.posts = [{ ...post('quote'), parent_post: {
      ...post('original'), created_at: '2026-09-30T00:00:00Z',
      image_urls: ['https://example.com/original.png'], reposts_count: 3,
    } }];
    const [quote] = await getFeed();
    expect(quote.parentPost).toMatchObject({
      id: 'original', userId: 'author', createdAt: '2026-09-30T00:00:00Z',
      imageUrls: ['https://example.com/original.png'], repostsCount: 3,
    });
  });

  it('does not expose a restricted quoted original to an unauthorized viewer', async () => {
    db.rows.follows = [];
    db.rows.memberships = [];
    db.rows.posts = [{ ...post('quote'), parent_post: { ...post('private'), visibility: 'following' } }];
    const [quote] = await getFeed();
    expect(quote.parentPost).toBeNull();
  });
});


describe('profile repost timeline', () => {
  it('merges before paging and orders by the time of reposting', async () => {
    db.rows.posts = [post('own')];
    db.rows.reposts = [{ user_id: 'author', post_id: 'original', created_at: '2026-10-03T00:00:00Z', posts: post('original') }];
    const first = await getProfilePosts('author', 0, 1);
    const second = await getProfilePosts('author', 1, 1);
    expect(first.map(row => row.id)).toEqual(['original']);
    expect(first[0].profileRepostedAt).toBe('2026-10-03T00:00:00Z');
    expect(second.map(row => row.id)).toEqual(['own']);
  });

  it('continues past inaccessible reposts so they do not end pagination early', async () => {
    db.rows.posts = [];
    db.rows.follows = [];
    db.rows.memberships = [];
    db.rows.reposts = [
      { user_id: 'author', post_id: 'private', created_at: '2026-10-03T01:00:00Z', posts: { ...post('private'), visibility: 'members' } },
      { user_id: 'author', post_id: 'public', created_at: '2026-10-03T00:00:00Z', posts: post('public') },
    ];
    expect((await getProfilePosts('author', 0, 1)).map(row => row.id)).toEqual(['public']);
  });

  it('does not add repost records to the home feed', async () => {
    db.rows.posts = [post('own')];
    db.rows.reposts = [{ user_id: 'author', post_id: 'original', created_at: '2026-10-03T00:00:00Z', posts: post('original') }];
    expect((await getFeed()).map(row => row.id)).toEqual(['own']);
  });
});


describe('profile repost error isolation', () => {
  it('keeps regular posts when the repost table cannot be read', async () => {
    db.rows.posts = [post('own')];
    db.errors.reposts = new Error('PGRST205: table missing');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await getProfilePosts('author')).map(row => row.id)).toEqual(['own']);
    log.mockRestore();
  });
  it('keeps regular post pagination when repost retrieval fails', async () => {
    db.rows.posts = [post('first'), post('second')];
    db.errors.reposts = new Error('permission denied');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await getProfilePosts('author', 1, 1)).map(row => row.id)).toEqual(['second']);
    log.mockRestore();
  });
});


describe('restricted post follow direction', () => {
  it('allows the viewer followed by the author even without a reverse follow', async () => {
    db.rows.posts = [{ ...post('restricted'), visibility: 'following' }];
    db.rows.follows = [{ follower_id: 'author', followee_id: 'viewer' }];
    expect((await getPostById('restricted'))?.id).toBe('restricted');
  });
  it('denies a viewer who only follows the author', async () => {
    db.rows.posts = [{ ...post('restricted'), visibility: 'following' }];
    db.rows.follows = [{ follower_id: 'viewer', followee_id: 'author' }];
    expect(await getPostById('restricted')).toBeNull();
  });
  it('hides a quoted original from a viewer who only follows the author', async () => {
    db.rows.posts = [{ ...post('quote'), parent_post: { ...post('restricted'), visibility: 'following' } }];
    db.rows.follows = [{ follower_id: 'viewer', followee_id: 'author' }];
    expect((await getFeed())[0].parentPost).toBeNull();
  });
});

describe('profile highlights feed', () => {
  it('preserves post cards, quoted parents and viewer reactions with a bounded batch', async () => {
    db.rows.profile_highlights = [
      { user_id: 'author', posts: post('one', 'quoted') },
      { user_id: 'author', posts: post('two') },
    ];
    const rows = await getHighlightedPosts('author');
    expect(rows.map(row => row.id)).toEqual(['one', 'two']);
    expect(rows[0].likedByMe).toBe(true);
    expect(rows[0].parentPost?.likedByMe).toBe(true);
    expect(rows[1].repostedByMe).toBe(true);
    expect(db.calls.find(call => call.table === 'profile_highlights')?.select).toContain('posts!inner');
    expect(db.calls.filter(call => call.table === 'posts')).toHaveLength(0);
  });
  it('pages highlighted records and skips reactions for an empty page', async () => {
    db.rows.profile_highlights = [{ user_id: 'author', posts: post('one') }];
    expect(await getHighlightedPosts('author', 1, 10)).toEqual([]);
    expect(db.calls.find(call => call.table === 'profile_highlights')?.filters).toEqual({ user_id: 'author', range: [10, 19] });
    expect(db.calls.some(call => ['likes', 'reposts'].includes(call.table))).toBe(false);
  });
  it('propagates feed errors instead of treating them as an empty profile', async () => {
    db.errors.profile_highlights = new Error('unavailable');
    await expect(getHighlightedPosts('author')).rejects.toThrow('unavailable');
  });
});
