import {cleanup,fireEvent,render} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {CommunityAudienceImage,communityAudienceSources} from './CommunityAudienceImage';
afterEach(cleanup);
it('provides 1x to 4x square images at high quality from the original upload',()=>{
 const original='https://res.cloudinary.com/lime/image/upload/w_24,q_10/v123/communities/owner/cover.png';
 const sources=communityAudienceSources(original);
 expect(sources.src).toContain('w_108,h_108');
 expect(sources.src).toContain('/q_95/f_auto/v123/communities/owner/cover.png');
 expect(sources.src).not.toContain('w_24');
 expect(sources.srcSet).toContain('w_144,h_144/q_95/f_auto/v123/communities/owner/cover.png 4x');
});
it('retains the original URL if a CDN transformation cannot be delivered',()=>{
 const src='https://res.cloudinary.com/lime/image/upload/v123/cover.jpg';
 const {container}=render(<CommunityAudienceImage src={src}/>);const image=container.querySelector('img')!;
 expect(image).toHaveAttribute('srcset');fireEvent.error(image);expect(image).toHaveAttribute('src',src);expect(image).not.toHaveAttribute('srcset');
});
it.each(['https://example.com/cover.png','https://res.cloudinary.com/lime/image/upload/s--signature--/v123/cover.png'])('does not rewrite unsupported or signed delivery %s',src=>{
 expect(communityAudienceSources(src)).toEqual({src});
});
