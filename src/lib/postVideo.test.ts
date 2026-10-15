import {describe,it,expect} from 'vitest';
import {videoDimensions,validateVideoDuration} from './postVideo';
describe('post video limits',()=>{
 it('preserves landscape/portrait aspect ratio without upscaling',()=>{expect(videoDimensions(3840,2160)).toEqual({width:1920,height:1080});expect(videoDimensions(1920,1080)).toEqual({width:1920,height:1080});expect(videoDimensions(1080,1920)).toEqual({width:1080,height:1920});expect(videoDimensions(640,360)).toEqual({width:640,height:360});expect(videoDimensions(1000,1000)).toEqual({width:1000,height:1000});expect(videoDimensions(1920,800)).toEqual({width:1920,height:800});});
 it('rejects videos over 90 seconds, unknown duration and invalid dimensions',()=>{expect(()=>validateVideoDuration(90)).not.toThrow();for(const value of [90.001,Infinity,NaN,0,-1])expect(()=>validateVideoDuration(value)).toThrow();expect(()=>videoDimensions(0,720)).toThrow();});
});
