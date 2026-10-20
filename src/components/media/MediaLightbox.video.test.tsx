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
vi.mock("@/api/search-news", async importOriginal => ({...await importOriginal<typeof import("@/api/search-news")>(), getTwitterVideoPage:(...args:unknown[])=>mocks.twitter(...args)}));

vi.mock("@/components/video/PostVideoPlayer", async importOriginal => ({...await importOriginal<typeof import("@/components/video/PostVideoPlayer")>(), VideoLightboxPlayer:({selection,onTap,muted,onMutedChange}:{selection:{postId:string};onTap:(toggle:()=>void)=>void;muted:boolean;onMutedChange:(value:boolean)=>void})=><><div data-testid="active-video" data-muted={String(muted)} onClick={()=>onTap(()=>{})}>{selection.postId}</div><button onClick={()=>onMutedChange(!muted)}>テスト音声切替</button></>}));
vi.mock("@/hooks/useAuth", async importOriginal => ({...await importOriginal<typeof import("@/hooks/useAuth")>(), useAuth:()=>({user:{id:'viewer'}})}));
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {PostWithAuthor} from '@/types';
const mocks=vi.hoisted(()=>({feed:vi.fn(),post:vi.fn(),twitter:vi.fn()}));

vi.mock('@/api/posts',()=>({getVideoFeed:(...args:unknown[])=>mocks.feed(...args),getPostById:(...args:unknown[])=>mocks.post(...args)}));







import {MediaLightbox} from './MediaLightbox';
const post=(id:string)=>({id,userId:'author',content:id,createdAt:'2026-10-15T10:00:00Z',video:{key:id,duration:16,width:1920,height:1080,size:100,mimeType:'video/mp4'},likesCount:5,commentsCount:1,repostsCount:0,likedByMe:false,repostedByMe:false,imageUrls:[],author:{id:'author',username:'author',displayName:'投稿者',avatarUrl:'',bio:'',coverUrl:'',createdAt:''}}) as PostWithAuthor;
beforeEach(()=>{
 localStorage.clear();vi.clearAllMocks();mocks.twitter.mockResolvedValue({posts:[],nextCursor:null});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
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
 swipe(0,-100);expect(screen.getByTestId('active-video')).toHaveTextContent('third');
 fireEvent.click(screen.getByRole('button',{name:'前の動画'}));await waitFor(()=>expect(screen.getByTestId('active-video')).toHaveTextContent('second'));
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

it('inserts a late twitter video before unwatched native videos on a downward mobile swipe',async()=>{
 vi.stubGlobal('matchMedia',()=>({matches:true}));
 const first=post('start-native'),native=post('queued-native'),twitter={...post('x:late'),video:undefined,externalVideo:{playlist:'https://video.example/late.mp4',format:'mp4',duration:10,width:1280,height:720}} as PostWithAuthor;
 let finish!:(value:any)=>void;mocks.twitter.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));mocks.feed.mockResolvedValue({posts:[native],nextCursor:null});
 const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});for(const item of [first,native,twitter])client.setQueryData(['post',item.id],item);
 render(<QueryClientProvider client={client}><MemoryRouter><MediaLightbox selection={{post:first,url:'video:'+first.id,video:{postId:first.id,video:first.video!}}} onClose={()=>{}}/></MemoryRouter></QueryClientProvider>);
 await waitFor(()=>expect(mocks.twitter).toHaveBeenCalledTimes(1));finish({posts:[twitter],nextCursor:null});
 await waitFor(()=>expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy','false'));
 const target=screen.getByTestId('active-video');fireEvent.pointerDown(target,{pointerId:1,button:0,clientX:100,clientY:100});fireEvent.pointerMove(target,{pointerId:1,clientX:100,clientY:200});fireEvent.pointerUp(target,{pointerId:1,clientX:100,clientY:200});
 await waitFor(()=>expect(screen.getByTestId('active-video')).toHaveTextContent('x:late'));client.clear();
});

