import { afterEach, beforeEach, expect, it, vi, describe } from "vitest";
import fixtures from "@/lib/fixtures/recommendationVisual.json";
import { classifyRecommendationVisual } from "@/lib/recommendationVisual";
import { parseRecommendationCatalog, RECOMMENDATION_CATALOG_MAX_AGE, applyCatalogRecommendationVisuals } from "@/lib/recommendations";
import { classifyTrendCategory, prepareExploreTrends, rankPersonalTrends } from "@/lib/topics";
import { parseGoogleTrends, parseGoogleTrendingPage } from "./../../supabase/functions/get-trends/trends.ts";
import { type PostWithAuthor } from "@/types/index";
import { searchProviderBatch } from "@/api/search-news";
import { matchMarketAsset, suggestMarketAssets, parseMarketChart } from "./../../supabase/functions/market-data/http.ts";
import prototypes from "@/lib/recommendationVisualPrototypes.json";
import { enrichRecommendationVisuals, idleRecommendationVisualWorker, releaseRecommendationVisualWorker, warmRecommendationVisualWorker } from "@/lib/recommendationVisualInference";

describe("recommendationCatalog", () => {
const now=Date.parse('2026-10-17T00:00:00Z');
const visual=classifyRecommendationVisual(fixtures.find(row=>row.name==='original-moe')!.vector);
const post={id:'x:2110766445940572599',userId:'x-user:123',source:'x',visibility:'public',author:{id:'x-user:123',username:'creator@twitter.com'},content:'',imageUrls:['https://pbs.twimg.com/media/work.jpg'],createdAt:new Date(now).toISOString(),recommendationVisual:visual};
const catalog=(extra={})=>({version:1,model:'Xenova/clip-vit-base-patch32',revision:'d15189d7028b43f1d3e65039190477f6af591c2a',generatedAt:new Date(now).toISOString(),posts:[post],...extra});
beforeEach(()=>localStorage.clear());
it('uses the same measured pixel classification and strips viewer-specific action flags',()=>{
 const [result]=parseRecommendationCatalog(catalog({posts:[{...post,likedByMe:true,repostedByMe:true}]}),now);
 expect(result.recommendationVisual).toEqual(visual);expect(result.likedByMe).toBe(false);expect(result.repostedByMe).toBe(false);
});
it('does not accept stale artifacts, an incompatible model or future timestamps',()=>{
 for(const extra of [{version:2},{revision:'other'},{generatedAt:new Date(now-RECOMMENDATION_CATALOG_MAX_AGE-1).toISOString()},{generatedAt:new Date(now+60001).toISOString()}])expect(parseRecommendationCatalog(catalog(extra),now)).toEqual([]);
});
it('does not include private content, duplicate IDs, private-media references or malformed vectors',()=>{
 const rows=[post,{...post},{...post,id:'private',visibility:'followers'},{...post,id:'private-media',imageUrls:['private-media:object']},{...post,id:'bad',recommendationVisual:{...visual,vector:[NaN]}}];
 expect(parseRecommendationCatalog(catalog({posts:rows}),now).map(row=>row.id)).toEqual([post.id]);
});
it('reclassifies a mislabeled catalog entry from its real vector',()=>{
 const vector=fixtures.find(row=>row.name==='pets')!.vector;
 const [result]=parseRecommendationCatalog(catalog({posts:[{...post,recommendationVisual:{...visual,kind:'moe',vector}}]}),now);
 expect(result.recommendationVisual!.kind).toBe('pets');
});
it('reuses a catalog vector for the identical image, without treating another work by that creator as equivalent',()=>{
 const catalogRows=parseRecommendationCatalog(catalog(),now);
 const rows=applyCatalogRecommendationVisuals([
  {...catalogRows[0],recommendationVisual:undefined,imageUrls:[post.imageUrls[0]+'?name=small']},
  {...catalogRows[0],id:'other-work',recommendationVisual:undefined,imageUrls:['https://pbs.twimg.com/media/other.jpg']},
 ],catalogRows);
 expect(rows[0].recommendationVisual).toEqual(visual);expect(rows[1].recommendationVisual).toBeUndefined();
});

afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.useRealTimers();});
it('delivers real verified bootstrap pixels while an external refresh never settles',async()=>{
 vi.resetModules();vi.stubEnv('VITE_RECOMMENDATION_CATALOG_URL','https://catalog.example/catalog.json');
 vi.stubEnv('VITE_RECOMMENDATION_BOOTSTRAP',JSON.stringify(catalog({generatedAt:new Date().toISOString()})));
 const fetch=vi.fn(()=>new Promise(()=>{}));vi.stubGlobal('fetch',fetch);
 const {readRecommendationCatalog}=await import("@/lib/recommendations");
 const result=await Promise.race([readRecommendationCatalog(),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('blocked by network')),100))]);
 expect(result).toHaveLength(1);expect(result[0].recommendationVisual!.kind).toBe('moe');expect(fetch).toHaveBeenCalledTimes(1);
});
it('keeps verified cards available when the refresh fails after the cache interval',async()=>{
 vi.useFakeTimers();vi.resetModules();vi.stubEnv('VITE_RECOMMENDATION_CATALOG_URL','https://catalog.example/catalog.json');
 vi.stubEnv('VITE_RECOMMENDATION_BOOTSTRAP',JSON.stringify(catalog({generatedAt:new Date().toISOString()})));
 vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('offline');}));
 const {readRecommendationCatalog}=await import("@/lib/recommendations");
 expect(await readRecommendationCatalog()).toHaveLength(1);await vi.advanceTimersByTimeAsync(60001);
 expect(await readRecommendationCatalog()).toHaveLength(1);
});
});

