import {expect,it} from 'vitest';
import type {PostWithAuthor} from '@/types';
import {videoSelections,videoSwipeDirection} from './videoSequence';
const video={duration:16,width:1920,height:1080};
it('preserves the selected video first and removes duplicate and non-video posts across pages',()=>{
 const post=(id:string,hasVideo=true)=>({id,video:hasVideo?video:null}) as PostWithAuthor;
 const items=videoSelections({url:'video:a',video:{postId:'a',video}},[{posts:[post('a'),post('b'),post('image',false)]},{posts:[post('b'),post('c')]}]);
 expect(items.map(item=>item.video?.postId)).toEqual(['a','b','c']);
});
it('advances with either vertical swipe and rejects taps and horizontal/diagonal gestures',()=>{
 expect(videoSwipeDirection(5,100)).toBe(1);expect(videoSwipeDirection(5,-100)).toBe(1);
 for(const [x,y] of [[1,20],[110,90],[100,5]])expect(videoSwipeDirection(x,y)).toBe(0);
});

it('keeps twitter video sources in the sequence without requiring native storage metadata',()=>{
 const externalVideo={playlist:'https://video.example/tweet.m3u8',format:'hls' as const,...video};const post={id:'x:123',externalVideo} as PostWithAuthor;
 const items=videoSelections({url:'video:a',video:{postId:'a',video}},[{posts:[post,post]}]);expect(items).toHaveLength(2);expect(items[1].video?.externalVideo).toEqual(externalVideo);
});

it('places late twitter videos before unwatched native slides while preserving the active slide',async()=>{
 const {mergeVideoQueue}=await import('./videoSequence');
 const item=(id:string)=>({url:'video:'+id,video:{postId:id,video}});
 const first=item('first'),native=item('native'),twitter=item('x:late');
 expect(mergeVideoQueue([first,native],first,[first,twitter,native]).map(item=>item.video?.postId)).toEqual(['first','x:late','native']);
 expect(mergeVideoQueue([first,native],native,[first,twitter,native]).map(item=>item.video?.postId)).toEqual(['first','native','x:late']);
});
