import { expect, it, vi } from 'vitest';
import { createDevFunctionFetch } from './devFunctionFetch';

const db = 'https://example.supabase.co';
const proxy = 'http://192.168.11.51:8080/RaimuNoteSNS.github.io/__lime-link-preview';
it('routes preview/Misskey requests through the local server, retaining authentication and body', async () => {
  const transport = vi.fn().mockResolvedValue(Response.json({ preview: null }));
  const options = { method: 'POST', headers: { authorization: 'Bearer viewer', apikey: 'public' }, body: '{"mode":"misskey"}' };
  await createDevFunctionFetch(db, proxy, transport)(db + '/functions/v1/link-preview', options);
  expect(transport).toHaveBeenCalledWith(proxy, options);
});
it('preserves Request inputs and query strings', async () => {
  const transport = vi.fn().mockResolvedValue(new Response('ok'));
  const input = new Request(db + '/functions/v1/link-preview?test=1', { method: 'POST', headers: { authorization: 'Bearer viewer' }, body: 'payload' });
  await createDevFunctionFetch(db, proxy, transport)(input);
  const request = transport.mock.calls[0][0] as Request;
  expect(request.url).toBe(proxy + '?test=1');
  expect(request.headers.get('authorization')).toBe('Bearer viewer');
  expect(await request.text()).toBe('payload');
});
it('does not proxy storage, database, other functions or other hosts', async () => {
  const transport = vi.fn().mockResolvedValue(new Response('ok'));
  const fetcher = createDevFunctionFetch(db, proxy, transport);
  for (const url of [db + '/rest/v1/posts', db + '/storage/v1/object/file', db + '/functions/v1/chat', 'https://other.example/functions/v1/link-preview']) {
    await fetcher(url);
    expect(transport).toHaveBeenLastCalledWith(url, undefined);
  }
});
