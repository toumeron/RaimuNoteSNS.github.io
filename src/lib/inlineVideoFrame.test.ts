import {expect,it} from 'vitest';
import {inlineVideoFrame} from './inlineVideoFrame';
it('limits portrait heights separately on desktop, mobile and quoted posts',()=>{
 expect(inlineVideoFrame(1080,1920,false).width).toBe('270px');
 expect(inlineVideoFrame(1080,1920,true).width).toBe('168px');
 expect(inlineVideoFrame(1080,1920,false,true).width).toBe('67px');
});
it('does not enlarge small files or mistake aspect-only metadata for tiny files',()=>{
 expect(inlineVideoFrame(240,160,false).width).toBe('240px');
 expect(inlineVideoFrame(16,9,false).width).toBe('853px');
 expect(inlineVideoFrame(0,0,true).width).toBe('533px');
});
