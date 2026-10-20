// @vitest-environment node
import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {AnnictCatalog,animeEntry,animeEpisodeNumber,animeService,animeTitleQueries,exactAnimeWork,matchImportedAnimeWork,animeImportSearchQueries,importWorkTitle,fetchAnimeArtwork,fetchAnimeYouTubeId,animeYouTubeUrl,animeArtworkUrl,mentionedAnime,parseAnimeImport,type AnimeWork} from '../../supabase/functions/_shared/animeHistory';
import {createAnimeHistoryHandler} from '../../supabase/functions/anime-history/handler';
const work:AnimeWork={id:10079,title:'葬送のフリーレン',aliases:['葬送のフリーレン','#frieren'],image:'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/frieren.jpg',copyright:'',season:'2023年秋',episodesCount:28};
const apiWork={id:10079,title:work.title,twitter_hashtag:'frieren',images:{recommended_url:work.image},season_name_text:work.season,episodes_count:28};
afterEach(()=>vi.restoreAllMocks());
it('matches canonical titles and hashtags without accepting a shorter overlapping sequel or unrelated short word',()=>{
 const sequel={...work,id:200,title:work.title+' 第2期',aliases:[work.title+' 第2期']};
 expect(mentionedAnime('「葬送のフリーレン 第2期」第3話',[work,sequel]).map(w=>w.id)).toEqual([200]);
 expect(mentionedAnime('#frieren を観た',[work])).toEqual([work]);
 expect(mentionedAnime('chairs',[{...work,id:4,title:'AIR',aliases:['AIR']}])).toEqual([]);
});
it('does not guess between identically named remakes and distinguishes season numbers from episodes',()=>{
 expect(exactAnimeWork(work.title,[work,{...work,id:200}])).toBeNull();
 expect(animeEpisodeNumber('第2期')).toBeNull();expect(animeEpisodeNumber('第３話 母と子')).toBe('3');expect(animeEpisodeNumber('Episode 4')).toBe('4');
 expect(animeTitleQueries('「葬送のフリーレン」第3話を観た')).toContain(work.title);
});
it('validates transfer format, service ownership and unknown dates while removing tracking parameters',()=>{
 const item={title:work.title,episodeText:'第1話',watchedAt:null,source:'danime',sourceUrl:'https://animestore.docomo.ne.jp/animestore/ci_pc?workId=123&token=private'};
 const [parsed]=parseAnimeImport({format:'limenote-anime-history',version:1,items:[item,item]});expect(parsed.watchedAt).toBeNull();expect(parsed.sourceUrl).toBe('https://animestore.docomo.ne.jp/animestore/ci_pc?workId=123');
 expect(()=>parseAnimeImport({format:'limenote-anime-history',version:1,items:[{...item,sourceUrl:'https://evil.example/'}]})).toThrow();
 expect(animeService('https://abema.tv.evil.example/video/episode/one')).toBeNull();
 expect(animeEntry(work,null,{source:'manual'}).watchedAt).toBeNull();
});
it('uses fixed Annict endpoints, header authentication and an on-demand cache',async()=>{
 const fetcher=vi.fn(async()=>Response.json({works:[apiWork]}));const catalog=new AnnictCatalog('fixture-token',fetcher as typeof fetch);
 expect((await catalog.search(work.title))[0].id).toBe(work.id);await catalog.search(work.title);expect(fetcher).toHaveBeenCalledTimes(1);
 const [url,options]=fetcher.mock.calls[0] as any;expect(new URL(url).origin).toBe('https://api.annict.com');expect(new URL(url).searchParams.has('access_token')).toBe(false);expect(options.headers.Authorization).toBe('Bearer fixture-token');
});
it('tries independent artwork providers without forwarding credentials and rejects a different season',async()=>{
 const fetcher=vi.fn(async(url:any,options?:any)=>{
  expect(options?.headers?.Authorization).toBeUndefined();
  return String(url).includes('anilist')?Response.json({data:{Page:{media:[{title:{native:work.title},seasonYear:2026,bannerImage:'https://bad.example/sequel.jpg'}]}}}):Response.json({data:[{title_japanese:work.title,year:2023,images:{webp:{large_image_url:'https://cdn.myanimelist.net/images/anime/frieren.webp'}},url:'https://myanimelist.net/anime/52991'}]});
 });
 const images=await fetchAnimeArtwork(work,fetcher as typeof fetch);expect(images.imageFallbacks).toEqual(['https://cdn.myanimelist.net/images/anime/frieren.webp']);expect(fetcher).toHaveBeenCalledTimes(2);
});
it('uses matching AniList banner and cover images and tolerates independent provider outages',async()=>{
 const images=await fetchAnimeArtwork(work,async()=>Response.json({data:{Page:{media:[{title:{native:work.title},seasonYear:2023,bannerImage:'https://s4.anilist.co/file/anilistcdn/media/anime/banner/frieren.jpg',coverImage:{extraLarge:'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/frieren.jpg'},siteUrl:'https://anilist.co/anime/154587'}]}}}));
 expect(images.imageFallbacks).toHaveLength(2);expect(images.imageCredits?.[0].name).toBe('AniList');
 expect((await fetchAnimeArtwork(work,async()=>{throw new Error('offline');})).imageFallbacks).toEqual([]);
});
function fixture(){
 const catalog=new AnnictCatalog('fixture',vi.fn(async()=>Response.json({works:[apiWork]})) as typeof fetch),rpc=vi.fn(async(_name:string,_args:Record<string,any>)=>({data:{entries:[],ignored:[],autoAdd:true},error:null}));
 const authenticate=vi.fn(async()=>({userId:'owner'} as {userId:string}|Response));
 const handler=createAnimeHistoryHandler({catalog,authenticate,limit:async()=>null,client:()=>({rpc})});return {handler,catalog,rpc,authenticate};
}
const call=(handler:ReturnType<typeof createAnimeHistoryHandler>,body:unknown)=>handler(new Request('https://local.test/anime-history',{method:'POST',body:JSON.stringify(body)}));
it('rejects unauthenticated or oversized requests before reading catalog or private history',async()=>{
 const f=fixture();f.authenticate.mockResolvedValue(new Response(null,{status:401}));expect((await call(f.handler,{op:'search',query:'フリーレン'})).status).toBe(401);expect(f.rpc).not.toHaveBeenCalled();
 expect((await call(f.handler,{op:'search',query:'x'.repeat(300000)})).status).toBe(400);
});
it('saves canonical Annict data instead of caller-supplied titles and keeps manual provenance',async()=>{
 const f=fixture();expect((await call(f.handler,{op:'save',workId:work.id,work:{title:'forged'},watchedAt:'2020-01-01T00:00:00Z'})).status).toBe(200);
 const record=f.rpc.mock.calls[0][1].records[0];expect(record.work.title).toBe(work.title);expect(record.source).toBe('manual');
});
const extractor=readFileSync('extensions/anime-history/extractor.js','utf8');
for(const [host,path,link] of [['www.primevideo.com','/settings/watch-history','/detail/B000123456'],['animestore.docomo.ne.jp','/animestore/history','/animestore/ci_pc?workId=123'],['www.nicovideo.jp','/my/history','/watch/so123456'],['abema.tv','/my-list/history','/video/episode/123-1_s1_p1']]){
 it(`extracts only visible history cards from ${host} without fabricating viewing dates`,()=>{
  const dom=new JSDOM(`<main><h1>視聴履歴</h1><article><a href="${link}"><img alt="葬送のフリーレン"><h2>葬送のフリーレン</h2></a><time datetime="2026-10-18">配信日時</time></article><aside><a href="${link}">おすすめ</a></aside></main>`,{url:`https://${host}${path}`});
  const data=vm.runInNewContext(extractor,{document:dom.window.document,location:dom.window.location,URL,URLSearchParams,Date});expect(data.items).toHaveLength(1);expect(data.items[0].watchedAt).toBeNull();expect(parseAnimeImport(data)).toHaveLength(1);dom.window.close();
 });
}
it('refuses collection on a catalog or unsupported host',()=>{
 for(const url of ['https://abema.tv/video','https://evil.example/my/history']){const dom=new JSDOM('<main><a href="/video/episode/123">作品</a></main>',{url});const result=vm.runInNewContext(extractor,{document:dom.window.document,location:dom.window.location,URL,URLSearchParams,Date});expect(result.error).toBeTruthy();expect(result.items??[]).toHaveLength(0);dom.window.close();}
});
it('expands nickname suggestions through Wikidata and AniList, then deduplicates verified Annict IDs',async()=>{
 const bocchi={...apiWork,id:999,title:'ぼっち・ざ・ろっく！',season_name_text:'2022年秋'};
 const fetcher=vi.fn(async(input:any,options?:any)=>{
  const url=new URL(String(input));
  if(url.hostname==='api.annict.com')return Response.json({works:url.searchParams.get('filter_title')===bocchi.title?[bocchi,{...bocchi,id:1000,title:'似た別作品'}]:[]});
  expect(options?.headers?.Authorization).toBeUndefined();expect(String(input)).not.toContain('fixture-token');
  if(url.hostname==='www.wikidata.org')return Response.json({search:[{label:bocchi.title,aliases:['ぼざろ'],match:{text:'ぼざろ'}},{label:bocchi.title,aliases:['ぼざろ']}]});
  expect(url.hostname).toBe('graphql.anilist.co');return Response.json({data:{Page:{media:[{title:{native:bocchi.title,english:'BOCCHI THE ROCK!'},synonyms:['BTR'],seasonYear:2022}]}}});
 });
 const catalog=new AnnictCatalog('fixture-token',fetcher as typeof fetch);
 const results=await catalog.suggest('ぼざろ');expect(results.map(row=>row.id)).toEqual([999]);expect(results[0].aliases).toContain('ぼざろ');expect(results[0].aliases).toContain('BTR');
 const count=fetcher.mock.calls.length;await catalog.suggest('ぼざろ');expect(fetcher).toHaveBeenCalledTimes(count);
});
it('retains direct Annict results when independent suggestion providers fail',async()=>{
 const fetcher=vi.fn(async(input:any)=>{if(new URL(String(input)).hostname==='api.annict.com')return Response.json({works:[apiWork]});throw new Error('offline');});
 expect((await new AnnictCatalog('fixture',fetcher as typeof fetch).suggest(work.title)).map(row=>row.id)).toEqual([work.id]);
});
it('uses AniList independently and rejects a wrong-year match without treating fuzzy search text as an alias',async()=>{
 const fetcher=vi.fn(async(input:any)=>{
  const url=new URL(String(input));if(url.hostname==='www.wikidata.org')return new Response(null,{status:429});
  if(url.hostname==='graphql.anilist.co')return Response.json({data:{Page:{media:[{title:{native:work.title},synonyms:['Frieren'],seasonYear:2026}]}}});
  return Response.json({works:url.searchParams.get('filter_title')===work.title?[apiWork]:[]});
 });
 expect(await new AnnictCatalog('fixture',fetcher as typeof fetch).suggest('fuzzy')).toEqual([]);
});

