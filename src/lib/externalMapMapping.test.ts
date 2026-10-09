import { expect, it } from 'vitest';
import { mapBlueskyFeedItemToPost } from './bluesky';
import { mapMisskeyNote } from './misskey';
it('retains a Bluesky destination hidden behind rich text facets', () => {
  const post = mapBlueskyFeedItemToPost({ post: {
    uri: 'at://did:plc:test/app.bsky.feed.post/location', author: { did: 'did:plc:test', handle: 'map.bsky.social' },
    record: { text: '地図', facets: [{ index: { byteStart: 0, byteEnd: 6 }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://maps.apple.com/?ll=35,139' }] }] },
  } });
  expect(post?.mapLocation).toEqual({ latitude: 35, longitude: 139 });
});
it('uses a Misskey note destination and never a private note or quoted location', () => {
  const note = { id: 'test', text: 'geo:35,139', createdAt: '2026-10-09T00:00:00Z', visibility: 'public', user: { id: 'author', username: 'author' } };
  expect(mapMisskeyNote(note)?.mapLocation).toEqual({ latitude: 35, longitude: 139 });
  expect(mapMisskeyNote({ ...note, visibility: 'followers' })).toBeNull();
  expect(mapMisskeyNote({ ...note, text: '引用へのコメント', renote: note })?.mapLocation).toBeNull();
});
