import {afterEach,expect,it,vi} from 'vitest';
const invoke=vi.hoisted(()=>vi.fn());
vi.mock('./supabase',()=>({supabase:{functions:{invoke}}}));
import {prepareRecommendationImage,recommendationThumbnailUrl} from './recommendationImageInput';
const image='https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:creator/bafkreipicture@jpeg';
afterEach(()=>{vi.restoreAllMocks();invoke.mockReset();});
it('uses small public thumbnails without changing the identity of the image',()=>{
 expect(recommendationThumbnailUrl(image)).toBe(image.replace('feed_fullsize','feed_thumbnail'));
 expect(recommendationThumbnailUrl('https://pbs.twimg.com/media/picture.jpg?name=orig')).toBe('https://pbs.twimg.com/media/picture.jpg?name=small');
 expect(recommendationThumbnailUrl('https://cdn.bsky.app.evil.example/img/feed_fullsize/plain/a/b')).toBeNull();
});
it('sends Bluesky images to the public PDS reader without consuming preview quota',async()=>{
 const result=await prepareRecommendationImage(image);
 expect(result.url).toBe(image.replace('feed_fullsize','feed_thumbnail'));expect(invoke).not.toHaveBeenCalled();result.release();
});
it('does not send twitter images through the thumbnail relay',async()=>{
 expect((await prepareRecommendationImage('https://pbs.twimg.com/media/picture.jpg?name=orig')).url).toContain('name=small');expect(invoke).not.toHaveBeenCalled();
});
