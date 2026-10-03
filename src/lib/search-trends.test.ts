import { describe, expect, it } from 'vitest';
import { classifyTrendCategory } from './trend-categories';
import { prepareExploreTrends, rankPersonalTrends } from './search-trends';
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
