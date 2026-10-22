vi.mock("@/components/feed/PostCard", async importOriginal => ({...await importOriginal<typeof import("@/components/feed/PostCard")>(), PostCard:({post,mediaPresentation}:{post:PostWithAuthor;mediaPresentation:string})=><div data-testid={`post-${mediaPresentation}`}>{post.id}:{post.likesCount}</div>}));
vi.mock("@/hooks/useFeed", async importOriginal => {
 const actual = await importOriginal<typeof import("@/hooks/useFeed")>();
 return {...actual, ...await (async importOriginal => ({...await importOriginal<typeof import("@/hooks/useFeed")>(), postKey:(id:string)=>['post',id]}))(importOriginal)};
});
vi.mock("@/components/post/CommentForm",()=>({CommentForm:()=>null}));
vi.mock("@/components/post/CommentList", async importOriginal => {
 const actual = await importOriginal<typeof import("@/components/post/CommentList")>();
 const overrides = [
  await (()=>({CommentList:()=>null,CommentCard:()=>null}))(),
  await (()=>({CommentForm:()=>null}))()
 ];
 return Object.assign({}, actual, ...overrides.map(values => Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== actual[key]))));
});
vi.mock("@/components/profile/ProfileHeader", async importOriginal => ({...await importOriginal<typeof import("@/components/profile/ProfileHeader")>(), FollowButton:()=>null}));
vi.mock("@/api/recommendations", async importOriginal => ({
  ...await importOriginal<typeof import("@/api/recommendations")>(),
  getVideoRecommendationPage:(...args:unknown[])=>mocks.feed(...args)
}));

vi.mock("@/components/video/PostVideoPlayer", async importOriginal => ({...await importOriginal<typeof import("@/components/video/PostVideoPlayer")>(), VideoLightboxPlayer:({selection,onTap,muted,onMutedChange,suspended}:{selection:{postId:string};onTap:(toggle:()=>void)=>void;muted:boolean;onMutedChange:(value:boolean)=>void;suspended?:boolean})=><><div data-testid={suspended?'preloaded-video':'active-video'} data-muted={String(muted)} onClick={()=>onTap(()=>{})}>{selection.postId}</div>{!suspended&&<button onClick={()=>onMutedChange(!muted)}>テスト音声切替</button>}</>}));
vi.mock("@/hooks/useAuth", async importOriginal => ({...await importOriginal<typeof import("@/hooks/useAuth")>(), useAuth:()=>({user:{id:'viewer'}})}));
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {PostWithAuthor} from '@/types';
const mocks=vi.hoisted(()=>({feed:vi.fn(),post:vi.fn()}));

vi.mock('@/api/posts',()=>({getPostById:(...args:unknown[])=>mocks.post(...args)}));







