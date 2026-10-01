import { expect, it } from 'vitest';
import { parseGoogleTrends } from '../../supabase/functions/get-trends/trends';
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