describe("search-trends", () => {
describe("search-trends", () => {
describe("search-trends", () => {
const trends = [{title:'物価',traffic:'100K+'},{title:'サッカー決勝',traffic:'30K+'},{title:'猫のゲーム',traffic:'5K+'}];
describe('search discovery trends', () => {
  it('classifies uncategorized topics using titles and related source headlines', () => {
    expect(classifyTrendCategory('サッカー決勝')).toBe('スポーツ');
    expect(classifyTrendCategory('新作アニメ')).toBe('エンターテインメント');
    expect(classifyTrendCategory('佐藤選手', 'テニス大会で優勝')).toBe('スポーツ');
    expect(classifyTrendCategory('山田さん', '主演映画の新作を公開')).toBe('エンターテインメント');
    expect(classifyTrendCategory('消費税', '政策を発表')).toBeUndefined();
    expect(classifyTrendCategory('大会のニュース', '', 'エンターテイメント')).toBe('エンターテインメント');
  });
  it('keeps numerical rankings independent of personal interests and classifies related news', () => {
    const result=prepareExploreTrends([...trends].reverse(),[{title:'佐藤選手がテニス大会で優勝',content:'',category:'スポーツ'}]);
    expect(result.map(row=>row.title)).toEqual(trends.map(row=>row.title));
    expect(prepareExploreTrends([{title:'佐藤選手',traffic:'1K+'}],[{title:'佐藤選手がテニス大会で優勝',content:'',category:'スポーツ'}])[0].category).toBe('スポーツ');
  });
  it('prioritizes matching interests over raw popularity without changing the input', () => {
    const result=rankPersonalTrends(trends,{authors:{},terms:{'topic:cats':4},recentTerms:{'topic:cats':8}});
    expect(result[0].title).toBe('猫のゲーム');
    expect(trends[0].title).toBe('物価');
    expect(rankPersonalTrends(trends,{authors:{},terms:{}}).map(row=>row.title)).toEqual(trends.map(row=>row.title));
  });
});
});

describe("googleTrends", () => {
const item = (title: string, traffic: string) => `<item><title>${title}</title><ht:approx_traffic>${traffic}</ht:approx_traffic></item>`;
const rss = (...items: string[]) => `<rss><channel>${items.join('')}</channel></rss>`;
it('sorts actual search volumes numerically, preserving Google order for ties', () => {
  expect(parseGoogleTrends(rss(item('低い順位', '1,000+'), item('最多検索', '20K+'), item('同数の先頭', '2万+'), item('次の話題', '5K+'))).map(x => x.title))
    .toEqual(['最多検索', '同数の先頭', '次の話題', '低い順位']);
});
it('removes greetings, duplicates and entries without real search volumes', () => {
  expect(parseGoogleTrends(rss(item('こんにちは！', '100K+'), item('Hello', '50K+'), item('話題', '10K+'), item('話題', '10K+'), item('未確認', ''), item('あ', '1000+'))))
    .toEqual([{ title: '話題', traffic: '10K+' }]);
});
it('decodes Google RSS titles without mistaking nested news titles for trends', () => {
  expect(parseGoogleTrends(rss(item('<![CDATA[A & B]]>', '2000+') + '<ht:news_item><ht:news_item_title>記事</ht:news_item_title></ht:news_item>', item('C &amp; D &#x65E5;', '1000+'))).map(x => x.title))
    .toEqual(['A & B', 'C & D 日']);
});
it('does not manufacture trends when Google returns an error page or empty feed', () => {
  expect(() => parseGoogleTrends('<html>Error</html>')).toThrow();
  expect(parseGoogleTrends(rss())).toEqual([]);
});
it('retains related headline context to classify names and can supply a larger discovery pool', () => {
  const xml=rss('<item><title>佐藤選手</title><ht:approx_traffic>20K+</ht:approx_traffic><ht:news_item><ht:news_item_title>テニス大会で優勝</ht:news_item_title></ht:news_item></item>', ...Array.from({length:15},(_,i)=>item(`話題${i}`,`${1000-i}+`)));
  expect(parseGoogleTrends(xml)[0]).toMatchObject({title:'佐藤選手',context:'テニス大会で優勝',category:'スポーツ'});
  expect(parseGoogleTrends(xml)).toHaveLength(10);
  expect(parseGoogleTrends(xml,50)).toHaveLength(16);
});

const trendPage = (rows: unknown[]) => `<script>AF_initDataCallback({key: 'ds:0', hash: 'x', data:${JSON.stringify([null, rows])}, sideChannel: {}});</script>`;
const topic = (title: string, volume: number, categories: number[], queries: string[] = [title]) => [title, null, 'JP', [1791000000], null, null, volume, null, 1000, queries, categories];
it('reads the expanded actual trending pool and official categories for ambiguous names', () => {
  const rows = Array.from({length:65},(_,i)=>topic(`一般話題${i}`,100000-i,[]));
  rows.push(topic('名前だけの芸能人',1000,[4]),topic('名前だけの選手',500,[17]),topic('両分野の話題',2000,[4,17]));
  const result = parseGoogleTrendingPage(trendPage(rows));
  expect(result).toHaveLength(68);
  expect(result.find(row=>row.title==='名前だけの芸能人')?.category).toBe('エンターテインメント');
  expect(result.find(row=>row.title==='名前だけの選手')?.category).toBe('スポーツ');
  expect(result.find(row=>row.title==='両分野の話題')?.categories).toEqual(['エンターテインメント','スポーツ']);
  expect(result[0].traffic).toBe('100000+');
});
it('rejects broken source formats and removes invalid volumes, duplicates and foreign rows', () => {
  expect(()=>parseGoogleTrendingPage('<html>blocked</html>')).toThrow();
  expect(()=>parseGoogleTrendingPage(trendPage([]))).toThrow();
  const foreign=topic('別の国',999999,[4]);foreign[2]='US';
  expect(parseGoogleTrendingPage(trendPage([topic('有効な話題',500,[4]),topic('有効な話題',800,[4]),topic('検索数不明',0,[4]),foreign]))).toHaveLength(1);
});
});
});

describe("searchProviderBatch", () => {
const post=(id:string)=>({id,source:id.startsWith('x:')?'x':'bluesky'}) as PostWithAuthor;
it('keeps six relevant twitter results visible when newer Bluesky results would otherwise fill all twenty slots',()=>{
 const other=Array.from({length:30},(_,i)=>post('bsky:'+i)),twitter=Array.from({length:6},(_,i)=>post('x:'+i));
 const first=searchProviderBatch([...other,...twitter],20,true);
 expect(first.posts.filter(post=>post.source==='x').map(post=>post.id)).toEqual(twitter.map(post=>post.id));expect(first.posts[0].source).toBe('x');expect(first.posts).toHaveLength(20);
 const second=searchProviderBatch(first.remaining,20,true);expect(new Set([...first.posts,...second.posts].map(post=>post.id)).size).toBe(36);expect(second.remaining).toEqual([]);
});
it('prioritizes twitter when enough matching results exist, without changing order inside each service',()=>{
 const rows=[...Array.from({length:30},(_,i)=>post('bsky:'+i)),...Array.from({length:30},(_,i)=>post('x:'+i))];
 const page=searchProviderBatch(rows,20,true);expect(page.posts.filter(post=>post.source==='x')).toHaveLength(18);expect(page.posts.slice(0,4).map(post=>post.id)).toEqual(['x:0','x:1','x:2','x:3']);
});
it('retains normal ranking for an explicitly selected source and fills shortages without placeholders',()=>{
 const rows=[post('bsky:1'),post('x:1')];expect(searchProviderBatch(rows,20,false).posts).toEqual(rows);expect(searchProviderBatch([post('x:1'),post('x:1')],20,true).posts).toHaveLength(1);
});

it('keeps the twitter allocation on each scroll batch and never replays a result',()=>{
 let remaining=[...Array.from({length:80},(_,i)=>post('bsky:'+i)),...Array.from({length:80},(_,i)=>post('x:'+i))];
 const seen=new Set<string>();
 for(let i=0;i<3;i++){
  const page=searchProviderBatch(remaining,20,true);
  expect(page.posts.filter(row=>row.source==='x')).toHaveLength(18);
  for(const row of page.posts){expect(seen.has(row.id)).toBe(false);seen.add(row.id);}
  remaining=page.remaining;
 }
});
});

describe("marketData", () => {
const asset=matchMarketAsset('$AAPL')!;
const payload=(extra={})=>({chart:{result:[{meta:{symbol:'AAPL',regularMarketPrice:102,regularMarketTime:30,previousClose:100,currency:'USD',currentTradingPeriod:{regular:{start:10,end:30}},...extra},timestamp:[5,10,20,30,40],indicators:{quote:[{close:[99,100,null,102,103],volume:[1,2,3,4,5]}]}}]}});
it('resolves cashtags, names and Japanese security codes without matching ordinary phrases',()=>{
 for(const query of ['$aapl','AAPL','Apple','アップル'])expect(matchMarketAsset(query)?.symbol).toBe('AAPL');
 expect(matchMarketAsset('7203')?.symbol).toBe('7203.T');expect(matchMarketAsset('日経平均株価')?.symbol).toBe('^N225');
 expect(matchMarketAsset('Appleの新製品')).toBeUndefined();expect(matchMarketAsset('')).toBeUndefined();
 expect(suggestMarketAssets('$AAP')[0].symbol).toBe('AAPL');expect(suggestMarketAssets('n')).toEqual([]);
});
it('computes actual daily changes, filters null points and distinguishes extended hours',()=>{
 const quote=parseMarketChart(payload(),asset,'1D');expect(quote.change).toBe(2);expect(quote.changePercent).toBe(2);
 expect(quote.points.map(point=>point.time)).toEqual([10,30,40]);expect(quote.points.map(point=>point.extended)).toEqual([false,true,true]);
 expect(quote.extended).toEqual({time:40,price:103});
});
it('never treats the beginning of a month/year chart as the previous day close',()=>{
 const quote=parseMarketChart(payload({previousClose:undefined,chartPreviousClose:50,regularMarketChangePercent:2}),asset,'1Y');
 expect(quote.previousClose).toBeNull();expect(quote.changePercent).toBe(2);expect(quote.change).toBeCloseTo(2);
 expect(quote.points.every(point=>!point.extended)).toBe(true);
});
it('rejects missing prices, upstream errors and a different instrument',()=>{
 expect(()=>parseMarketChart({chart:{error:{}}},asset,'1D')).toThrow();
 expect(()=>parseMarketChart(payload({regularMarketPrice:null}),asset,'1D')).toThrow();
 expect(()=>parseMarketChart(payload({symbol:'MSFT'}),asset,'1D')).toThrow();
});

it('resolves major Japanese companies by names, cashtags and alphanumeric exchange codes',()=>{
 for(const query of ['キオクシア','キオクシアホールディングス','285A','$285A','285A.T','Kioxia'])expect(matchMarketAsset(query)?.symbol).toBe('285A.T');
 expect(matchMarketAsset('ソフトバンク')?.symbol).toBe('9434.T');expect(matchMarketAsset('ソフトバンクG')?.symbol).toBe('9984.T');
 expect(matchMarketAsset('NTT')?.symbol).toBe('9432.T');expect(matchMarketAsset('三菱重工')?.symbol).toBe('7011.T');
 expect(suggestMarketAssets('キオ')[0].symbol).toBe('285A.T');
});
});
});

