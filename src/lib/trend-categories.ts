export type TrendCategory = 'スポーツ' | 'エンターテインメント';
// Use explicit source categories first, then the topic and related headlines.
// Unknown topics stay unclassified instead of leaking into either category.
const sports = /スポーツ|sports|野球|サッカー|バスケット|バスケ|テニス|卓球|ラグビー|バレー|ゴルフ|相撲|陸上|水泳|競馬|競輪|フィギュア|オリンピック|五輪|大谷翔平|ドジャース|ヤンキース|阪神|巨人|ソフトバンク|日本ハム|楽天イーグルス|西武|浦和レッズ|ヴィッセル|横浜マリノス|ワールドカップ|プレミアリーグ|チャンピオンズリーグ|首位打者|ホームラン|本塁打|\b(?:nba|mlb|nfl|nhl|fifa|uefa|f1|jリーグ)\b/i;
const entertainment = /エンタメ|エンターテ[イィ](?:ン)?メント|entertainment|芸能|音楽|映画|アニメ|漫画|マンガ|ゲーム|声優|俳優|女優|歌手|アイドル|ドラマ|テレビ|バラエティ|お笑い|コンサート|アルバム|シングル|新曲|ライブツアー|フェス|配信者|vtuber|ポケモン|任天堂|プレイステーション|プロセカ|初音ミク|ボーカロイド|乃木坂|櫻坂|日向坂|ジャニーズ|ホロライブ|にじさんじ|\b(?:akb48|bts|snow man|netflix|nintendo|playstation)\b/i;
export function classifyTrendCategory(title: string, context = '', category = ''): TrendCategory | undefined {
  if (sports.test(category)) return 'スポーツ';
  if (entertainment.test(category)) return 'エンターテインメント';
  if (sports.test(title)) return 'スポーツ';
  if (entertainment.test(title)) return 'エンターテインメント';
  const sportHits = context.split(/[。\n]/).filter(line => sports.test(line)).length;
  const entertainmentHits = context.split(/[。\n]/).filter(line => entertainment.test(line)).length;
  if (sportHits > entertainmentHits) return 'スポーツ';
  if (entertainmentHits > sportHits) return 'エンターテインメント';
  return undefined;
}
export function trendSearchVolume(value: string): number {
  const match = value.replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*([KMB万億]?)/i);
  if (!match) return 0;
  const multiplier: Record<string, number> = {K: 1e3, M: 1e6, B: 1e9, 万: 1e4, 億: 1e8};
  return Number(match[1]) * (multiplier[match[2].toUpperCase()] ?? 1);
}
