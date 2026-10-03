import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type { PostWithAuthor } from '@/types';

vi.mock('@/lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient('https://test.invalid', 'fixture-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  // Exercise the real SDK's channel registry and subscribe/on guards offline.
  vi.spyOn(client.realtime, 'connect').mockImplementation(() => {});
  vi.spyOn(client, 'from').mockImplementation(() => {
    const builder = {
      select: () => builder, eq: () => builder, in: () => builder,
      order: () => builder, limit: () => builder, maybeSingle: () => builder,
      single: () => builder, match: () => builder,
      then: (resolve: (value: unknown) => void) => Promise.resolve({ data: [], count: 0, error: null }).then(resolve),
    };
    return builder as never;
  });
  return { supabase: client };
});
vi.mock('@/lib/currentUser', () => ({ getCurrentUserId: async () => 'viewer' }));
vi.mock('@/hooks/useBlueskySession', () => ({ useBlueskySession: () => null }));
vi.mock('./RepostButton', () => ({ RepostButton: () => <button>リポスト</button> }));
import { PostCard } from './PostCard';
import { supabase } from '@/lib/supabase';

afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); });
it('can mount the same original separately and inside multiple quotes with the real Realtime SDK', async () => {
  vi.useFakeTimers();
  const original = {
    id: 'original', userId: 'author', content: 'Original', imageUrls: [], createdAt: '2026-10-03T00:00:00Z',
    likesCount: 0, commentsCount: 0, repostsCount: 0, likedByMe: false, repostedByMe: false,
    author: { id: 'author', username: 'author', displayName: 'Author', avatarUrl: '' },
  } as PostWithAuthor;
  const quote = { ...original, id: 'quote', content: 'Quote', isQuote: true, parentId: 'original', parentPost: original };
  const view = render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
    <PostCard post={original} /><PostCard post={quote} /><PostCard post={{ ...quote, id: 'quote-two' }} />
  </MemoryRouter></QueryClientProvider>);
  expect(view.container.querySelectorAll('[data-lime-post-card]')).toHaveLength(5);
  const reactionChannels = supabase.getChannels().filter(channel => channel.topic.startsWith('realtime:post-reactions-original-'));
  expect(reactionChannels).toHaveLength(3);
  expect(new Set(reactionChannels.map(channel => channel.topic)).size).toBe(3);
});
