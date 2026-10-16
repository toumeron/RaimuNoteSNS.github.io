import {fireEvent,render,screen,waitFor,cleanup} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import WatchHistory from './WatchHistory';
import * as api from '@/api/watchHistory';
const mocks=vi.hoisted(()=>({user:null as null|{id:string;username:string},get:vi.fn(),search:vi.fn(),episodes:vi.fn(),save:vi.fn(),change:vi.fn()}));
vi.mock('@/hooks/useProfile',()=>({useProfile:()=>({data:{id:'alice',username:'alice',displayName:'アリス',avatarUrl:'https://example.com/avatar.jpg',isPrivate:true,isOfficial:true}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:mocks.user,loading:false})}));
vi.mock('react-intersection-observer',()=>({useInView:()=>({ref:()=>{},inView:false})}));
vi.mock('@/api/watchHistory',async()=>({...await vi.importActual('@/api/watchHistory'),getAnimeHistory:mocks.get,searchAnimeWorks:mocks.search,getAnimeEpisodes:mocks.episodes,saveAnimeViewing:mocks.save,changeAnimeHistory:mocks.change}));
const work={id:1,title:'塩対応の佐藤さんが俺にだけ甘い',aliases:[],image:'https://example.com/anime.jpg',copyright:'',season:'2026年秋',episodesCount:12};
const entry=(episode:number)=>({id:`ep:${episode}`,work,episode:{id:episode,workId:1,number:`第${episode}話`,title:`エピソード${episode}`},episodeText:`第${episode}話 エピソード${episode}`,watchedAt:'2026-10-18T00:00:00Z',addedAt:'2026-10-18T00:00:00Z',source:'manual' as const,sourceUrl:''});
const state={entries:[entry(2),entry(1)],ignored:[],autoAdd:false};
function mount(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={['/u/alice/watch-history']}><Routes><Route path="/u/:username/watch-history" element={<WatchHistory/>}/></Routes></MemoryRouter></QueryClientProvider>);}
beforeEach(()=>{mocks.user=null;mocks.change.mockResolvedValue({...state,entries:[]});mocks.get.mockResolvedValue(state);mocks.search.mockResolvedValue({works:[work]});mocks.episodes.mockResolvedValue({episodes:[],nextPage:null});mocks.save.mockResolvedValue({state});});
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('lets guests view public history and groups episodes into one stacked row with a title only',async()=>{
 const view=mount();await screen.findByRole('link',{name:`${work.title}を配信サービスで開く`});
 expect(mocks.get.mock.calls[0][0]).toBe('alice');expect(view.container.querySelectorAll('.anime-history-row')).toHaveLength(1);
 expect(view.container.querySelector('.anime-history-stack')).toBeTruthy();expect(screen.queryByText('第2話 エピソード2')).toBeNull();
 expect(screen.queryByRole('checkbox')).toBeNull();expect(view.container.querySelector('input[type=file]')).toBeNull();
 expect(screen.queryAllByRole('button')).toHaveLength(0);
 expect(screen.getByRole('link',{name:`${work.title}を配信サービスで開く`})).toHaveAttribute('href',`https://www.amazon.co.jp/s?i=instant-video&k=${encodeURIComponent(work.title)}`);
 expect(screen.queryByRole('dialog')).toBeNull();

});
it('does not show retry actions when public history is unavailable',async()=>{
 mocks.get.mockRejectedValue(new Error('履歴を取得できませんでした'));mount();
 expect(await screen.findByRole('alert')).toHaveTextContent('履歴を取得できませんでした');expect(screen.queryByRole('button',{name:/再試行/})).toBeNull();
});
it('shows the public owner identity with verification and lock badges instead of a search field',async()=>{
 mount();await screen.findByRole('link',{name:`${work.title}を配信サービスで開く`});
 expect(screen.getByRole('heading',{name:'アリス'})).toBeTruthy();expect(screen.getByText('@alice')).toBeTruthy();
 expect(screen.getByRole('img',{name:'認証済み'})).toHaveAttribute('src','/RaimuNoteSNS.github.io/verified.png');
 expect(screen.getByRole('img',{name:'非公開アカウント'})).toBeTruthy();expect(screen.queryByRole('search')).toBeNull();expect(screen.queryByRole('textbox')).toBeNull();expect(mocks.search).not.toHaveBeenCalled();
});
it('adds through the owner search field without a plus button or automatic-post checkbox',async()=>{
 mocks.user={id:'owner',username:'alice'};const view=mount();await screen.findByRole('link',{name:`${work.title}を配信サービスで開く`});
 const input=screen.getByRole('textbox');fireEvent.focus(input);fireEvent.change(input,{target:{value:'塩対応'}});
 await waitFor(()=>expect(mocks.search).toHaveBeenCalled());fireEvent.click(await screen.findByRole('button',{name:/塩対応の佐藤さんが俺にだけ甘い.*2026年秋/}));
 await screen.findByRole('combobox');fireEvent.click(screen.getByRole('button',{name:'視聴履歴に追加'}));
 await waitFor(()=>expect(mocks.save).toHaveBeenCalled());expect(mocks.save.mock.calls[0][0]).toBe('owner');
 expect(view.container.querySelector('input[type=file]')).toBeNull();expect(screen.queryByRole('checkbox')).toBeNull();expect(screen.queryByText('@alice')).toBeNull();
});
it('keeps separate works separate even when their display titles are identical',()=>{
 const groups=api.groupAnimeHistory([entry(2),{...entry(1),work:{...work,id:2}},entry(3)]);
 expect(groups.map(group=>group.entries.length)).toEqual([2,1]);expect(groups[0].entries.map(row=>row.episode?.id)).toEqual([2,3]);
});

