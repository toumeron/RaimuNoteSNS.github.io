vi.mock("@/components/feed/RepostButton", async importOriginal => {
 const actual = await importOriginal<typeof import("@/components/feed/RepostButton")>();
 return {...actual, ...await (async importOriginal => ({...await importOriginal<typeof import("@/components/feed/RepostButton")>(), RepostButton: () => <button>リポスト</button>}))(importOriginal)};
});
vi.mock("@/components/video/PostVideoPlayer", async importOriginal => ({...await importOriginal<typeof import("@/components/video/PostVideoPlayer")>(), PostVideoPlayer:()=> <div data-attached-video/>}));


vi.mock("@/hooks/useAuth", async importOriginal => ({...await importOriginal<typeof import("@/hooks/useAuth")>(), useBlueskySession: () => null}));

import { cleanup, render, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type { PostWithAuthor } from '@/types';

vi.mock("@/lib/supabase", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/supabase")>(),
  ...await (async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient('https://test.invalid', 'fixture-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  // Exercise the real SDK's channel registry and subscribe/on guards offline.
  vi.spyOn(client.realtime, 'connect').mockImplementation(() => {});
  vi.spyOn(client, 'from').mockImplementation(() => {
    const builder = {
      select: () => builder, eq: () => builder, in: () => builder,
      order: () => builder, limit: () => builder, maybeSingle: () => builder,
      single: () => builder, match: () => builder,
      then: (resolve: (value: unknown) => void) => Promise.resolve({ data: [], count: 0, error: null }).then(resolve),
    };
    return builder as never;
  });
  return { supabase: client };
})()
}));


vi.mock('@/lib/currentUser', () => ({ getCurrentUserId: async () => 'viewer' }));


import { PostCard } from './PostCard';
import { supabase } from '@/lib/supabase';

afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); });
it('can mount the same original separately and inside multiple quotes with the real Realtime SDK', async () => {
  vi.useFakeTimers();
  const original = {
    id: 'original', userId: 'author', content: 'Original', imageUrls: [], createdAt: '2026-10-03T00:00:00Z',
    likesCount: 0, commentsCount: 0, repostsCount: 0, likedByMe: false, repostedByMe: false,
    author: { id: 'author', username: 'author', displayName: 'Author', avatarUrl: '' },
  } as PostWithAuthor;
  const quote = { ...original, id: 'quote', content: 'Quote', isQuote: true, parentId: 'original', parentPost: original };
  const view = render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
    <PostCard post={original} /><PostCard post={quote} /><PostCard post={{ ...quote, id: 'quote-two' }} />
  </MemoryRouter></QueryClientProvider>);
  expect(view.container.querySelectorAll('[data-lime-post-card]')).toHaveLength(5);
  const reactionChannels = supabase.getChannels().filter(channel => channel.topic.startsWith('realtime:post-reactions-original-'));
  expect(reactionChannels).toHaveLength(3);
  expect(new Set(reactionChannels.map(channel => channel.topic)).size).toBe(3);
});