import {MediaLightbox} from './MediaLightbox';
const post=(id:string)=>({id,userId:'author',content:id,createdAt:'2026-10-15T10:00:00Z',video:{key:id,duration:16,width:1920,height:1080,size:100,mimeType:'video/mp4'},likesCount:5,commentsCount:1,repostsCount:0,likedByMe:false,repostedByMe:false,imageUrls:[],author:{id:'author',username:'author',displayName:'投稿者',avatarUrl:'',bio:'',coverUrl:'',createdAt:''}}) as PostWithAuthor;
beforeEach(()=>{
 localStorage.clear();vi.resetAllMocks();mocks.post.mockResolvedValue(null);vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 vi.stubGlobal('PointerEvent',class extends MouseEvent{pointerId:number;pointerType:string;constructor(type:string,init:PointerEventInit={}){super(type,init);this.pointerId=init.pointerId??1;this.pointerType=init.pointerType??'touch';}});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const mount=(first:PostWithAuthor,onClose=()=>{})=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
 const view=render(<QueryClientProvider client={client}><MemoryRouter><MediaLightbox selection={{post:first,url:'video:'+first.id,video:{postId:first.id,video:first.video!}}} onClose={onClose}/></MemoryRouter></QueryClientProvider>);
 return ()=>{view.unmount();client.clear();};
};
const swipe=(dy:number,dx=0)=>{
 const target=screen.getByRole('dialog');
 fireEvent.pointerDown(target,{pointerId:1,button:0,clientX:100,clientY:150});
 fireEvent.pointerMove(target,{pointerId:1,clientX:100+dx,clientY:150+dy});
 fireEvent.pointerUp(target,{pointerId:1,clientX:100+dx,clientY:150+dy});
};
it('advances upward, returns downward through watched videos, and keeps the first-video boundary',async()=>{
 const first=post('first'),second=post('second'),third=post('third');
 mocks.feed.mockResolvedValue({posts:[second,third],nextCursor:null});const dispose=mount(first);
 await waitFor(()=>expect(mocks.feed).toHaveBeenCalledTimes(1));
 swipe(100);expect(screen.getByTestId('active-video')).toHaveTextContent('first');
 swipe(10,120);expect(screen.getByTestId('active-video')).toHaveTextContent('first');
 swipe(-100);await waitFor(()=>expect(screen.getByTestId('active-video')).toHaveTextContent('second'));
 expect(screen.getByTestId('post-actions')).toHaveTextContent('second:5');
 expect(screen.getByTestId('active-video').closest('.lime-video-frame')).toHaveClass('lime-video-backward');
 swipe(-100);expect(screen.getByTestId('active-video')).toHaveTextContent('third');
 swipe(100);expect(screen.getByTestId('active-video')).toHaveTextContent('second');
 swipe(100);expect(screen.getByTestId('active-video')).toHaveTextContent('first');
 swipe(100);expect(screen.getByTestId('active-video')).toHaveTextContent('first');
 swipe(-100);expect(screen.getByTestId('active-video')).toHaveTextContent('second');
 expect(mocks.feed).toHaveBeenCalledTimes(1);dispose();
});
it('keeps priority pages in sequence, deduplicates and preserves watched history',async()=>{
 const first=post('start'),author=post('author-video'),following=post('following-video'),popular=post('popular-video');
 const authorCursor={stage:'author',seen:[]},followingCursor={stage:'mixed',seen:[]};
 mocks.feed.mockResolvedValueOnce({posts:[author],nextCursor:authorCursor}).mockResolvedValueOnce({posts:[first,author,following],nextCursor:followingCursor}).mockResolvedValueOnce({posts:[popular],nextCursor:null});
 const dispose=mount(first);await waitFor(()=>expect(mocks.feed).toHaveBeenCalledTimes(1));
 for(const id of [author.id,following.id,popular.id]){swipe(-100);await waitFor(()=>expect(screen.getByTestId('active-video')).toHaveTextContent(id));}
 swipe(-100);expect(screen.getByTestId('active-video')).toHaveTextContent(popular.id);
 swipe(100);expect(screen.getByTestId('active-video')).toHaveTextContent(following.id);
 swipe(100);expect(screen.getByTestId('active-video')).toHaveTextContent(author.id);
 expect(mocks.feed).toHaveBeenCalledTimes(3);expect(mocks.feed.mock.calls[1][2]).toEqual(authorCursor);dispose();
});
it('skips empty media pages without skipping the author stage',async()=>{
 const first=post('start'),next=post('author-later');
 mocks.feed.mockResolvedValueOnce({posts:[],nextCursor:{stage:'author',seen:[]}}).mockResolvedValueOnce({posts:[],nextCursor:{stage:'author',seen:[]}}).mockResolvedValueOnce({posts:[next],nextCursor:null});
 const dispose=mount(first);await waitFor(()=>expect(mocks.feed).toHaveBeenCalledTimes(1));swipe(-100);
 await waitFor(()=>expect(screen.getByTestId('active-video')).toHaveTextContent(next.id));dispose();
});
it('accepts consecutive swipes while loading and moves to the requested destination without hiding controls',async()=>{
 const first=post('waiting'),second=post('second'),third=post('third'),fourth=post('fourth');let finish!:(value:any)=>void;
 mocks.feed.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const dispose=mount(first);
 await waitFor(()=>expect(mocks.feed).toHaveBeenCalledTimes(1));
 swipe(-100);expect(screen.getByRole('status',{name:'次の動画を読み込み中'})).toBeInTheDocument();
 expect(screen.getByRole('dialog')).not.toHaveClass('lime-video-transitioning');
 expect(screen.getByTestId('active-video').closest('.lime-video-frame')).not.toHaveAttribute('aria-hidden');
 swipe(-100);swipe(-100);expect(mocks.feed).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByText('テスト音声切替'));expect(screen.getByTestId('active-video')).toHaveAttribute('data-muted','false');
 finish({posts:[second,third,fourth],nextCursor:null});await waitFor(()=>expect(screen.getByTestId('active-video')).toHaveTextContent(fourth.id));
 expect(screen.queryByRole('status',{name:'次の動画を読み込み中'})).not.toBeInTheDocument();dispose();
});
it('can go back during loading and ignores the cancelled navigation when its page arrives',async()=>{
 const first=post('first'),second=post('second'),third=post('third');let finish!:(value:any)=>void;
 mocks.feed.mockResolvedValueOnce({posts:[second],nextCursor:{stage:'mixed',seen:[]}}).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const dispose=mount(first);await waitFor(()=>expect(mocks.feed).toHaveBeenCalledTimes(1));
 swipe(-100);await waitFor(()=>expect(screen.getByTestId('active-video')).toHaveTextContent(second.id));
 swipe(-100);await waitFor(()=>expect(mocks.feed).toHaveBeenCalledTimes(2));
 swipe(100);expect(screen.getByTestId('active-video')).toHaveTextContent(second.id);
 swipe(100);expect(screen.getByTestId('active-video')).toHaveTextContent(first.id);
 await act(async()=>{finish({posts:[third],nextCursor:null});});await waitFor(()=>expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy','false'));
 expect(screen.getByTestId('active-video')).toHaveTextContent(first.id);dispose();
});
it('continues fetching enough pages for consecutive forward swipes',async()=>{
 const first=post('first'),second=post('second'),third=post('third');let finish!:(value:any)=>void;
 mocks.feed.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValueOnce({posts:[third],nextCursor:null});
 const dispose=mount(first);await waitFor(()=>expect(mocks.feed).toHaveBeenCalledTimes(1));
 swipe(-100);swipe(-100);finish({posts:[second],nextCursor:{stage:'mixed',seen:[]}});
 await waitFor(()=>expect(screen.getByTestId('active-video')).toHaveTextContent(third.id));expect(mocks.feed).toHaveBeenCalledTimes(2);dispose();
});
it('retains the mute choice across navigation and reopening',async()=>{
 const first=post('sound-first'),second=post('sound-second');mocks.feed.mockResolvedValue({posts:[second],nextCursor:null});
 let dispose=mount(first);await waitFor(()=>expect(mocks.feed).toHaveBeenCalledTimes(1));
 fireEvent.click(screen.getByText('テスト音声切替'));expect(screen.getByTestId('active-video')).toHaveAttribute('data-muted','false');
 swipe(-100);await waitFor(()=>expect(screen.getByTestId('active-video')).toHaveTextContent(second.id));expect(screen.getByTestId('active-video')).toHaveAttribute('data-muted','false');
 dispose();dispose=mount(first);expect(screen.getByTestId('active-video')).toHaveAttribute('data-muted','false');dispose();
});
it('hides and restores mobile playback controls on a video tap',async()=>{
 vi.stubGlobal('matchMedia',()=>({matches:true}));mocks.feed.mockResolvedValue({posts:[],nextCursor:null});const dispose=mount(post('tap'));
 fireEvent.click(screen.getByTestId('active-video'));await waitFor(()=>expect(screen.getByRole('dialog')).toHaveClass('lime-media-controls-hidden'));
 fireEvent.click(screen.getByTestId('active-video'));await waitFor(()=>expect(screen.getByRole('dialog')).not.toHaveClass('lime-media-controls-hidden'));dispose();
});

it('closes immediately during an unfinished candidate request',async()=>{
 vi.stubGlobal('matchMedia',()=>({matches:true}));
 const close=vi.fn();mocks.feed.mockImplementation(()=>new Promise(()=>{}));const dispose=mount(post('waiting'),close);
 await waitFor(()=>expect(mocks.feed).toHaveBeenCalledTimes(1));swipe(-100);
 fireEvent.click(screen.getByRole('button',{name:'動画を閉じる'}));await waitFor(()=>expect(close).toHaveBeenCalledTimes(1));dispose();
});
it('keeps looking through empty pages for a fresh popular candidate',async()=>{
 const first=post('start'),next=post('fresh-popular');
 mocks.feed.mockResolvedValueOnce({posts:[],nextCursor:{stage:'mixed',seen:[]}})
  .mockResolvedValueOnce({posts:[],nextCursor:{stage:'mixed',seen:[]}})
  .mockResolvedValueOnce({posts:[],nextCursor:{stage:'mixed',seen:[]}})
  .mockResolvedValueOnce({posts:[],nextCursor:{stage:'mixed',seen:[]}})
  .mockResolvedValueOnce({posts:[next],nextCursor:null});
 const dispose=mount(first);await waitFor(()=>expect(mocks.feed).toHaveBeenCalledTimes(1));swipe(-100);
 await waitFor(()=>expect(screen.getByTestId('active-video')).toHaveTextContent(next.id));expect(mocks.feed).toHaveBeenCalledTimes(5);dispose();
});

it('prepares the next video and prefetches candidates before the creator queue runs out',async()=>{
 const first=post('start'),author=post('author-one'),popular=post('popular-next');let finish!:(value:any)=>void;
 mocks.feed.mockResolvedValueOnce({posts:[author],nextCursor:{stage:'mixed',seen:[]}}).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const dispose=mount(first);await waitFor(()=>expect(mocks.feed).toHaveBeenCalledTimes(2));
 expect(screen.getByTestId('active-video')).toHaveTextContent(first.id);expect(screen.getByTestId('preloaded-video')).toHaveTextContent(author.id);
 swipe(-100);expect(screen.getByTestId('active-video')).toHaveTextContent(author.id);
 await act(async()=>{finish({posts:[popular],nextCursor:null});});
 await waitFor(()=>expect(screen.getByTestId('preloaded-video')).toHaveTextContent(popular.id));
 swipe(-100);expect(screen.getByTestId('active-video')).toHaveTextContent(popular.id);dispose();
});