it('links only to YouTube using a validated trailer ID or an encoded title search',()=>{
 expect(animeYouTubeUrl(work,'nFljVg8xELU')).toBe('https://www.youtube.com/watch?v=nFljVg8xELU');
 for(const bad of [null,'https://evil.example/','x&redirect=evil'])expect(animeYouTubeUrl(work,bad)).toBe(`https://www.youtube.com/results?search_query=${encodeURIComponent(`${work.title}`)}`);
});
it('uses a trailer only for the matching anime and year, tolerating missing trailers or provider failure',async()=>{
 const data={data:{Page:{media:[{title:{native:work.title},seasonYear:2023,trailer:{id:'nFljVg8xELU',site:'youtube'}}]}}};
 expect(await fetchAnimeYouTubeId(work,async()=>Response.json(data))).toBe('nFljVg8xELU');data.data.Page.media[0].seasonYear=2026;expect(await fetchAnimeYouTubeId(work,async()=>Response.json(data))).toBeNull();
 data.data.Page.media[0].seasonYear=2023;data.data.Page.media[0].trailer.site='other';expect(await fetchAnimeYouTubeId(work,async()=>Response.json(data))).toBeNull();
 expect(await fetchAnimeYouTubeId(work,async()=>{throw Error('offline')})).toBeNull();
});

