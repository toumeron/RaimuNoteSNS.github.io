import { classifyTrendCategory, trendSearchVolume } from '../../../src/lib/trend-categories.ts';
export const GOOGLE_TRENDS_URL = 'https://trends.google.com/trending/rss?geo=JP';
export type TrendItem = { title: string; traffic: string; context?: string; category?: string; categories?: string[] };

function decodeXml(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
      const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
}
const greetings = new Set(['こんにちは', 'こんにちわ', 'こんばんは', 'おはよう', 'おはようございます', 'おやすみ', 'おやすみなさい', 'ありがとう', 'ありがとうございます', 'hello', 'hi', 'good morning']);

export function parseGoogleTrends(xml: string, limit = 10): TrendItem[] {
  if (!/<rss\b/i.test(xml) || !/<channel\b/i.test(xml)) throw new Error('Invalid Google Trends RSS');
  const seen = new Set<string>();
  const items: Array<TrendItem & { volume: number; sourceIndex: number }> = [];
  for (const [sourceIndex, match] of [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].entries()) {
    const title = decodeXml(match[1].match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
    const traffic = decodeXml(match[1].match(/<ht:approx_traffic\b[^>]*>([\s\S]*?)<\/ht:approx_traffic>/i)?.[1] || '');
    const key = title.normalize('NFKC').toLowerCase().replace(/[\s!?！。、]+$/g, '').trim();
    const volume = trendSearchVolume(traffic);
    if (title.length < 2 || greetings.has(key) || seen.has(key) || volume <= 0) continue;
    seen.add(key);
    const context = [...match[1].matchAll(/<ht:news_item_title\b[^>]*>([\s\S]*?)<\/ht:news_item_title>/gi)].map(row => decodeXml(row[1])).join('\n');
    const category = classifyTrendCategory(title, context);
    items.push({ title, traffic, volume, sourceIndex, ...(context ? {context} : {}), ...(category ? {category} : {}) });
  }
  return items.sort((a, b) => b.volume - a.volume || a.sourceIndex - b.sourceIndex)
    .slice(0, limit).map(({ volume: _volume, sourceIndex: _index, ...item }) => item);
}

export const GOOGLE_TRENDING_URL = 'https://trends.google.com/trending?geo=JP&hours=24&hl=ja';

// The public Trending Now page includes the same 24-hour data it renders,
// including real search volumes and Google's category IDs (4: entertainment,
// 17: sports). Parse JSON only; never execute scripts from the source page.
export function parseGoogleTrendingPage(html: string): TrendItem[] {
  const match = html.match(/AF_initDataCallback\(\{key:\s*['"]ds:0['"][\s\S]*?data:\s*(\[[\s\S]*?\])\s*,\s*sideChannel:/);
  if (!match) throw new Error('Google Trending Now data is missing');
  const data: unknown = JSON.parse(match[1]);
  if (!Array.isArray(data) || !Array.isArray(data[1])) throw new Error('Invalid Google Trending Now data');
  const seen = new Set<string>();
  const items: TrendItem[] = [];
  for (const row of data[1]) {
    if (!Array.isArray(row) || typeof row[0] !== 'string' || row[2] !== 'JP' || !Number.isFinite(row[6]) || row[6] <= 0) continue;
    const title = row[0].trim();
    const key = title.normalize('NFKC').toLowerCase();
    if (title.length < 2 || greetings.has(key) || seen.has(key)) continue;
    seen.add(key);
    const categories = (Array.isArray(row[10]) ? row[10] : []).flatMap((id: unknown) => id === 4 ? ['エンターテインメント'] : id === 17 ? ['スポーツ'] : []);
    const context = (Array.isArray(row[9]) ? row[9] : []).filter((value: unknown): value is string => typeof value === 'string').slice(0, 24).join('\n');
    const category = categories[0] ?? classifyTrendCategory(title, context);
    items.push({title, traffic: `${row[6]}+`, ...(context ? {context} : {}), ...(category ? {category} : {}), ...(categories.length ? {categories} : {})});
  }
  if (!items.length) throw new Error('Google Trending Now returned no usable topics');
  return items.sort((a, b) => trendSearchVolume(b.traffic) - trendSearchVolume(a.traffic));
}