it('advances to a ready twitter video while the native video request is still pending',async()=>{
 const first=post('fast-external-start'),twitter={...post('x:ready'),video:undefined,externalVideo:{playlist:'https://video.example/ready.mp4',format:'mp4',duration:10,width:1280,height:720}} as PostWithAuthor;
 let finish!:(value:any)=>void;mocks.twitter.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));mocks.feed.mockImplementation(()=>new Promise(()=>{}));
 const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});for(const item of [first,twitter])client.setQueryData(['post',item.id],item);
 render(<QueryClientProvider client={client}><MemoryRouter><MediaLightbox selection={{post:first,url:'video:'+first.id,video:{postId:first.id,video:first.video!}}} onClose={()=>{}}/></MemoryRouter></QueryClientProvider>);
 await waitFor(()=>expect(mocks.twitter).toHaveBeenCalledTimes(1));fireEvent.click(screen.getByRole('button',{name:'次の動画'}));finish({posts:[twitter],nextCursor:null});
 await waitFor(()=>expect(screen.getByTestId('active-video')).toHaveTextContent('x:ready'));client.clear();
});

it('continues through photo-only twitter pages before the native queue is exhausted',async()=>{
 const first=post('photo-scan-start'),native=post('photo-scan-native');
 const twitter={...post('x:found-video'),video:undefined,externalVideo:{playlist:'https://video.example/found.mp4',format:'mp4',duration:10,width:1280,height:720}} as PostWithAuthor;
 const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});for(const item of [first,native,twitter])client.setQueryData(['post',item.id],item);
 mocks.feed.mockResolvedValue({posts:[native],nextCursor:null});mocks.twitter.mockResolvedValueOnce({posts:[],nextCursor:{round:1}}).mockResolvedValueOnce({posts:[],nextCursor:{round:2}}).mockResolvedValueOnce({posts:[twitter],nextCursor:null});
 render(<QueryClientProvider client={client}><MemoryRouter><MediaLightbox selection={{post:first,url:'video:'+first.id,video:{postId:first.id,video:first.video!}}} onClose={()=>{}}/></MemoryRouter></QueryClientProvider>);
 await waitFor(()=>expect(client.getQueryData<any>(['media-twitter-videos-v4','viewer'])?.pages).toHaveLength(3));expect(mocks.twitter).toHaveBeenCalledTimes(3);
 const target=screen.getByTestId('active-video');fireEvent.pointerDown(target,{pointerId:1,button:0,clientX:100,clientY:200});fireEvent.pointerMove(target,{pointerId:1,clientX:100,clientY:100});fireEvent.pointerUp(target,{pointerId:1,clientX:100,clientY:100});
 await waitFor(()=>expect(screen.getByTestId('active-video')).toHaveTextContent('x:found-video'));expect(screen.getByTestId('active-video').closest('.lime-video-frame')).toHaveClass('lime-video-backward');client.clear();
});

it('retains sound on and mute across swipes and reopening the mobile viewer',async()=>{
 const first=post('sound-first'),second=post('sound-second');
 const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});for(const item of [first,second])client.setQueryData(['post',item.id],item);mocks.feed.mockResolvedValue({posts:[second],nextCursor:null});
 const selection={post:first,url:'video:'+first.id,video:{postId:first.id,video:first.video!}};
 const tree=()=> <QueryClientProvider client={client}><MemoryRouter><MediaLightbox selection={selection} onClose={()=>{}}/></MemoryRouter></QueryClientProvider>;
 let view=render(tree());await waitFor(()=>expect(mocks.feed).toHaveBeenCalled());fireEvent.click(screen.getByText('テスト音声切替'));expect(screen.getByTestId('active-video')).toHaveAttribute('data-muted','false');
 fireEvent.click(screen.getByRole('button',{name:'次の動画'}));await waitFor(()=>expect(screen.getByTestId('active-video')).toHaveTextContent('sound-second'));expect(screen.getByTestId('active-video')).toHaveAttribute('data-muted','false');
 view.unmount();view=render(tree());expect(screen.getByTestId('active-video')).toHaveAttribute('data-muted','false');fireEvent.click(screen.getByText('テスト音声切替'));view.unmount();view=render(tree());expect(screen.getByTestId('active-video')).toHaveAttribute('data-muted','true');view.unmount();client.clear();
});

