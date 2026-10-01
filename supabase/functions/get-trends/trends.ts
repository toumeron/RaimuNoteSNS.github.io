export const GOOGLE_TRENDS_URL = 'https://trends.google.com/trending/rss?geo=JP';
export type TrendItem = { title: string; traffic: string };

function decodeXml(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
      const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
}
function searchVolume(value: string): number {
  const match = value.replaceAll(',', '').match(/^(\d+(?:\.\d+)?)\s*([KMB万億]?)/i);
  if (!match) return 0;
  const multipliers: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, 万: 1e4, 億: 1e8 };
  return Number(match[1]) * (multipliers[match[2].toUpperCase()] || 1);
}
const greetings = new Set(['こんにちは', 'こんにちわ', 'こんばんは', 'おはよう', 'おはようございます', 'おやすみ', 'おやすみなさい', 'ありがとう', 'ありがとうございます', 'hello', 'hi', 'good morning']);

export function parseGoogleTrends(xml: string): TrendItem[] {
  if (!/<rss\b/i.test(xml) || !/<channel\b/i.test(xml)) throw new Error('Invalid Google Trends RSS');
  const seen = new Set<string>();
  const items: Array<TrendItem & { volume: number; sourceIndex: number }> = [];
  for (const [sourceIndex, match] of [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].entries()) {
    const title = decodeXml(match[1].match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
    const traffic = decodeXml(match[1].match(/<ht:approx_traffic\b[^>]*>([\s\S]*?)<\/ht:approx_traffic>/i)?.[1] || '');
    const key = title.normalize('NFKC').toLowerCase().replace(/[\s!?！。、]+$/g, '').trim();
    const volume = searchVolume(traffic);
    if (title.length < 2 || greetings.has(key) || seen.has(key) || volume <= 0) continue;
    seen.add(key);
    items.push({ title, traffic, volume, sourceIndex });
  }
  return items.sort((a, b) => b.volume - a.volume || a.sourceIndex - b.sourceIndex)
    .slice(0, 10).map(({ title, traffic }) => ({ title, traffic }));
}
