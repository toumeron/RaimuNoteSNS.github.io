import {cleanup,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {PostWithAuthor} from '@/types';
const fixture=vi.hoisted(()=>({quotes:vi.fn()}));
vi.mock('@/api/posts',()=>({getPostQuoteCount:fixture.quotes}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'viewer'}})}));
import {PostActivitySummary} from './PostActivitySummary';
const post={id:'native-post',likesCount:1,repostsCount:2} as PostWithAuthor;
beforeEach(()=>{fixture.quotes.mockReset().mockResolvedValue(3);});
afterEach(cleanup);
function mount(value=post,mobile=true){
 const client=new QueryClient();
 const view=render(<QueryClientProvider client={client}><MemoryRouter><PostActivitySummary post={value} mobile={mobile}/></MemoryRouter></QueryClientProvider>);
 return {...view,client};
}
it('links each nonzero native mobile count to its matching activity tab',async()=>{
 mount();
 expect(await screen.findByRole('link',{name:'3 件の引用リポスト'})).toHaveAttribute('href','/post/native-post/activity?tab=quotes');
 expect(screen.getByRole('link',{name:'2 件のリポスト'})).toHaveAttribute('href','/post/native-post/activity?tab=reposts');
 expect(screen.getByRole('link',{name:'1 件のいいね'})).toHaveAttribute('href','/post/native-post/activity?tab=likes');
});
it('hides the entire row without borders when every count is zero',async()=>{
 fixture.quotes.mockResolvedValue(0);const {client}=mount({...post,likesCount:0,repostsCount:0});
 await waitFor(()=>expect(client.getQueryData(['post',post.id,'quote-count','viewer'])).toBe(0));
 expect(screen.queryByRole('navigation')).toBeNull();
});
it('keeps available likes while omitting zero reposts and an unavailable quote count',async()=>{
 fixture.quotes.mockRejectedValue(new Error('permission denied'));const {client}=mount({...post,repostsCount:0});
 await waitFor(()=>expect(client.getQueryState(['post',post.id,'quote-count','viewer'])?.status).toBe('error'));
 expect(screen.getAllByRole('link')).toHaveLength(1);expect(screen.getByRole('link')).toHaveTextContent('1件のいいね');
});
it.each(['bsky:record','misskey:note','x:123'])('does not fetch or show counts for external post %s',id=>{
 mount({...post,id});expect(screen.queryByRole('navigation')).toBeNull();expect(fixture.quotes).not.toHaveBeenCalled();
});
it('does not fetch or show the new row on desktop',()=>{
 mount(post,false);expect(screen.queryByRole('navigation')).toBeNull();expect(fixture.quotes).not.toHaveBeenCalled();
});