it('uses the highest-priority actual provider URL from any episode in a grouped work',async()=>{
 mocks.get.mockResolvedValue({...state,entries:[{...entry(2),sourceUrl:'https://abema.tv/video/title/one'},{...entry(1),sourceUrl:'https://www.amazon.co.jp/gp/video/detail/B000123456'}]});
 mount();expect(await screen.findByRole('link',{name:`${work.title}を配信サービスで開く`})).toHaveAttribute('href','https://www.amazon.co.jp/gp/video/detail/B000123456');
 expect(screen.queryByRole('dialog')).toBeNull();
});

it('removes an entire grouped work with one owner-only mutation and no navigation or overlay',async()=>{
 mocks.user={id:'owner',username:'alice'};mount();const remove=await screen.findByRole('button',{name:`${work.title}を視聴履歴から削除`});
 expect(screen.queryByText('手動で追加')).toBeNull();fireEvent.click(remove);
 await waitFor(()=>expect(mocks.change).toHaveBeenCalledWith('owner','delete_work',{record_id:'1'}));
 await screen.findByText('まだ視聴履歴がありません。');expect(screen.queryByRole('dialog')).toBeNull();
});
it('never offers delete controls on another user public history',async()=>{
 mocks.user={id:'bob',username:'bob'};mount();await screen.findByRole('link',{name:`${work.title}を配信サービスで開く`});
 expect(screen.queryByRole('button',{name:/視聴履歴から削除/})).toBeNull();
});

it('offers tiny download and direct-extension import controls only on the owner page',async()=>{
 mocks.user={id:'owner',username:'alice'};mount();await screen.findByRole('link',{name:`${work.title}を配信サービスで開く`});
 expect(screen.getByRole('link',{name:'拡張機能をダウンロード'})).toHaveAttribute('href','/RaimuNoteSNS.github.io/extensions/anime-history.zip');
 const post=vi.spyOn(window,'postMessage').mockImplementation(()=>{});fireEvent.click(screen.getByRole('button',{name:'取り込み'}));
 expect(post).toHaveBeenCalledWith({type:'LIME_ANIME_REQUEST_TRANSFER',version:1},window.location.origin);expect(screen.queryByText('接続中…')).toBeTruthy();post.mockRestore();
});