describe("recommendationVisualInference", () => {
const vector=prototypes.prototypes.find(row=>row.id==='moe')!.vectors[0];
const recommendationVisualInferenceTestPost=(id:string,url=id)=>({id,userId:id,imageUrls:['https://images.example/inference-'+url+'.jpg'],content:'',author:{id,username:id}}) as PostWithAuthor;
const workers:FakeWorker[]=[];
class FakeWorker{
 onmessage:((event:{data:{id:number;vector:number[]}})=>void)|null=null;
 onerror:(()=>void)|null=null;
 requests:Array<{id:number;url:string}>=[];
 terminate=vi.fn();
 constructor(){workers.push(this);}
 postMessage(data:{id:number;url?:string;warm?:boolean}){if(data.url)this.requests.push({id:data.id,url:data.url});}
 finish(){for(const request of this.requests.splice(0))this.onmessage?.({data:{id:request.id,vector}});}
}
afterEach(()=>{for(const worker of workers)worker.finish();releaseRecommendationVisualWorker();workers.length=0;vi.unstubAllGlobals();vi.useRealTimers();});
it('submits three uncached images before waiting for the first result and preserves input order',async()=>{
 vi.stubGlobal('Worker',FakeWorker);
 const pending=enrichRecommendationVisuals([recommendationVisualInferenceTestPost('parallel-a'),recommendationVisualInferenceTestPost('parallel-b'),recommendationVisualInferenceTestPost('parallel-c')],['digital-illustration']);
 expect(workers[0].requests).toHaveLength(3);workers[0].finish();
 const result=await pending;expect(result.map(post=>post.id)).toEqual(['parallel-a','parallel-b','parallel-c']);
 expect(result.every(post=>post.recommendationVisualStatus==='checked')).toBe(true);
});
it('shares one in-flight image analysis for duplicate URLs',async()=>{
 vi.stubGlobal('Worker',FakeWorker);
 const pending=enrichRecommendationVisuals([recommendationVisualInferenceTestPost('copy-a','shared'),recommendationVisualInferenceTestPost('copy-b','shared')],['digital-illustration']);
 expect(workers[0].requests).toHaveLength(1);workers[0].finish();
 expect((await pending).every(post=>post.recommendationVisualStatus==='checked')).toBe(true);
});
it('reuses the model after a reading pause and eventually releases its memory',async()=>{
 vi.useFakeTimers();vi.stubGlobal('Worker',FakeWorker);warmRecommendationVisualWorker();
 const first=enrichRecommendationVisuals([recommendationVisualInferenceTestPost('idle-first')],['digital-illustration']);workers[0].finish();await first;idleRecommendationVisualWorker();
 await vi.advanceTimersByTimeAsync(25000);expect(workers[0].terminate).not.toHaveBeenCalled();
 const second=enrichRecommendationVisuals([recommendationVisualInferenceTestPost('idle-second')],['digital-illustration']);expect(workers).toHaveLength(1);workers[0].finish();await second;idleRecommendationVisualWorker();
 await vi.advanceTimersByTimeAsync(120000);expect(workers[0].terminate).toHaveBeenCalledTimes(1);
});

it('keeps the initialized model when consuming a ready reserve cancels unfinished analysis',async()=>{
 vi.stubGlobal('Worker',FakeWorker);
 const controller=new AbortController();
 const cancelled=enrichRecommendationVisuals([recommendationVisualInferenceTestPost('cancel-reserve')],['digital-illustration'],controller.signal);
 const rejection=expect(cancelled).rejects.toMatchObject({name:'AbortError'});
 controller.abort();await rejection;expect(workers[0].terminate).not.toHaveBeenCalled();
 const next=enrichRecommendationVisuals([recommendationVisualInferenceTestPost('after-cancel')],['digital-illustration']);
 expect(workers).toHaveLength(1);workers[0].finish();expect((await next)[0].recommendationVisualStatus).toBe('checked');
});

it('does not repeatedly request a failed image when scrolling reaches it again',async()=>{
 vi.useFakeTimers();vi.stubGlobal('Worker',FakeWorker);
 const first=enrichRecommendationVisuals([recommendationVisualInferenceTestPost('failed-first','failed-shared')],['digital-illustration']);
 workers[0].onerror?.();expect((await first)[0].recommendationVisualStatus).toBe('unavailable');
 const second=await enrichRecommendationVisuals([recommendationVisualInferenceTestPost('failed-next','failed-shared')],['digital-illustration']);
 expect(second[0].recommendationVisualStatus).toBe('unavailable');expect(workers).toHaveLength(1);
 await vi.advanceTimersByTimeAsync(60001);
 const retry=enrichRecommendationVisuals([recommendationVisualInferenceTestPost('failed-recovered','failed-shared')],['digital-illustration']);
 expect(workers).toHaveLength(2);workers[1].finish();expect((await retry)[0].recommendationVisualStatus).toBe('checked');
});
});
