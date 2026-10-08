import { beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ data: null as unknown, error: null as Error | null, calls: [] as unknown[][] }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    fixture.calls.push(['from', table]);
    const builder = {
      select: (columns: string) => { fixture.calls.push(['select', columns]); return builder; },
      eq: (column: string, value: string) => { fixture.calls.push(['eq', column, value]); return builder; },
      maybeSingle: () => builder,
      upsert: (value: unknown, options: unknown) => { fixture.calls.push(['upsert', value, options]); return builder; },
      delete: () => { fixture.calls.push(['delete']); return builder; },
      then: (resolve: (value: unknown) => void) => Promise.resolve({ data: fixture.data, error: fixture.error }).then(resolve),
    };
    return builder;
  },
} }));
import { isPostHighlighted, setPostHighlighted } from './profile-highlights';
beforeEach(() => { fixture.data = null; fixture.error = null; fixture.calls = []; });
it('checks membership for the given owner and post', async () => {
  expect(await isPostHighlighted('owner', 'post')).toBe(false);
  fixture.data = { post_id: 'post' };
  expect(await isPostHighlighted('owner', 'post')).toBe(true);
  expect(fixture.calls).toContainEqual(['eq', 'user_id', 'owner']);
  expect(fixture.calls).toContainEqual(['eq', 'post_id', 'post']);
});
it('adds idempotently without replacing the original highlight timestamp', async () => {
  await setPostHighlighted('owner', 'post', true);
  expect(fixture.calls).toContainEqual(['upsert', { user_id: 'owner', post_id: 'post' }, { onConflict: 'user_id,post_id', ignoreDuplicates: true }]);
});
it('removes only the selected post for the owner', async () => {
  await setPostHighlighted('owner', 'post', false);
  expect(fixture.calls).toContainEqual(['delete']);
  expect(fixture.calls).toContainEqual(['eq', 'user_id', 'owner']);
  expect(fixture.calls).toContainEqual(['eq', 'post_id', 'post']);
});
it('propagates lookup and write failures instead of reporting success', async () => {
  fixture.error = new Error('denied');
  await expect(isPostHighlighted('owner', 'post')).rejects.toThrow('denied');
  await expect(setPostHighlighted('owner', 'post', true)).rejects.toThrow('denied');
  await expect(setPostHighlighted('owner', 'post', false)).rejects.toThrow('denied');
});
