import {expect,it} from 'vitest';
import type {PostWithAuthor} from '@/types';
import {videoSelections,videoSwipeDirection} from './videoSequence';
const video={duration:16,width:1920,height:1080};
it('preserves the selected video first and removes duplicate and non-video posts across pages',()=>{
 const post=(id:string,hasVideo=true)=>({id,video:hasVideo?video:null}) as PostWithAuthor;
 const items=videoSelections({url:'video:a',video:{postId:'a',video}},[{posts:[post('a'),post('b'),post('image',false)]},{posts:[post('b'),post('c')]}]);
 expect(items.map(item=>item.video?.postId)).toEqual(['a','b','c']);
});
it('advances downward, goes back upward, and rejects taps and horizontal/diagonal gestures',()=>{
 expect(videoSwipeDirection(5,100)).toBe(1);expect(videoSwipeDirection(5,-100)).toBe(-1);
 for(const [x,y] of [[1,20],[110,90],[100,5]])expect(videoSwipeDirection(x,y)).toBe(0);
});