it('keeps the external source immediately above actions after photos and the bounded quote',()=>{
 vi.useFakeTimers();
 const original={id:'quoted-native',userId:'author',content:'あ'.repeat(200)+' https://example.com',imageUrls:[],createdAt:'2026-10-17T00:00:00Z',likesCount:0,commentsCount:0,repostsCount:0,author:{id:'author',username:'author',displayName:'Author',avatarUrl:''},linkPreview:{url:'https://example.com',title:'引用のURLカード',domain:'example.com',image:''}} as PostWithAuthor;
 const post={...original,id:'x:12345',source:'x',content:'本文 https://example.com',imageUrls:['https://example.com/photo.jpg'],isQuote:true,parentPost:original,parentId:original.id} as PostWithAuthor;
 const view=render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><PostCard post={post}/></MemoryRouter></QueryClientProvider>);
 const label=view.container.querySelector('[data-lime-post-provider]')!;
 expect(label).toHaveTextContent('twitter');expect(label.nextElementSibling).toHaveAttribute('data-lime-post-actions');
 const quote=view.container.querySelector('[data-lime-quoted-post]')!;
 expect(quote).toHaveTextContent('あ'.repeat(140)+'…');expect(quote).not.toHaveTextContent('あ'.repeat(141));
 expect(view.container.querySelector('[data-link-preview]')).toBeNull();
 expect(view.container.querySelectorAll('[data-lime-post-provider]')).toHaveLength(1);
 expect(quote.compareDocumentPosition(label)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('hides only the twitter suffix in the visible handle and preserves profile routes and source labels',()=>{
 vi.useFakeTimers();
 const post={id:'x:880010',source:'x',userId:'x-user:author',content:'本文',imageUrls:[],createdAt:'2026-10-17T00:00:00Z',likesCount:0,repostsCount:0,commentsCount:0,author:{id:'x-user:author',username:'Google@twitter.com',displayName:'Google',avatarUrl:''}} as PostWithAuthor;
 const view=render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><PostCard post={post}/></MemoryRouter></QueryClientProvider>);
 expect(view.getByText('@Google',{exact:true})).toBeInTheDocument();expect(view.queryByText('@Google@twitter.com',{exact:true})).toBeNull();
 expect(view.container.querySelector('a[href="/u/Google@twitter.com"]')).not.toBeNull();expect(view.container.querySelector('[data-lime-post-provider]')).toHaveTextContent('twitter');
});

it.each(['video','externalVideo'])('retains Youtube as a plain link when an attached %s is present',kind=>{
 vi.useFakeTimers();
 const post={id:'native-video',userId:'author',content:'動画 https://youtu.be/abcdefghijk',imageUrls:[],createdAt:'2026-10-17T00:00:00Z',likesCount:0,repostsCount:0,commentsCount:0,author:{id:'author',username:'author',displayName:'Author',avatarUrl:''},[kind]:{duration:16,width:1920,height:1080}} as unknown as PostWithAuthor;
 const client=new QueryClient();
 const body=(post:PostWithAuthor)=><QueryClientProvider client={client}><MemoryRouter><PostCard post={post}/></MemoryRouter></QueryClientProvider>;
 const view=render(body(post));
 expect(view.container.querySelector('[data-attached-video]')).not.toBeNull();expect(view.container.querySelector('iframe[src^="https://www.youtube.com/embed/abcdefghijk"]')).toBeNull();
 expect(view.container.querySelector('a[href="https://youtu.be/abcdefghijk"]')).not.toBeNull();
 view.rerender(body({...post,video:undefined,externalVideo:undefined}));
 expect(view.container.querySelector('iframe[src^="https://www.youtube.com/embed/abcdefghijk"]')).not.toBeNull();
});

it('keeps social URLs intact through mention/hashtag rendering and links them inside LimeNote',()=>{
 const post={id:'social-link-post',userId:'author',content:'https://misskey.io/@artist https://x.com/artist/status/123456#photo https://bsky.app/profile/artist.bsky.social/post/3abc',imageUrls:[],createdAt:'2026-10-19T00:00:00Z',likesCount:0,commentsCount:0,repostsCount:0,author:{id:'author',username:'author',displayName:'Author',avatarUrl:''}} as PostWithAuthor;
 const view=render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><PostCard post={post}/></MemoryRouter></QueryClientProvider>);
 const links=[...view.container.querySelectorAll('a')];
 for(const [url,path]of [['https://misskey.io/@artist','/u/artist%40misskey.io'],['https://x.com/artist/status/123456#photo','/post/x%3A123456'],['https://bsky.app/profile/artist.bsky.social/post/3abc','/post/'+encodeURIComponent('bsky:at://artist.bsky.social/app.bsky.feed.post/3abc')]]){
  const link=links.find(element=>element.textContent===url);expect(link).toHaveAttribute('href',path);expect(link).not.toHaveAttribute('target');
 }
});

it('reserves the timeline image frame before decoding without resizing on load',()=>{
 const post={id:'geometry-photo',userId:'author',content:'Photo',imageUrls:['https://images.example/portrait.png'],imageDimensions:[{width:600,height:900}],createdAt:'2026-10-20T00:00:00Z',likesCount:0,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,author:{id:'author',username:'author',displayName:'Author',avatarUrl:''}} as PostWithAuthor;
 const view=render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><PostCard post={post}/></MemoryRouter></QueryClientProvider>);
 const frame=view.container.querySelector('[data-lime-single-post-image]') as HTMLElement;
 const image=frame.querySelector('img')!;
 expect(frame.style.aspectRatio).toBe('600/900');expect(image.style.opacity).toBe('0');
 const initial=frame.style.cssText;
 Object.defineProperties(image,{naturalWidth:{value:100},naturalHeight:{value:600}});fireEvent.load(image);
 expect(frame.style.cssText).toBe(initial);expect(image.style.opacity).toBe('');
});

it('shows the community link and requires confirmation before moderator removal',async()=>{
 const remove=vi.fn(),confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
 const post={id:'community-post',userId:'author',content:'Community post',imageUrls:[],createdAt:'2026-10-23T00:00:00Z',likesCount:0,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,communityId:'community',community:{id:'community',name:'旅行の会'},author:{id:'author',username:'author',displayName:'Author',avatarUrl:''}} as PostWithAuthor;
 const view=render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><PostCard post={post} onCommunityRemove={remove}/></MemoryRouter></QueryClientProvider>);
 expect(view.getByRole('link',{name:'旅行の会'})).toHaveAttribute('href','/communities/community');
 fireEvent.click(view.getByRole('button',{name:'ポストのメニュー'}));fireEvent.click(view.getByRole('button',{name:'コミュニティからポストを削除'}));expect(remove).not.toHaveBeenCalled();
 confirm.mockReturnValue(true);fireEvent.click(view.getByRole('button',{name:'ポストのメニュー'}));fireEvent.click(view.getByRole('button',{name:'コミュニティからポストを削除'}));expect(remove).toHaveBeenCalledOnce();confirm.mockRestore();
 view.rerender(<QueryClientProvider client={new QueryClient()}><MemoryRouter><PostCard post={post} showCommunityLabel={false}/></MemoryRouter></QueryClientProvider>);expect(view.queryByRole('link',{name:'旅行の会'})).toBeNull();expect(view.getByText('Community post')).toBeInTheDocument();
});
