import {expect,it} from 'vitest';
import {parseSearchQuery,postMatchesSearch} from './SearchPage';
import type {PostWithAuthor} from '@/types';
const post={id:'x:20',source:'x',content:'アニメ',imageUrls:[],externalVideo:{playlist:'https://video.twimg.com/playlist.m3u8',duration:16,width:1920,height:1080},createdAt:'2026-10-15',likesCount:3,repostsCount:0,author:{username:'artist@x.com'}} as PostWithAuthor;
it('supports selecting X as a search source',()=>{expect(parseSearchQuery('アニメ source:x').source).toBe('x');expect(parseSearchQuery('アニメ source:twitter').source).toBe('x');});
it('includes native X videos in the media and video filters',()=>{expect(postMatchesSearch(post,parseSearchQuery('アニメ filter:videos'))).toBe(true);expect(postMatchesSearch(post,parseSearchQuery('アニメ filter:images'))).toBe(false);});
it('matches X author handles with or without the provider suffix',()=>{expect(postMatchesSearch(post,parseSearchQuery('from:artist'))).toBe(true);expect(postMatchesSearch(post,parseSearchQuery('from:artist@x.com'))).toBe(true);expect(postMatchesSearch(post,parseSearchQuery('-from:artist'))).toBe(false);});
it('passes author-only and advanced conditions to twitter without losing operators',async()=>{
 const {twitterSearchQuery}=await import("@/api/search-news");expect(twitterSearchQuery(parseSearchQuery('from:artist source:twitter'))).toBe('(from:artist)');
 const q=twitterSearchQuery(parseSearchQuery('アニメ from:artist@twitter.com to:friend since:2026-10-01 filter:videos min_likes:5 -広告 source:twitter'));
 expect(q).toContain('from:artist');expect(q).toContain('to:friend');expect(q).toContain('since:2026-10-01');expect(q).toContain('filter:videos');expect(q).toContain('min_faves:5');expect(q).not.toContain('source:');
});

// Route-level regression: searches must survive refresh, sharing, and browser history.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import SearchPage, { SearchResults } from './SearchPage';
vi.mock('@/hooks/useAuth',async original=>({...await original<typeof import('@/hooks/useAuth')>(),useAuth:()=>({user:null,accounts:[]})}));
vi.mock('@/hooks/useTopics',async original=>({...await original<typeof import('@/hooks/useTopics')>(),useTrends:()=>({data:[],isPending:false}),useSearchNews:()=>({data:{items:[],sources:{}},isPending:false}),useSearchExploreTab:()=>['recommended']}));
vi.mock('@/api/recommendations',async original=>({...await original<typeof import('@/api/recommendations')>(),getRecommendationPreferences:async()=>({authors:{},terms:{}})}));
const searchFixtures=vi.hoisted(()=>({twitter:vi.fn(),following:[] as any[]}));
vi.mock('@/api/search-news',async original=>({...await original<typeof import('@/api/search-news')>(),searchTwitterResults:(...args:any[])=>searchFixtures.twitter(...args)}));
vi.mock('@/hooks/useSearchFollowing',()=>({useSearchFollowing:()=>({data:searchFixtures.following})}));
vi.mock('@/components/feed/PostCard',async original=>({...await original<typeof import('@/components/feed/PostCard')>(),PostCard:({post}:{post:PostWithAuthor})=><article data-testid="ordered-search-post" data-post-id={post.id}>{post.content}</article>}));
const externalPages=vi.hoisted(()=>vi.fn());
beforeEach(()=>{externalPages.mockReset().mockResolvedValue({posts:[],cursor:null});searchFixtures.following=[];searchFixtures.twitter.mockReset().mockResolvedValue({posts:[],cursor:null,error:null});});
vi.mock('@/lib/bluesky',async original=>({...await original<typeof import('@/lib/bluesky')>(),fetchBlueskyTopicPosts:(...args:any[])=>externalPages(...args),searchBluesky:async()=>({posts:[],users:[]}),searchExternalUsers:async()=>[]}));
vi.mock('@/lib/misskey',async original=>({...await original<typeof import('@/lib/misskey')>(),misskeyEnabled:()=>false}));
vi.mock('@/lib/supabase',()=>({supabase:{auth:{getUser:async()=>({data:{user:null}}),getSession:async()=>({data:{session:null}})},from:()=>{const q=new Proxy({},{get:(_,name)=>name==='then'?(done:Function)=>Promise.resolve({data:[],error:null}).then(done as never):()=>q});return q;}}}));
let queryClient:QueryClient|undefined;
afterEach(()=>{cleanup();queryClient?.clear();vi.restoreAllMocks();vi.unstubAllGlobals();});
function RouteProbe(){const location=useLocation(),navigate=useNavigate();return <><output data-testid="search-url">{location.pathname+location.search}</output><button onClick={()=>navigate(-1)}>前の検索へ</button><button onClick={()=>navigate('/search')}>検索トップへ</button></>;}
function searchTree(path='/search'){
 vi.stubGlobal('ResizeObserver',class {observe(){}unobserve(){}disconnect(){}});
 vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
 queryClient=new QueryClient({defaultOptions:{queries:{retry:false}}});
 return <QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[path]}><RouteProbe/><SearchPage/></MemoryRouter></QueryClientProvider>;
}
it('puts submitted terms in q and typed_query, preserves punctuation, and restores search history',async()=>{
 render(searchTree());const input=screen.getByPlaceholderText('検索');
 const submit=(query:string)=>{fireEvent.change(input,{target:{value:query}});fireEvent.submit(input.closest('form')!);};
 submit('ねこ');
 await waitFor(()=>expect(screen.getByTestId('search-url')).toHaveTextContent('/search?q=%E3%81%AD%E3%81%93&src=typed_query'));
 submit('犬 & 猫+#');
 await waitFor(()=>expect(new URL('https://lime.test'+screen.getByTestId('search-url').textContent).searchParams.get('q')).toBe('犬 & 猫+#'));
 expect(new URL('https://lime.test'+screen.getByTestId('search-url').textContent).searchParams.get('src')).toBe('typed_query');
 fireEvent.click(screen.getByText('前の検索へ'));await waitFor(()=>expect(input).toHaveValue('ねこ'));
 fireEvent.click(screen.getByText('検索トップへ'));await waitFor(()=>expect(input).toHaveValue(''));
 expect(screen.getByTestId('search-url')).toHaveTextContent(/^\/search$/);
});
it('restores a query opened directly from a shared URL',async()=>{
 render(searchTree('/search?q=%E3%81%AD%E3%81%93&src=typed_query'));
 await waitFor(()=>expect(screen.getByPlaceholderText('検索')).toHaveValue('ねこ'));
});