const extractFixture=(url:string,html:string)=>{const dom=new JSDOM(html,{url});try{return vm.runInNewContext(extractor,{document:dom.window.document,location:dom.window.location,URL,URLSearchParams,Date,getComputedStyle:dom.window.getComputedStyle.bind(dom.window)});}finally{dom.window.close();}};
it('reads Prime Video gp/video/detail links, sibling titles, and data-ASIN history rows',()=>{
 const result=extractFixture('https://www.amazon.co.jp/gp/video/settings/watch-history',`<main><h1>視聴履歴</h1><article><a href="https://www.primevideo.com/gp/video/detail/B012345678?ref=private"><img alt="ぼっち・ざ・ろっく！"></a><h3>ぼっち・ざ・ろっく！</h3><div data-episode-title>第2話</div></article><article data-asin="B987654321"><h3>葬送のフリーレン</h3><img alt="葬送のフリーレン"></article></main>`);
 expect(result.items).toHaveLength(2);expect(result.items[0].sourceUrl).toBe('https://www.primevideo.com/gp/video/detail/B012345678');expect(result.items[0].episodeText).toBe('第2話');expect(result.items[1].sourceUrl).toBe('https://www.primevideo.com/detail/B987654321');
});
it('reads the selected ABEMA history panel and click-handler cards without importing the hidden my-list',()=>{
 const result=extractFixture('https://abema.tv/my-list',`<main><button role="tab" aria-selected="true" aria-controls="history">視聴履歴</button><section id="history" role="tabpanel"><div><img src="https://images.abema.tv/image/programs/26-123_s1_p2/thumb001.png" alt="ぼっち・ざ・ろっく！"><p>第2話</p></div><a href="/video/episode/26-124_s1_p1" hidden><img alt="隠れた作品"></a></section><section hidden><a href="/video/title/26-999">未視聴マイリスト</a></section></main>`);
 expect(result.items).toHaveLength(1);expect(result.items[0].title).toBe('ぼっち・ざ・ろっく！');expect(result.items[0].sourceUrl).toBe('https://abema.tv/video/episode/26-123_s1_p2');
});
it('recognizes d-anime rireki_pc and sc_d_pc episode links',()=>{
 const result=extractFixture('https://animestore.docomo.ne.jp/animestore/rireki_pc',`<main><div><a href="/animestore/sc_d_pc?partId=12345&token=private"><img alt="葬送のフリーレン 第3話"></a></div></main>`);
 expect(result.items).toHaveLength(1);expect(result.items[0].sourceUrl).toBe('https://animestore.docomo.ne.jp/animestore/sc_d_pc?partId=12345');
});
it('recognizes Nico history title classes while excluding recommended and hidden cards',()=>{
 const result=extractFixture('https://www.nicovideo.jp/my/history/video',`<main><div class="WatchHistoryItem"><a href="/watch/so12345"><img></a><p class="video-title">ぼっち・ざ・ろっく！ 第1話</p></div><aside><a href="/watch/so999">おすすめ</a></aside><article style="display:none"><a href="/watch/so111">非表示</a></article></main>`);
 expect(result.items).toHaveLength(1);expect(result.items[0].title).toContain('ぼっち・ざ・ろっく');
});
it('also imports watchlists without inventing viewing dates',()=>{
 const prime=extractFixture('https://www.primevideo.com/region/fe/watchlist','<main><h1>ウォッチリスト</h1><article><a href="/detail/B12345678"><img alt="ぼっち・ざ・ろっく！"></a><time data-watched-at="2026-10-18">追加日</time></article></main>');
 expect(prime.items).toHaveLength(1);expect(prime.items[0].watchedAt).toBeNull();
 const abema=extractFixture('https://abema.tv/my-list','<main><h1>マイリスト</h1><article><img src="https://images.abema.tv/image/series/26-123/thumb.png" alt="ぼっち・ざ・ろっく！"></article></main>');
 expect(abema.items).toHaveLength(1);expect(abema.items[0].sourceUrl).toBe('https://abema.tv/video/title/26-123');expect(abema.items[0].watchedAt).toBeNull();
});
it('shows extraction errors and a working service-history shortcut instead of losing the injected error',async()=>{
 const dom=new JSDOM(readFileSync('extensions/anime-history/popup.html','utf8'),{url:'chrome-extension://fixture/popup.html'});
 const chrome={storage:{local:{get:vi.fn(async()=>({})),set:vi.fn(async()=>{})}},tabs:{query:vi.fn(async()=>[{id:1}]),update:vi.fn(async()=>{})},scripting:{executeScript:vi.fn(async()=>[{result:{error:'履歴かウォッチリストを開いてください',historyUrl:'https://www.primevideo.com/settings/watch-history'}}])}};
 await new Function('chrome','document',`return (async()=>{${readFileSync('extensions/anime-history/popup.mjs','utf8')}})()`)(chrome,dom.window.document);
 dom.window.document.getElementById('collect')!.click();await vi.waitFor(()=>expect(dom.window.document.getElementById('status')!.textContent).toContain('履歴かウォッチリスト'));
 expect(dom.window.document.getElementById('open-history')!.hidden).toBe(false);dom.window.document.getElementById('open-history')!.click();await vi.waitFor(()=>expect(chrome.tabs.update).toHaveBeenCalledWith(1,{url:'https://www.primevideo.com/settings/watch-history'}));dom.window.close();
});
it('allows the direct-import bridge only on a LimeNote history page and checks message origin',async()=>{
 const dom=new JSDOM('',{url:'http://localhost:8080/RaimuNoteSNS.github.io/u/alice/watch-history'}),window=dom.window;
 const items=[{title:work.title,source:'primevideo',sourceUrl:'https://www.primevideo.com/detail/B12345678',watchedAt:null,episodeText:''}];
 const sendMessage=vi.fn(async()=>({ok:true,items})),post=vi.spyOn(window,'postMessage').mockImplementation(()=>{});
 const result=vm.runInNewContext(extractor,{window,document:window.document,location:window.location,chrome:{runtime:{sendMessage}},URL,URLSearchParams,Date});expect(result.bridge).toBe(true);
 window.dispatchEvent(new window.MessageEvent('message',{source:window,origin:'https://evil.example',data:{type:'LIME_ANIME_REQUEST_TRANSFER',version:1}}));expect(sendMessage).not.toHaveBeenCalled();
 window.dispatchEvent(new window.MessageEvent('message',{source:window,origin:window.location.origin,data:{type:'LIME_ANIME_REQUEST_TRANSFER',version:1}}));await vi.waitFor(()=>expect(post).toHaveBeenCalledWith({type:'LIME_ANIME_TRANSFER',version:1,items},window.location.origin));dom.window.close();
});
it('does not expose extension storage to a different origin or unrelated LimeNote page',async()=>{
 let receive:any;const reply=vi.fn(),get=vi.fn(async()=>({'anime-history-transfer-v1':[{title:'test'}]}));
 const chrome={runtime:{id:'fixture',onMessage:{addListener:(handler:any)=>{receive=handler;}}},storage:{local:{get}}};
 vm.runInNewContext(readFileSync('extensions/anime-history/service-worker.mjs','utf8'),{chrome,URL,setTimeout,clearTimeout});
 receive({type:'read-transfer'},{id:'fixture',url:'https://evil.example/RaimuNoteSNS.github.io/watch-history'},reply);
 receive({type:'read-transfer'},{id:'fixture',url:'https://toumeron.github.io/unrelated'},reply);expect(get).not.toHaveBeenCalled();
 receive({type:'read-transfer'},{id:'fixture',url:'http://localhost:8080/RaimuNoteSNS.github.io/u/alice/watch-history'},reply);await vi.waitFor(()=>expect(reply).toHaveBeenCalledWith({ok:true,items:[{title:'test'}]}));
});

