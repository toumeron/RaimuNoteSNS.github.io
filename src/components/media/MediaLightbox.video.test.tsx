import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {PostWithAuthor} from '@/types';
const mocks=vi.hoisted(()=>({feed:vi.fn(),post:vi.fn()}));
vi.mock('@/api/posts',()=>({getVideoFeed:(...args:unknown[])=>mocks.feed(...args),getPostById:(...args:unknown[])=>mocks.post(...args)}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'viewer'}})}));
vi.mock('@/hooks/useFeed',()=>({postKey:(id:string)=>['post',id]}));
vi.mock('@/components/feed/PostCard',()=>({PostCard:({post,mediaPresentation}:{post:PostWithAuthor;mediaPresentation:string})=><div data-testid={`post-${mediaPresentation}`}>{post.id}:{post.likesCount}</div>}));
vi.mock('@/components/post/CommentList',()=>({CommentList:()=>null,CommentCard:()=>null}));
vi.mock('@/components/post/CommentForm',()=>({CommentForm:()=>null}));
vi.mock('@/components/profile/FollowButton',()=>({FollowButton:()=>null}));
vi.mock('./VideoLightboxPlayer',()=>({VideoLightboxPlayer:({selection}:{selection:{postId:string}})=><div data-testid="active-video">{selection.postId}</div>}));
import {MediaLightbox} from './MediaLightbox';
const post=(id:string)=>({id,userId:'author',content:id,createdAt:'2026-10-15T10:00:00Z',video:{key:id,duration:16,width:1920,height:1080,size:100,mimeType:'video/mp4'},likesCount:5,commentsCount:1,repostsCount:0,likedByMe:false,repostedByMe:false,imageUrls:[],author:{id:'author',username:'author',displayName:'投稿者',avatarUrl:'',bio:'',coverUrl:'',createdAt:''}}) as PostWithAuthor;
beforeEach(()=>{
 vi.clearAllMocks();vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 vi.stubGlobal('PointerEvent',class extends MouseEvent{pointerId:number;pointerType:string;constructor(type:string,init:PointerEventInit={}){super(type,init);this.pointerId=init.pointerId??1;this.pointerType=init.pointerType??'touch';}});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('advances downward through deduplicated pages on demand and stops requesting once the cursor ends',async()=>{
 const first=post('first'),second=post('second'),third=post('third'),cursor={createdAt:second.createdAt,id:second.id};
 const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
 for(const item of [first,second,third])client.setQueryData(['post',item.id],item);
 client.setQueryData(['media-video-feed','viewer'],{pages:[{posts:[first,second],nextCursor:cursor}],pageParams:[undefined]});
 mocks.feed.mockResolvedValue({posts:[second,third],nextCursor:null});
 const close=vi.fn();render(<QueryClientProvider client={client}><MemoryRouter><MediaLightbox selection={{post:first,url:'video:first',video:{postId:first.id,video:first.video!}}} onClose={close}/></MemoryRouter></QueryClientProvider>);
 const swipe=(dx:number,dy:number)=>{const target=screen.getByTestId('active-video');fireEvent.pointerDown(target,{pointerId:1,button:0,clientX:100,clientY:100});fireEvent.pointerMove(target,{pointerId:1,clientX:100+dx,clientY:100+dy});fireEvent.pointerUp(target,{pointerId:1,clientX:100+dx,clientY:100+dy});};
 swipe(120,10);expect(screen.getByTestId('active-video')).toHaveTextContent('first');expect(mocks.feed).not.toHaveBeenCalled();
 swipe(0,100);expect(screen.getByTestId('active-video')).toHaveTextContent('second');expect(screen.getByTestId('post-actions')).toHaveTextContent('second:5');
 swipe(0,100);await waitFor(()=>expect(screen.getByTestId('active-video')).toHaveTextContent('third'));
 expect(mocks.feed).toHaveBeenCalledTimes(1);expect(mocks.feed.mock.calls[0][0]).toEqual(cursor);
 await waitFor(()=>expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy','false'));swipe(0,100);expect(screen.getByTestId('active-video')).toHaveTextContent('third');expect(mocks.feed).toHaveBeenCalledTimes(1);
 swipe(0,-100);expect(screen.getByTestId('active-video')).toHaveTextContent('second');
 // Closing and post actions must remain usable immediately after a swipe.
 fireEvent.click(screen.getByRole('button',{name:'動画を閉じる'}));await waitFor(()=>expect(close).toHaveBeenCalledTimes(1));
 client.clear();
});
