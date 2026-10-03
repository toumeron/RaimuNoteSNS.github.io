import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/api/posts', () => ({ toggleRepost: async () => ({ reposted: true, repostsCount: 2 }) }));
import { useToggleRepost } from './useFeed';
afterEach(cleanup);
function Probe() {
  const mutation = useToggleRepost();
  return <button onClick={() => mutation.mutate('original')}>リポストする</button>;
}
it('updates the original inside quoted PostCards in feeds, details, and profiles', async () => {
  const client = new QueryClient();
  const quote = { id: 'quote', parentPost: { id: 'original', repostedByMe: false, repostsCount: 1 } };
  client.setQueryData(['feed', 'all'], { pages: [[quote]], pageParams: [0] });
  client.setQueryData(['post', 'quote'], quote);
  client.setQueryData(['posts', 'user', 'author'], { pages: [[quote]], pageParams: [0] });
  render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>);
  fireEvent.click(screen.getByText('リポストする'));
  await waitFor(() => expect(client.getQueryData(['post', 'quote'])).toMatchObject({
    parentPost: { repostedByMe: true, repostsCount: 2 },
  }));
  expect(client.getQueryData(['feed', 'all'])).toMatchObject({ pages: [[{ parentPost: { repostedByMe: true, repostsCount: 2 } }]] });
  expect(client.getQueryData(['posts', 'user', 'author'])).toMatchObject({ pages: [[{ parentPost: { repostedByMe: true, repostsCount: 2 } }]] });
});