it('preserves Japanese punctuation for Annict import queries and removes only episode/service decorations',()=>{
 expect(importWorkTitle({title:'私に天使が舞い降りた！'})).toBe('私に天使が舞い降りた！');
 expect(importWorkTitle({title:'TVアニメ 私に天使が舞い降りた！ 第３話'})).toBe('私に天使が舞い降りた！');
 expect(importWorkTitle({title:'私に天使が舞い降りた！ （字幕版）'})).toBe('私に天使が舞い降りた！');
 expect(animeImportSearchQueries({title:'私に天使が舞い降りた! 第1話'})).toContain('私に天使が舞い降りた');
});
it('resolves Wataten even when Annict distinguishes full-width and ASCII punctuation, without choosing its movie or OVA',async()=>{
 const tv={...apiWork,id:6130,title:'私に天使が舞い降りた！'},movie={...apiWork,id:8122,title:'私に天使が舞い降りた！プレシャス・フレンズ'},ova={...apiWork,id:7340,title:'私に天使が舞い降りた！OVA「私がお姉ちゃんだよ」'};
 const fetcher=vi.fn(async(input:any)=>{const url=new URL(String(input));if(url.hostname!=='api.annict.com')throw Error('External search not needed');return Response.json({works:url.searchParams.get('filter_title')==='私に天使が舞い降りた!'?[]:[ova,tv,movie]});});
 const catalog=new AnnictCatalog('fixture',fetcher as typeof fetch);
 const result=await catalog.resolveImport({title:'私に天使が舞い降りた!',episodeText:'',watchedAt:null,source:'abema',sourceUrl:'https://abema.tv/video/title/1-2'});
 expect(result.work?.id).toBe(6130);expect(result.ambiguous).toBe(false);expect(fetcher).toHaveBeenCalledTimes(2);
});
it('matches season spelling variants, retains explicit sequels, and refuses identical-title remakes',()=>{
 const one={...work,id:1,title:'テストアニメ',aliases:['テストアニメ']},two={...work,id:2,title:'テストアニメ 第2期',aliases:['テストアニメ 第2期']};
 expect(matchImportedAnimeWork('テストアニメ シーズン1',[one,two])?.id).toBe(1);
 expect(matchImportedAnimeWork('テストアニメ Season 2',[one,two])?.id).toBe(2);
 expect(matchImportedAnimeWork('テストアニメ 2nd Season',[one])?.id).toBeUndefined();
 expect(matchImportedAnimeWork('テストアニメ',[one,{...one,id:3}])).toBeNull();
 expect(matchImportedAnimeWork('けいおん!!',[{...one,title:'けいおん!',aliases:['けいおん!']},{...two,title:'けいおん!!',aliases:['けいおん!!']}])?.id).toBe(2);
});
it('uses expanded external aliases for import resolution when ordinary Annict title search finds nothing',async()=>{
 const catalog=new AnnictCatalog('fixture',async()=>Response.json({works:[]}));
 vi.spyOn(catalog,'suggest').mockResolvedValue([{...work,aliases:[...work.aliases,'フリーレン略称']}]);
 const result=await catalog.resolveImport({title:'フリーレン略称',episodeText:'',watchedAt:null,source:'primevideo',sourceUrl:'https://www.primevideo.com/detail/B12345678'});
 expect(result.work?.id).toBe(work.id);
});
it('routes import resolution through the corrected matcher while leaving resolution read-only',async()=>{
 const f=fixture(),item={title:work.title,episodeText:'',watchedAt:null,source:'abema',sourceUrl:'https://abema.tv/video/title/1-2'};
 const response=await call(f.handler,{op:'resolve',items:[item]});expect(response.status).toBe(200);const data=await response.json();expect(data.rows[0].work.id).toBe(work.id);expect(f.rpc).not.toHaveBeenCalled();
});

