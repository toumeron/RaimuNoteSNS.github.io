vi.mock("@/hooks/useFeed", async importOriginal => ({...await importOriginal<typeof import("@/hooks/useFeed")>(), useProfile:()=>({data:{id:'alice',username:'alice',displayName:'アリス',avatarUrl:'https://example.com/avatar.jpg',isPrivate:true,isOfficial:true}})}));
vi.mock("@/hooks/useAuth", async importOriginal => ({...await importOriginal<typeof import("@/hooks/useAuth")>(), useAuth:()=>({user:mocks.user,loading:false})}));
import {fireEvent,render,screen,waitFor,cleanup} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import WatchHistory from './WatchHistory';
import * as api from "@/api/topics";
const mocks=vi.hoisted(()=>({user:null as null|{id:string;username:string},get:vi.fn(),search:vi.fn(),episodes:vi.fn(),save:vi.fn(),inView:false,artwork:vi.fn(),trailer:vi.fn(),change:vi.fn(),resolve:vi.fn(),importSave:vi.fn()}));


vi.mock('react-intersection-observer',()=>({useInView:()=>({ref:()=>{},inView:mocks.inView})}));
vi.mock("@/api/topics", async importOriginal => ({
  ...await importOriginal<typeof import("@/api/topics")>(),
  ...await vi.importActual("@/api/topics"),
  getAnimeHistory:mocks.get,
  searchAnimeWorks:mocks.search,
  getAnimeEpisodes:mocks.episodes,
  saveAnimeViewing:mocks.save,
  changeAnimeHistory:mocks.change,
  resolveAnimeImport:mocks.resolve,
  saveAnimeImport:mocks.importSave,
  fetchAnimeArtwork:mocks.artwork,
  fetchAnimeYouTubeId:mocks.trailer
}));
const work={id:1,title:'塩対応の佐藤さんが俺にだけ甘い',aliases:[],image:'https://example.com/anime.jpg',copyright:'',season:'2026年秋',episodesCount:12};
const entry=(episode:number)=>({id:`ep:${episode}`,work,episode:{id:episode,workId:1,number:`第${episode}話`,title:`エピソード${episode}`},episodeText:`第${episode}話 エピソード${episode}`,watchedAt:'2026-10-18T00:00:00Z',addedAt:'2026-10-18T00:00:00Z',source:'manual' as const,sourceUrl:''});
const state={entries:[entry(2),entry(1)],ignored:[],autoAdd:false};
function mount(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={['/u/alice/watch-history']}><Routes><Route path="/u/:username/watch-history" element={<WatchHistory/>}/></Routes></MemoryRouter></QueryClientProvider>);}
beforeEach(()=>{mocks.trailer.mockResolvedValue(null);mocks.inView=false;mocks.artwork.mockResolvedValue({imageFallbacks:[]});mocks.resolve.mockResolvedValue({rows:[]});mocks.importSave.mockResolvedValue({state});mocks.user=null;mocks.change.mockResolvedValue({...state,entries:[]});mocks.get.mockResolvedValue(state);mocks.search.mockResolvedValue({works:[work]});mocks.episodes.mockResolvedValue({episodes:[],nextPage:null});mocks.save.mockResolvedValue({state});});
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('lets guests view public history and groups episodes into one stacked row with a title only',async()=>{
 const view=mount();await screen.findByRole('link',{name:`${work.title}をYouTubeで開く`});
 expect(mocks.get.mock.calls[0][0]).toBe('alice');expect(view.container.querySelectorAll('.anime-history-row')).toHaveLength(1);
 expect(view.container.querySelector('.anime-history-stack')).toBeTruthy();expect(screen.queryByText('第2話 エピソード2')).toBeNull();
 expect(screen.queryByRole('checkbox')).toBeNull();expect(view.container.querySelector('input[type=file]')).toBeNull();
 expect(screen.queryAllByRole('button')).toHaveLength(0);
 expect(screen.getByRole('link',{name:`${work.title}をYouTubeで開く`})).toHaveAttribute('href',`https://www.youtube.com/results?search_query=${encodeURIComponent(work.title)}`);
 expect(screen.queryByRole('dialog')).toBeNull();

});
it('does not show retry actions when public history is unavailable',async()=>{
 mocks.get.mockRejectedValue(new Error('履歴を取得できませんでした'));mount();
 expect(await screen.findByRole('alert')).toHaveTextContent('履歴を取得できませんでした');expect(screen.queryByRole('button',{name:/再試行/})).toBeNull();
});
it('shows the public owner identity with verification and lock badges instead of a search field',async()=>{
 mount();await screen.findByRole('link',{name:`${work.title}をYouTubeで開く`});
 expect(screen.getByRole('heading',{name:'アリス'})).toBeTruthy();expect(screen.getByText('@alice')).toBeTruthy();
 expect(screen.getByRole('img',{name:'認証済み'})).toHaveAttribute('src','/RaimuNoteSNS.github.io/verified.png');
 expect(screen.getByRole('img',{name:'非公開アカウント'})).toBeTruthy();expect(screen.queryByRole('search')).toBeNull();expect(screen.queryByRole('textbox')).toBeNull();expect(mocks.search).not.toHaveBeenCalled();
});
it('adds through the owner search field without a plus button or automatic-post checkbox',async()=>{
 mocks.user={id:'owner',username:'alice'};const view=mount();await screen.findByRole('link',{name:`${work.title}をYouTubeで開く`});
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

it('opens YouTube even when grouped episodes retain imported provider URLs',async()=>{
 mocks.get.mockResolvedValue({...state,entries:[{...entry(2),sourceUrl:'https://abema.tv/video/title/one'},{...entry(1),sourceUrl:'https://www.amazon.co.jp/gp/video/detail/B000123456'}]});
 mount();expect(await screen.findByRole('link',{name:`${work.title}をYouTubeで開く`})).toHaveAttribute('href',`https://www.youtube.com/results?search_query=${encodeURIComponent(`${work.title}`)}`);
 expect(screen.queryByRole('dialog')).toBeNull();
});

it('removes an entire grouped work with one owner-only mutation and no navigation or overlay',async()=>{
 mocks.user={id:'owner',username:'alice'};mount();const remove=await screen.findByRole('button',{name:`${work.title}を視聴履歴から削除`});
 expect(screen.queryByText('手動で追加')).toBeNull();fireEvent.click(remove);
 await waitFor(()=>expect(mocks.change).toHaveBeenCalledWith('owner','delete_work',{record_id:'1'}));
 await screen.findByText('まだ視聴履歴がありません。');expect(screen.queryByRole('dialog')).toBeNull();
});
it('never offers delete controls on another user public history',async()=>{
 mocks.user={id:'bob',username:'bob'};mount();await screen.findByRole('link',{name:`${work.title}をYouTubeで開く`});
 expect(screen.queryByRole('button',{name:/視聴履歴から削除/})).toBeNull();
});

it('offers tiny download and direct-extension import controls only on the owner page',async()=>{
 mocks.user={id:'owner',username:'alice'};mount();await screen.findByRole('link',{name:`${work.title}をYouTubeで開く`});
 expect(screen.getByRole('link',{name:'拡張機能をダウンロード'})).toHaveAttribute('href','/RaimuNoteSNS.github.io/extensions/anime-history.zip');
 const post=vi.spyOn(window,'postMessage').mockImplementation(()=>{});fireEvent.click(screen.getByRole('button',{name:'取り込み'}));
 expect(post).toHaveBeenCalledWith({type:'LIME_ANIME_REQUEST_TRANSFER',version:1},window.location.origin);expect(screen.queryByText('接続中…')).toBeTruthy();post.mockRestore();
});

it('keeps import confirmation to one title, selection and save without provider/date or duplicate matching labels',async()=>{
 mocks.user={id:'owner',username:'alice'};
 const wataten={...work,id:6130,title:'私に天使が舞い降りた！'},item={title:'TVアニメ 私に天使が舞い降りた！ （字幕版）',episodeText:'',watchedAt:null,source:'abema',sourceUrl:'https://abema.tv/video/title/1-2'};
 const row={item,work:wataten,episode:null,candidates:[wataten],ambiguous:false};mocks.resolve.mockResolvedValue({rows:[row]});
 mount();await screen.findByRole('link',{name:`${work.title}をYouTubeで開く`});
 fireEvent(window,new MessageEvent('message',{data:{type:'LIME_ANIME_TRANSFER',version:1,items:[item]},source:window,origin:window.location.origin}));
 await screen.findByRole('checkbox',{name:'私に天使が舞い降りた！を取り込む'});
 expect(screen.getAllByText('私に天使が舞い降りた！')).toHaveLength(1);expect(screen.queryByText('ABEMA')).toBeNull();expect(screen.queryByText('視聴日時不明')).toBeNull();expect(screen.queryByText('作品未照合・確認が必要です')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'取り込む'}));await waitFor(()=>expect(mocks.importSave).toHaveBeenCalledWith('owner',[row]));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});
