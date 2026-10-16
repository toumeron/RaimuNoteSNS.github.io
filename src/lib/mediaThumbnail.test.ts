import {it,expect} from 'vitest';
import {mediaThumbnailUrl} from './mediaThumbnail';
it('uses CDN grid thumbnails without changing attachment URLs elsewhere',()=>{
 expect(mediaThumbnailUrl('https://pbs.twimg.com/media/id?format=jpg&name=orig')).toBe('https://pbs.twimg.com/media/id?format=jpg&name=small');
 expect(mediaThumbnailUrl('https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:actor/cid@jpeg')).toContain('/img/feed_thumbnail/');
 for(const src of ['lime-private-media:token','blob:local','https://other.test/img/feed_fullsize/private.jpg','https://pbs.twimg.com/profile_images/avatar.jpg'])expect(mediaThumbnailUrl(src)).toBe(src);
});