it('keeps replenishing twitter videos beyond the initial scan budget with upward and downward swipes anywhere in the viewer',async()=>{
 const first=post('continuous-start'),native=Array.from({length:30},(_,i)=>post('continuous-native-'+i));
 const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});for(const item of [first,...native])client.setQueryData(['post',item.id],item);
 mocks.feed.mockResolvedValue({posts:native,nextCursor:null});let page=0;
 mocks.twitter.mockImplementation(async()=>{
  const batch=Array.from({length:2},(_,i)=>({...post('x:continuous-'+page+'-'+i),source:'x',video:undefined,externalVideo:{playlist:'https://video.example/continuous-'+page+'-'+i+'.mp4',format:'mp4',duration:10,width:1280,height:720}} as PostWithAuthor));
  for(const item of batch)client.setQueryData(['post',item.id],item);return {posts:batch,nextCursor:{round:++page}};
 });
 const view=render(<QueryClientProvider client={client}><MemoryRouter><MediaLightbox selection={{post:first,url:'video:'+first.id,video:{postId:first.id,video:first.video!}}} onClose={()=>{}}/></MemoryRouter></QueryClientProvider>);
 await waitFor(()=>expect(client.getQueryData<any>(['media-twitter-videos-v4','viewer'])?.pages).toHaveLength(1));
 const seen=new Set([first.id]);let twitterCount=0;
 for(let i=0;i<30;i++){
  const previous=screen.getByTestId('active-video').textContent;
  const target=screen.getByRole('dialog'),dy=i%2===0?100:-100;
  fireEvent.pointerDown(target,{pointerId:1,button:0,clientX:100,clientY:150});fireEvent.pointerMove(target,{pointerId:1,clientX:100,clientY:150+dy});fireEvent.pointerUp(target,{pointerId:1,clientX:100,clientY:150+dy});
  await waitFor(()=>expect(screen.getByTestId('active-video').textContent).not.toBe(previous));
  const current=screen.getByTestId('active-video').textContent!;expect(seen.has(current)).toBe(false);seen.add(current);if(current.startsWith('x:'))twitterCount++;
 }
 expect(twitterCount).toBeGreaterThanOrEqual(14);expect(mocks.twitter.mock.calls.length).toBeGreaterThan(7);
 view.unmount();client.clear();
});

it('starts a swipe transition before a delayed page arrives and ignores repeated swipes during loading',async()=>{
 const first=post('waiting'),next=post('arrived');let finish!:(value:any)=>void;
 mocks.feed.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});client.setQueryData(['post',first.id],first);client.setQueryData(['post',next.id],next);
 render(<QueryClientProvider client={client}><MemoryRouter><MediaLightbox selection={{post:first,url:'video:waiting',video:{postId:first.id,video:first.video!}}} onClose={()=>{}}/></MemoryRouter></QueryClientProvider>);
 await waitFor(()=>expect(mocks.feed).toHaveBeenCalledTimes(1));
 const swipe=()=>{const target=screen.getByRole('dialog');fireEvent.pointerDown(target,{pointerId:1,button:0,clientX:100,clientY:100});fireEvent.pointerMove(target,{pointerId:1,clientX:100,clientY:220});fireEvent.pointerUp(target,{pointerId:1,clientX:100,clientY:220});};
 swipe();expect(screen.getByRole('status',{name:'次の動画を読み込み中'})).toBeInTheDocument();expect(screen.getByRole('dialog')).toHaveClass('lime-video-transitioning');
 swipe();swipe();expect(mocks.feed).toHaveBeenCalledTimes(1);
 finish({posts:[next],nextCursor:null});await waitFor(()=>expect(screen.getByTestId('active-video')).toHaveTextContent('arrived'));
 expect(screen.getByRole('dialog')).not.toHaveClass('lime-video-transitioning');expect(mocks.feed).toHaveBeenCalledTimes(1);client.clear();
});
