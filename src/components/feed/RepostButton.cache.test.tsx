import {act,cleanup,render,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,expect,it,vi} from 'vitest';
import type {PostWithAuthor} from '@/types';
const state=vi.hoisted(()=>({viewer:'viewer',read:vi.fn(async()=>({repostsCount:3,repostedByMe:false}))}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:state.viewer}})}));
vi.mock('@/hooks/useFeed',()=>({useToggleRepost:()=>({mutateAsync:vi.fn(),isPending:false})}));
vi.mock('@/components/post/PostActionSheet',()=>({useMobilePostMenu:()=>false,PostActionSheet:()=>null}));
vi.mock('@/components/layout/DesktopLayoutContext',()=>({usePostOverlay:()=>vi.fn()}));
vi.mock('@/api/external-posts',()=>({isExternalPostId:()=>true,getExternalRepostState:state.read}));
vi.mock('@/api/reply-reposts',()=>({isReplyPostId:()=>false,getReplyPost:vi.fn(),getReplyRepostState:vi.fn()}));
import {RepostButton} from './RepostButton';
afterEach(()=>{cleanup();state.viewer='viewer';state.read.mockClear();});
it('reuses fresh repost state after virtualized card remounts and separates accounts',async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const post={id:'bsky:at://did:plc:test/app.bsky.feed.post/one',userId:'author',content:'作品',createdAt:'2026-10-13',imageUrls:[],likesCount:0,commentsCount:0,repostsCount:0,author:{id:'author',username:'author'}} as PostWithAuthor;
 const mount=()=>render(<QueryClientProvider client={client}><RepostButton post={post}/></QueryClientProvider>);
 const first=mount();await waitFor(()=>expect(state.read).toHaveBeenCalledTimes(1));await act(async()=>{});first.unmount();
 const second=mount();await act(async()=>{});expect(state.read).toHaveBeenCalledTimes(1);second.unmount();
 state.viewer='another-viewer';mount();await waitFor(()=>expect(state.read).toHaveBeenCalledTimes(2));client.clear();
});
it('does not retry failed auxiliary reads on virtualized remounts',async()=>{
 state.read.mockRejectedValueOnce(new Error('connection closed'));
 const client=new QueryClient();const post={id:'x:99101',userId:'author',content:'post',createdAt:'2026-10-17',imageUrls:[],likesCount:0,commentsCount:0,repostsCount:0,author:{id:'author',username:'author'}} as PostWithAuthor;
 const mount=()=>render(<QueryClientProvider client={client}><RepostButton post={post}/></QueryClientProvider>);
 const first=mount();await waitFor(()=>expect(client.getQueryState(['repost-state',post.id,'viewer'])?.status).toBe('error'));expect(state.read).toHaveBeenCalledTimes(1);first.unmount();
 mount();await act(async()=>{});expect(state.read).toHaveBeenCalledTimes(1);client.clear();
});

it('adds local reposts to source counts instead of replacing the remote total',async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const post={id:'x:880005',repostsCount:100,externalDetails:{reposts:100},author:{id:'author',username:'author'}} as PostWithAuthor;
 const view=render(<QueryClientProvider client={client}><RepostButton post={post}/></QueryClientProvider>);
 await waitFor(()=>expect(view.container.querySelector('[data-lime-post-action="repost"]')).toHaveTextContent('103'));
 // Cache writes from a local toggle must not replace the source counter.
 view.rerender(<QueryClientProvider client={client}><RepostButton post={{...post,repostsCount:3}}/></QueryClientProvider>);
 expect(view.container.querySelector('[data-lime-post-action="repost"]')).toHaveTextContent('103');client.clear();
});
