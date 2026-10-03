import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({write:vi.fn(),userId:'viewer'}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:state.userId}})}));
vi.mock('@/api/bookmarks',()=>({getBookmarkIds:async()=>[],setBookmark:state.write}));
import { BookmarkButton } from './BookmarkButton';
beforeEach(()=>{state.userId='viewer';state.write.mockReset().mockResolvedValue(undefined);});afterEach(cleanup);
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});client.setQueryData(['bookmarks','ids','viewer'],[]);render(<QueryClientProvider client={client}><BookmarkButton post={{id:'original'}} /><BookmarkButton post={{id:'original'}} /></QueryClientProvider>);return client;}
it('shares state across every instance and prevents another click while saving',async()=>{
  let resolve!:()=>void;state.write.mockImplementation(()=>new Promise<void>(done=>{resolve=done;}));mount();
  fireEvent.click(screen.getAllByRole('button',{name:'ブックマークに追加'})[0]);
  await waitFor(()=>expect(screen.getAllByRole('button',{name:'ブックマークを解除'})).toHaveLength(2));
  expect(screen.getAllByRole('button',{name:'ブックマークを解除'}).every(button=>(button as HTMLButtonElement).disabled)).toBe(true);
  resolve();await waitFor(()=>expect(screen.getAllByRole('button',{name:'ブックマークを解除'})[0]).toBeEnabled());
  expect(state.write).toHaveBeenCalledOnce();
});
it('rolls back a failed save without losing unrelated bookmarks',async()=>{
  const client=mount();client.setQueryData(['bookmarks','ids','viewer'],['other']);state.write.mockRejectedValue(new Error('write failed'));
  fireEvent.click(screen.getAllByRole('button',{name:'ブックマークに追加'})[0]);
  await waitFor(()=>expect(state.write).toHaveBeenCalled());await waitFor(()=>expect(screen.getAllByRole('button',{name:'ブックマークに追加'})[0]).toBeEnabled());
  expect(client.getQueryData(['bookmarks','ids','viewer'])).toEqual(['other']);
});
it('rolls back only the original account after switching accounts during a save',async()=>{
  let reject!:(error:Error)=>void;
  state.write.mockImplementation(()=>new Promise<void>((_resolve,fail)=>{reject=fail;}));
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  client.setQueryData(['bookmarks','ids','viewer'],[]);
  client.setQueryData(['bookmarks','ids','second'],['original','other']);
  const view=()=> <QueryClientProvider client={client}><BookmarkButton post={{id:'original'}} /></QueryClientProvider>;
  const rendered=render(view());fireEvent.click(screen.getByRole('button',{name:'ブックマークに追加'}));
  await waitFor(()=>expect(state.write).toHaveBeenCalled());
  state.userId='second';rendered.rerender(view());reject(new Error('write failed'));
  await waitFor(()=>expect(client.getQueryData(['bookmarks','ids','viewer'])).toEqual([]));
  expect(client.getQueryData(['bookmarks','ids','second'])).toEqual(['original','other']);
});