it('retains a compact manual correction action for ambiguous imports',async()=>{
 mocks.user={id:'owner',username:'alice'};const item={title:'私に天使が舞い降りた！',episodeText:'',watchedAt:null,source:'abema',sourceUrl:'https://abema.tv/video/title/1-2'};
 mocks.resolve.mockResolvedValue({rows:[{item,work:null,episode:null,candidates:[],ambiguous:true}]});mount();await screen.findByRole('link',{name:`${work.title}をYouTubeで開く`});
 fireEvent(window,new MessageEvent('message',{data:{type:'LIME_ANIME_TRANSFER',version:1,items:[item]},source:window,origin:window.location.origin}));
 const choose=await screen.findByRole('button',{name:'私に天使が舞い降りた！の作品を選ぶ'});expect(screen.queryByRole('checkbox')).toBeNull();expect(screen.getByRole('button',{name:'取り込む'})).toBeDisabled();fireEvent.click(choose);await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(screen.getByRole('textbox')).toHaveValue(item.title);
});

it('replaces saved parking artwork without first requesting or displaying the ad image',async()=>{
 mocks.inView=true;const safe='https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/7227.jpg';
 const badWork={...work,id:7227,title:'ひげを剃る。そして女子高生を拾う。',image:'https://www.onamae.com/backorder/images/ogimage.jpg'};
 mocks.get.mockResolvedValue({...state,entries:[{...entry(1),work:badWork}]});mocks.artwork.mockResolvedValue({imageFallbacks:[safe]});
 const view=mount();const img=await screen.findByRole('img',{name:badWork.title});expect(img).toHaveAttribute('src',safe);expect(view.container.querySelector('img[src*=onamae]')).toBeNull();
});
