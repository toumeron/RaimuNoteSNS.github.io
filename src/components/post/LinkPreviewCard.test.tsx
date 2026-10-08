import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {vi,it,expect,beforeEach} from 'vitest';
import {PostLinkPreview,useLinkPreview,LinkPreviewCard} from './LinkPreviewCard';
import {OfflineBookmarkContext} from '@/components/stickers/OfflineBookmarkContext';
const invoke=vi.hoisted(()=>vi.fn());vi.mock('@/lib/supabase',()=>({supabase:{functions:{invoke}}}));
const preview={url:'https://example.com/diary',domain:'example.com',title:'9月日記',image:'https://example.com/cover.jpg'};
function mount(content:string){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><PostLinkPreview content={content}/></QueryClientProvider>);}
beforeEach(()=>{invoke.mockReset();localStorage.clear();});
it('renders a linked image and title only on success',async()=>{invoke.mockResolvedValue({data:{preview}});mount('日記 https://example.com/diary');expect(await screen.findByRole('link',{name:'9月日記'})).toHaveAttribute('href',preview.url);await waitFor(()=>expect(document.querySelector('[data-link-preview] img')).toHaveAttribute('src',preview.image));});
it('does not request multiple URLs or render failed previews',async()=>{mount('https://example.com/a https://example.com/b');expect(invoke).not.toHaveBeenCalled();invoke.mockResolvedValue({data:{preview:null}});mount('https://example.com/c');await waitFor(()=>expect(invoke).toHaveBeenCalledOnce());expect(document.querySelector('[data-link-preview]')).toBeNull();});
it('keeps text metadata when the preview image fails',async()=>{invoke.mockResolvedValue({data:{preview}});function Body(){const state=useLinkPreview(`本文 ${preview.url}`);return <><p>{state.text(`本文 ${preview.url}`)}</p><LinkPreviewCard {...state}/></>;}render(<QueryClientProvider client={new QueryClient()}><Body/></QueryClientProvider>);await screen.findByRole('link',{name:preview.title});expect(screen.getByText('本文')).toBeInTheDocument();fireEvent.error(document.querySelector('[data-link-preview] img')!);expect(screen.getByText('本文')).toBeInTheDocument();expect(screen.getByRole('link',{name:preview.title})).toBeInTheDocument();expect(document.querySelector('[data-link-preview] img')).toBeNull();});
it('uses the offline snapshot without a metadata request',async()=>{render(<QueryClientProvider client={new QueryClient()}><OfflineBookmarkContext.Provider value={{bookmarkIds:[],emojis:[],spaces:{},media:new Map(),linkPreviews:{[preview.url]:{...preview,image:'blob:offline'}}}}><PostLinkPreview content={preview.url}/></OfflineBookmarkContext.Provider></QueryClientProvider>);expect(screen.getByRole('link',{name:preview.title})).toBeInTheDocument();expect(invoke).not.toHaveBeenCalled();});

it('restores native metadata after remount without requesting it again',async()=>{
 invoke.mockResolvedValue({data:{preview}});const first=mount(preview.url);
 await screen.findByRole('link',{name:preview.title});first.unmount();invoke.mockClear();
 mount(preview.url);expect(screen.getByRole('link',{name:preview.title})).toBeInTheDocument();
 await waitFor(()=>expect(invoke).not.toHaveBeenCalled());
});
it('excludes Bluesky previews from reading and writing saved metadata',async()=>{
 localStorage.setItem('lime-link-previews-v1',JSON.stringify({[preview.url]:{preview:{...preview,title:'保存済みの見出し'},savedAt:Date.now()}}));
 const before=localStorage.getItem('lime-link-previews-v1');
 function Bluesky(){const state=useLinkPreview(preview.url,true,preview,false);return <LinkPreviewCard {...state}/>;}
 render(<QueryClientProvider client={new QueryClient()}><Bluesky/></QueryClientProvider>);
 expect(screen.getByRole('link',{name:preview.title})).toBeInTheDocument();
 expect(document.querySelector('[data-link-preview] img')).toHaveAttribute('src',preview.image);
 expect(screen.queryByRole('link',{name:'保存済みの見出し'})).toBeNull();
 expect(localStorage.getItem('lime-link-previews-v1')).toBe(before);expect(invoke).not.toHaveBeenCalled();
});
it('does not persist fetched Bluesky metadata',async()=>{
 invoke.mockResolvedValue({data:{preview}});
 function Bluesky(){const state=useLinkPreview(preview.url,true,undefined,false);return <LinkPreviewCard {...state}/>;}
 render(<QueryClientProvider client={new QueryClient()}><Bluesky/></QueryClientProvider>);
 await screen.findByRole('link',{name:preview.title});expect(localStorage.getItem('lime-link-previews-v1')).toBeNull();
});

it('renders and reuses title and description without an image',async()=>{
 invoke.mockResolvedValue({data:{preview:{...preview,image:'',description:'画像なしの説明'}}});const first=mount(preview.url);
 expect(await screen.findByRole('link',{name:preview.title})).toBeInTheDocument();expect(screen.getByText('画像なしの説明')).toBeInTheDocument();expect(document.querySelector('[data-link-preview] img')).toBeNull();
 first.unmount();invoke.mockClear();mount(preview.url);expect(screen.getByRole('link',{name:preview.title})).toBeInTheDocument();expect(invoke).not.toHaveBeenCalled();
});
it('retries negative metadata cached before the server request path was repaired',async()=>{
 localStorage.setItem('lime-link-previews-v1',JSON.stringify({[preview.url]:{preview:null,savedAt:Date.now(),version:2}}));invoke.mockResolvedValue({data:{preview:{...preview,image:''}}});mount(preview.url);await screen.findByRole('link',{name:preview.title});expect(invoke).toHaveBeenCalledOnce();
});