it('advances media search beyond a page filtered to zero images, retaining its cursor',async()=>{
 const image={...post,id:'bsky:at://did:plc:artist/app.bsky.feed.post/image',source:'bluesky',externalVideo:undefined,imageUrls:['https://image.test/portrait.jpg'],imageDimensions:[{width:600,height:900}],content:'アニメ'};
 externalPages.mockResolvedValueOnce({posts:[{...image,id:'bsky:text',imageUrls:[]}],cursor:'page-two'}).mockResolvedValueOnce({posts:[image],cursor:null});
 vi.stubGlobal('IntersectionObserver',class{callback:any;constructor(callback:any){this.callback=callback;}observe(target:any){queueMicrotask(()=>this.callback([{isIntersecting:true,target}]));}disconnect(){}unobserve(){}});
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}unobserve(){}});
 queryClient=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const view=render(<QueryClientProvider client={queryClient}><MemoryRouter><SearchResults searchQuery="アニメ source:bluesky" activeTab="media" excludeBlueskyPosts={false} allUsers={[]} isUsersLoading={false} refreshKey={0} onChangeQuery={()=>{}}/></MemoryRouter></QueryClientProvider>);
 await waitFor(()=>expect(externalPages).toHaveBeenCalledTimes(2));
 expect(externalPages.mock.calls[1][0].cursor).toBe('page-two');
 await waitFor(()=>expect(view.container.querySelector('img[src="https://image.test/portrait.jpg"]')).not.toBeNull());
 expect(screen.queryByText('メディアが見つかりません')).toBeNull();
});

it('drains buffered media before fetching another provider page',async()=>{
 let intersect=()=>{};
 vi.stubGlobal('IntersectionObserver',class{callback:any;constructor(callback:any){this.callback=callback;}observe(target:HTMLElement){if(target.hasAttribute('data-lime-search-next-page'))intersect=()=>this.callback([{isIntersecting:true,target}]);}disconnect(){}unobserve(){}});
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}unobserve(){}});
 const photo=(id:number)=>({...post,id:'bsky:at://did:plc:artist/app.bsky.feed.post/'+id,source:'bluesky',externalVideo:undefined,imageUrls:['https://image.test/'+id+'.jpg'],content:'アニメ'});
 externalPages.mockResolvedValueOnce({posts:Array.from({length:50},(_,i)=>photo(i)),cursor:'next'}).mockResolvedValueOnce({posts:Array.from({length:10},(_,i)=>photo(i+50)),cursor:null});
 queryClient=new QueryClient({defaultOptions:{queries:{retry:false}}});
 render(<QueryClientProvider client={queryClient}><MemoryRouter><SearchResults searchQuery="アニメ source:bluesky" activeTab="media" excludeBlueskyPosts={false} allUsers={[]} isUsersLoading={false} refreshKey={0} onChangeQuery={()=>{}}/></MemoryRouter></QueryClientProvider>);
 await waitFor(()=>expect(screen.getAllByRole('button',{name:'画像を開く'})).toHaveLength(20));
 await act(async()=>intersect());
 await waitFor(()=>expect(screen.getAllByRole('button',{name:'画像を開く'})).toHaveLength(40));expect(externalPages).toHaveBeenCalledTimes(1);
 await act(async()=>intersect());
 await waitFor(()=>expect(screen.getAllByRole('button',{name:'画像を開く'})).toHaveLength(60));expect(externalPages).toHaveBeenCalledTimes(2);
});

it('keeps latest results chronological across providers even when an older author is followed',async()=>{
 const old={...post,id:'x:older',userId:'x-user:followed',createdAt:'2026-10-10T00:00:00Z',author:{...post.author,id:'x-user:followed',username:'followed@twitter.com'}};
 const recent={...post,id:'bsky:recent',source:'bluesky',userId:'did:plc:recent',createdAt:'2026-10-20T00:00:00Z',author:{...post.author,id:'did:plc:recent',username:'recent.bsky.social'}};
 searchFixtures.following=[old.author];searchFixtures.twitter.mockResolvedValue({posts:[old],cursor:null,error:null});externalPages.mockResolvedValue({posts:[recent],cursor:null});
 vi.stubGlobal('IntersectionObserver',class{observe(){}disconnect(){}unobserve(){}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 queryClient=new QueryClient({defaultOptions:{queries:{retry:false}}});
 render(<QueryClientProvider client={queryClient}><MemoryRouter><SearchResults searchQuery="アニメ" activeTab="latest" excludeBlueskyPosts={false} allUsers={[]} isUsersLoading={false} refreshKey={0} onChangeQuery={()=>{}}/></MemoryRouter></QueryClientProvider>);
 await waitFor(()=>expect(screen.getAllByTestId('ordered-search-post').map(row=>row.getAttribute('data-post-id'))).toEqual([recent.id,old.id]));
});
