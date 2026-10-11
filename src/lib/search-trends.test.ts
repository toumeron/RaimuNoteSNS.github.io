import { describe, expect, it } from "vitest";
import { classifyTrendCategory } from "./trend-categories";
import { prepareExploreTrends, rankPersonalTrends } from "./search-trends";
import { parseGoogleTrends, parseGoogleTrendingPage } from "../../supabase/functions/get-trends/trends";

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
