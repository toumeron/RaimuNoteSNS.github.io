import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ toggleRepost: vi.fn() }));
vi.mock('@/api/posts', () => ({ toggleRepost: mock.toggleRepost }));
import { useToggleRepost } from './useFeed';
beforeEach(() => mock.toggleRepost.mockReset().mockResolvedValue({ reposted: true, repostsCount: 2 }));
afterEach(cleanup);
function Probe() {
  const mutation = useToggleRepost();
  return <><button onClick={() => mutation.mutate('original')}>リポストする</button><span data-testid="mutation-status">{mutation.status}</span></>;
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
it('keeps reposting after differently shaped caches appear later without changing cursors or unrelated data', async () => {
  const client = new QueryClient();
  const post = { id: 'original', repostedByMe: false, repostsCount: 1 };
  client.setQueryData(['post', 'original'], post);
  mock.toggleRepost.mockResolvedValueOnce({reposted:true,repostsCount:2}).mockResolvedValueOnce({reposted:false,repostsCount:1});
  render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>);
  fireEvent.click(screen.getByText('リポストする'));
  await waitFor(() => expect(screen.getByTestId('mutation-status')).toHaveTextContent('success'));
  const metadata = { updatedAt: 'later' };
  const cursor = { posts: [{...post,repostedByMe:true,repostsCount:2}] };
  const current = {...post,repostedByMe:true,repostsCount:2};
  client.setQueryData(['feed', 'metadata'], metadata);
  const profileMetadata = { postCount: 5 };
  client.setQueryData(['posts', 'user', 'previous-author'], profileMetadata);
  // Profile activity totals share this prefix but are scalar numbers.
  client.setQueryData(['posts','user','author','activity-count','viewer'],5);
  client.setQueryData(['feed', 'legacy'], {pages:[{items:[current]},null,{posts:null},42],pageParams:[cursor]});
  client.setQueryData(['feed', 'recommended'], {pages:[{posts:[current],next:cursor}],pageParams:[cursor]});
  client.setQueryData(['posts', 'user', 'author'], [current]);
  fireEvent.click(screen.getByText('リポストする'));
  await waitFor(() => expect(mock.toggleRepost).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(client.getQueryData(['post','original'])).toMatchObject({repostedByMe:false,repostsCount:1}));
  await waitFor(() => expect(screen.getByTestId('mutation-status')).toHaveTextContent('success'));
  expect(client.getQueryData(['feed','recommended'])).toMatchObject({pages:[{posts:[{repostedByMe:false,repostsCount:1}],next:cursor}],pageParams:[cursor]});
  expect(client.getQueryData(['posts','user','author'])).toMatchObject([{repostedByMe:false,repostsCount:1}]);
  expect(client.getQueryData(['feed','metadata'])).toBe(metadata);
  expect(client.getQueryData(['posts','user','previous-author'])).toBe(profileMetadata);
  expect(client.getQueryData(['posts','user','author','activity-count','viewer'])).toBe(5);
  expect(client.getQueryData(['feed','legacy'])).toMatchObject({pages:[{items:[current]},null,{posts:null},42],pageParams:[cursor]});
});
it('rolls back a failed repost even with incomplete cached pages and permits another attempt', async () => {
  const client = new QueryClient();
  client.setQueryData(['post','original'],{id:'original',repostedByMe:false,repostsCount:1});
  client.setQueryData(['feed','incomplete'],{pages:[{}]});
  mock.toggleRepost.mockRejectedValueOnce(new Error('write failed'));
  render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>);
  fireEvent.click(screen.getByText('リポストする'));
  await waitFor(()=>expect(screen.getByTestId('mutation-status')).toHaveTextContent('error'));
  expect(client.getQueryData(['post','original'])).toMatchObject({repostedByMe:false,repostsCount:1});
  fireEvent.click(screen.getByText('リポストする'));
  await waitFor(()=>expect(screen.getByTestId('mutation-status')).toHaveTextContent('success'));
  expect(mock.toggleRepost).toHaveBeenCalledTimes(2);
});
