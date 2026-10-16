import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {PostWithAuthor} from '@/types';
const mocks=vi.hoisted(()=>({feed:vi.fn(),post:vi.fn(),twitter:vi.fn()}));
vi.mock('@/api/twitter-videos',()=>({getTwitterVideoPage:(...args:unknown[])=>mocks.twitter(...args)}));
vi.mock('@/api/posts',()=>({getVideoFeed:(...args:unknown[])=>mocks.feed(...args),getPostById:(...args:unknown[])=>mocks.post(...args)}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'viewer'}})}));
vi.mock('@/hooks/useFeed',()=>({postKey:(id:string)=>['post',id]}));
vi.mock('@/components/feed/PostCard',()=>({PostCard:({post,mediaPresentation}:{post:PostWithAuthor;mediaPresentation:string})=><div data-testid={`post-${mediaPresentation}`}>{post.id}:{post.likesCount}</div>}));
vi.mock('@/components/post/CommentList',()=>({CommentList:()=>null,CommentCard:()=>null}));
vi.mock('@/components/post/CommentForm',()=>({CommentForm:()=>null}));
vi.mock('@/components/profile/FollowButton',()=>({FollowButton:()=>null}));
vi.mock('./VideoLightboxPlayer',()=>({VideoLightboxPlayer:({selection,onTap}:{selection:{postId:string};onTap:(toggle:()=>void)=>void})=><div data-testid="active-video" onClick={()=>onTap(()=>{})}>{selection.postId}</div>}));
import {MediaLightbox} from './MediaLightbox';
const post=(id:string)=>({id,userId:'author',content:id,createdAt:'2026-10-15T10:00:00Z',video:{key:id,duration:16,width:1920,height:1080,size:100,mimeType:'video/mp4'},likesCount:5,commentsCount:1,repostsCount:0,likedByMe:false,repostedByMe:false,imageUrls:[],author:{id:'author',username:'author',displayName:'投稿者',avatarUrl:'',bio:'',coverUrl:'',createdAt:''}}) as PostWithAuthor;
beforeEach(()=>{
 vi.clearAllMocks();mocks.twitter.mockResolvedValue({posts:[],nextCursor:null});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
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

it('hides and restores mobile playback controls on a video tap',async()=>{
 vi.stubGlobal('matchMedia',()=>({matches:true}));const first=post('tap');
 const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});client.setQueryData(['post',first.id],first);mocks.feed.mockResolvedValue({posts:[],nextCursor:null});
 render(<QueryClientProvider client={client}><MemoryRouter><MediaLightbox selection={{post:first,url:'video:tap',video:{postId:first.id,video:first.video!}}} onClose={()=>{}}/></MemoryRouter></QueryClientProvider>);
 fireEvent.click(screen.getByTestId('active-video'));await waitFor(()=>expect(screen.getByRole('dialog')).toHaveClass('lime-media-controls-hidden'));
 fireEvent.click(screen.getByTestId('active-video'));await waitFor(()=>expect(screen.getByRole('dialog')).not.toHaveClass('lime-media-controls-hidden'));client.clear();
});
it('swipes from a twitter video to followed/recommended twitter videos and native videos without reordering',async()=>{
 const first={...post('x:501'),video:undefined,externalVideo:{playlist:'https://video.example/one.m3u8',format:'hls',duration:10,width:1280,height:720}} as PostWithAuthor;
 const second={...post('x:502'),video:undefined,externalVideo:{...first.externalVideo!,playlist:'https://video.example/two.m3u8'}} as PostWithAuthor,third=post('native');
 const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});for(const item of [first,second,third])client.setQueryData(['post',item.id],item);
 mocks.feed.mockResolvedValue({posts:[third],nextCursor:null});mocks.twitter.mockResolvedValue({posts:[first,second],nextCursor:null});
 render(<QueryClientProvider client={client}><MemoryRouter><MediaLightbox selection={{post:first,url:'video:'+first.id,video:{postId:first.id,video:first.externalVideo!,externalVideo:first.externalVideo}}} onClose={()=>{}}/></MemoryRouter></QueryClientProvider>);
 await waitFor(()=>expect(mocks.twitter).toHaveBeenCalledTimes(1));await waitFor(()=>expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy','false'));
 fireEvent.click(screen.getByRole('button',{name:'次の動画'}));await waitFor(()=>expect(screen.getByTestId('active-video')).toHaveTextContent('x:502'));
 fireEvent.click(screen.getByRole('button',{name:'次の動画'}));await waitFor(()=>expect(screen.getByTestId('active-video')).toHaveTextContent('native'));client.clear();
});
