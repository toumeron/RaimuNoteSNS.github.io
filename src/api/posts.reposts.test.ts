import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ existing: false, lookupError: false, writeError: false, countError: false, writes: [] as string[] }));
vi.mock('@/lib/currentUser', () => ({ getCurrentUserId: async () => 'viewer' }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    let action = 'select';
    let counting = false;
    const builder = {
      select: (_columns: string, options?: { count?: string }) => { counting = !!options?.count; return builder; },
      eq: () => builder, maybeSingle: () => builder, single: () => builder,
      insert: () => { action = 'insert'; return builder; },
      delete: () => { action = 'delete'; return builder; },
      update: () => { action = 'update'; return builder; },
      then: (resolve: (result: unknown) => void) => {
        if (action !== 'select') db.writes.push(`${table}:${action}`);
        return Promise.resolve({
          data: table === 'posts' ? { reposts_count: 3 } : action === 'select' && !counting && db.existing ? { post_id: 'original' } : null,
          count: counting ? (table === 'reposts' ? 2 : 1) : null,
          error: table === 'posts' && db.countError ? new Error('count failed') : action === 'select' && !counting && db.lookupError ? new Error('lookup failed')
            : action !== 'select' && db.writeError ? new Error('write failed') : null,
        }).then(resolve);
      },
    };
    return builder;
  },
} }));
import { toggleRepost } from './posts';
beforeEach(() => { db.existing = false; db.lookupError = false; db.writeError = false; db.countError = false; db.writes = []; });
describe('repost persistence', () => {
  it('creates a repost record and includes quotes in the displayed count', async () => {
    expect(await toggleRepost('original')).toEqual({ reposted: true, repostsCount: 3 });
    expect(db.writes).toEqual(['reposts:insert']);
  });
  it('removes an existing repost without creating a new feed post', async () => {
    db.existing = true;
    expect((await toggleRepost('original')).reposted).toBe(false);
    expect(db.writes).toEqual(['reposts:delete']);
  });
  it('does not report a saved repost as failed when only count refresh fails', async () => {
    db.countError = true;
    expect(await toggleRepost('original')).toEqual({ reposted: true, repostsCount: undefined });
    expect(db.writes).toEqual(['reposts:insert']);
  });
  it('does not write after a failed state lookup', async () => {
    db.lookupError = true;
    await expect(toggleRepost('original')).rejects.toThrow('lookup failed');
    expect(db.writes).toEqual([]);
  });
  it('reports a failed write instead of claiming a repost succeeded', async () => {
    db.writeError = true;
    await expect(toggleRepost('original')).rejects.toThrow('write failed');
    expect(db.writes).toEqual(['reposts:insert']);
  });
});