it('rejects parking and unverified official-site images even when HTTPS and HTTP 200 would succeed',()=>{
 for(const url of ['https://www.onamae.com/backorder/images/ogimage.jpg','https://old-anime.example/ogp.jpg','https://s4.anilist.co.evil.test/file/anilistcdn/media/anime/banner/1.jpg','https://s4.anilist.co/file/anilistcdn/user/avatar/1.jpg','https://cdn.myanimelist.net/images/userimages/1.jpg'])expect(animeArtworkUrl(url)).toBe('');
 expect(animeArtworkUrl(work.image)).toBe(work.image);expect(animeArtworkUrl('https://cdn.myanimelist.net/images/anime/1/2.jpg')).toBeTruthy();
});
it('does not adopt Annict official-site or parking OG images as canonical work artwork',async()=>{
 const catalog=new AnnictCatalog('fixture',async()=>Response.json({works:[{...apiWork,images:{facebook:{og_image_url:'https://www.onamae.com/backorder/images/ogimage.jpg'},recommended_url:'https://old-anime.example/ogp.jpg'}}]}));
 expect((await catalog.work(work.id)).image).toBe('');expect((await catalog.search(work.title))[0].image).toBe('');
});
it('rejects advertising URLs in provider metadata and falls back to verified Jikan anime images',async()=>{
 const fetcher=vi.fn(async(url:any)=>String(url).includes('anilist')?Response.json({data:{Page:{media:[{title:{native:work.title},seasonYear:2023,bannerImage:'https://www.onamae.com/backorder/images/ogimage.jpg'}]}}}):Response.json({data:[{title_japanese:work.title,year:2023,images:{jpg:{large_image_url:'https://cdn.myanimelist.net/images/anime/1/2.jpg'}},url:'https://myanimelist.net/anime/52991'}]}));
 const result=await fetchAnimeArtwork(work,fetcher as typeof fetch);expect(result.imageFallbacks).toEqual(['https://cdn.myanimelist.net/images/anime/1/2.jpg']);expect(result.imageCredits?.[0].name).toBe('MyAnimeList / Jikan');expect(fetcher).toHaveBeenCalledTimes(2);
});

it('shares a single catalog lookup between artwork and YouTube metadata',async()=>{
 const shared={...work,id:998877};const fetcher=vi.fn(async()=>Response.json({data:{Page:{media:[{title:{native:shared.title},seasonYear:2023,bannerImage:shared.image,trailer:{id:'nFljVg8xELU',site:'youtube'}}]}}}));
 vi.stubGlobal('fetch',fetcher);
 try{const [artwork,id]=await Promise.all([fetchAnimeArtwork(shared),fetchAnimeYouTubeId(shared)]);expect(artwork.imageFallbacks).toEqual([shared.image]);expect(id).toBe('nFljVg8xELU');expect(fetcher).toHaveBeenCalledTimes(1);}finally{vi.unstubAllGlobals();}
});
