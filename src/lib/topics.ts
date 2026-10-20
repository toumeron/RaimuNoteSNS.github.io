import { recommendationTerms, type RecommendationPreferences } from "@/lib/recommendations";

// topics
const TOPICS = [
  {id:'economy',name:'株式/経済',description:'株式市場・経済の動き',queries:['株式','経済'],terms:['株式','経済','株価','日経平均','株式市場','景気','stock market','economy']},
  {id:'politics',name:'政治',description:'政治・社会',queries:['政治','選挙'],terms:['政治','選挙','国会','政党','政策','politics','election']},
  {id:'sports',name:'スポーツ',description:'試合・選手・スポーツニュース',queries:['スポーツ','サッカー'],terms:['スポーツ','野球','サッカー','バスケ','テニス','五輪','オリンピック','sports','football','baseball','nba']},
  {id:'business',name:'ビジネス/金融',description:'ビジネス・金融',queries:['ビジネス','金融'],terms:['ビジネス','金融','投資','銀行','起業','経営','business','finance']},
  {id:'science',name:'科学',description:'研究・発見',queries:['科学','研究'],terms:['科学','研究','宇宙','物理','化学','生物学','science','research']},
  {id:'technology',name:'テクノロジー',description:'技術・開発',queries:['テクノロジー','プログラミング'],terms:['テクノロジー','技術','プログラミング','ソフトウェア','半導体','technology','typescript','javascript','python']},
  {id:'ai',name:'人工知能',description:'AI・機械学習',queries:['人工知能','生成AI'],terms:['人工知能','生成ai','機械学習','chatgpt','llm','ai','artificial intelligence']},
  {id:'art',name:'アート',description:'美術・イラスト',queries:['イラスト','アート'],terms:['アート','美術','絵画','イラスト','お絵描き','art','illustration','drawing']},
  {id:'digital-illustration',name:'デジタルイラスト',description:'イラスト',queries:['ファンアート','オリキャラ'],terms:['デジタルイラスト','萌えイラスト','ファンアート','オリキャラ','オリジナルキャラクター','キャラクターイラスト','fanart','fan art']},
  {id:'film',name:'映画/テレビ',description:'映画・テレビ・ドラマ',queries:['映画','ドラマ'],terms:['映画','テレビ','ドラマ','俳優','監督','cinema','movie','film']},
  {id:'games',name:'ゲーム',description:'ゲーム・eスポーツ',queries:['ゲーム','ゲーム実況'],terms:['ゲーム','任天堂','ポケモン','スプラトゥーン','モンハン','playstation','steam','gaming','game']},
  {id:'crypto',name:'仮想通貨',description:'暗号資産・ブロックチェーン',queries:['仮想通貨','ビットコイン'],terms:['仮想通貨','暗号資産','ビットコイン','ブロックチェーン','bitcoin','ethereum','crypto','nft','web3','opensea']},
  {id:'travel',name:'旅行',description:'旅・観光',queries:['旅行','観光'],terms:['旅行','観光','旅先','温泉','ホテル','travel','trip','tourism']},
  {id:'anime',name:'アニメ',description:'アニメ・漫画',queries:['アニメ','漫画'],terms:['アニメ','漫画','マンガ','声優','anime','manga']},
  {id:'food',name:'グルメ',description:'料理・食べ物',queries:['グルメ','料理'],terms:['グルメ','料理','食べ物','ラーメン','レシピ','カフェ','スイーツ','food','cooking','recipe']},
  {id:'career',name:'キャリア',description:'仕事・働き方',queries:['キャリア','転職'],terms:['キャリア','転職','就職','求人','働き方','career','recruitment']},
  {id:'pets',name:'ペット',description:'猫・犬・ペットとの暮らし',queries:['猫','犬'],terms:['ペット','猫','ねこ','ネコ','犬','いぬ','pet','pets','cat','cats','dog','dogs','kitten','puppy']},
  {id:'music',name:'音楽',description:'楽曲・アーティスト',queries:['音楽','新曲'],terms:['音楽','楽曲','新曲','歌手','コンサート','ライブツアー','music','song','album']},
  {id:'design',name:'デザイン',description:'デザイン・ものづくり',queries:['デザイン','グラフィック'],terms:['デザイン','グラフィック','タイポグラフィ','ロゴ','design','typography']},
  {id:'fashion',name:'ファッション',description:'服・スタイル',queries:['ファッション','コーデ'],terms:['ファッション','コーデ','洋服','アパレル','fashion','outfit']},
  {id:'memes',name:'ミーム',description:'ネットの話題・ユーモア',queries:['ミーム','ネタ'],terms:['ミーム','ネットミーム','ネタ','大喜利','meme','memes']},
  {id:'fitness',name:'健康/フィットネス',description:'健康・運動',queries:['フィットネス','筋トレ'],terms:['健康','フィットネス','筋トレ','運動','ヨガ','ランニング','fitness','workout','health']},
] as const;
type TopicId = typeof TOPICS[number]['id'];
type TopicPreferences = {followed:TopicId[];dismissed:TopicId[]};
const EMPTY_TOPIC_PREFERENCES:TopicPreferences={followed:[],dismissed:[]};
function isTopicId(value:unknown):value is TopicId {return TOPICS.some(topic=>topic.id===value);}
function matchingTopics(content:string):TopicId[] {
  const text=content.replace(/https?:\/\/\S+/g,' ').normalize('NFKC').toLowerCase();
  return TOPICS.filter(topic=>topic.terms.some(term=>/^[a-z\s]+$/.test(term)
    ? new RegExp(`(^|[^a-z0-9])${term}($|[^a-z0-9])`,'i').test(text) : text.includes(term))).map(topic=>topic.id);
}
function topicAffinity(content:string,preferences:Partial<TopicPreferences>):number {
 const matches=matchingTopics(content);
 return Math.min(2,matches.filter(id=>preferences.followed?.includes(id)).length)-2*Math.min(2,matches.filter(id=>preferences.dismissed?.includes(id)).length);
}

const GLOBAL_TOPICS:TopicId[]=['economy','business','crypto'];

// trend-categories
type TrendCategory = 'スポーツ' | 'エンターテインメント';
// Use explicit source categories first, then the topic and related headlines.
// Unknown topics stay unclassified instead of leaking into either category.
const sports = /スポーツ|sports|野球|サッカー|バスケット|バスケ|テニス|卓球|ラグビー|バレー|ゴルフ|相撲|陸上|水泳|競馬|競輪|フィギュア|オリンピック|五輪|大谷翔平|ドジャース|ヤンキース|阪神|巨人|ソフトバンク|日本ハム|楽天イーグルス|西武|浦和レッズ|ヴィッセル|横浜マリノス|ワールドカップ|プレミアリーグ|チャンピオンズリーグ|首位打者|ホームラン|本塁打|\b(?:nba|mlb|nfl|nhl|fifa|uefa|f1|jリーグ)\b/i;
const entertainment = /エンタメ|エンターテ[イィ](?:ン)?メント|entertainment|芸能|音楽|映画|アニメ|漫画|マンガ|ゲーム|声優|俳優|女優|歌手|アイドル|ドラマ|テレビ|バラエティ|お笑い|コンサート|アルバム|シングル|新曲|ライブツアー|フェス|配信者|vtuber|ポケモン|任天堂|プレイステーション|プロセカ|初音ミク|ボーカロイド|乃木坂|櫻坂|日向坂|ジャニーズ|ホロライブ|にじさんじ|\b(?:akb48|bts|snow man|netflix|nintendo|playstation)\b/i;
function classifyTrendCategory(title: string, context = '', category = ''): TrendCategory | undefined {
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
function trendSearchVolume(value: string): number {
  const match = value.replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*([KMB万億]?)/i);
  if (!match) return 0;
  const multiplier: Record<string, number> = {K: 1e3, M: 1e6, B: 1e9, 万: 1e4, 億: 1e8};
  return Number(match[1]) * (multiplier[match[2].toUpperCase()] ?? 1);
}

// search-trends
type ExploreTrend = {title: string; traffic: string; rank?: number; category?: string; categories?: string[]; context?: string};
function prepareExploreTrends(trends: ExploreTrend[], news: {title: string; content: string; category: string}[]): ExploreTrend[] {
  return trends.map(trend => {
    const related = news.filter(item => item.title.includes(trend.title) || (trend.title.length >= 3 && item.content.includes(trend.title)));
    const context = [trend.context, ...related.map(item => `${item.category}。${item.title}`)].filter(Boolean).join('\n');
    return {...trend, context, category: classifyTrendCategory(trend.title, context, trend.category) ?? trend.category};
  }).sort((a, b) => trendSearchVolume(b.traffic) - trendSearchVolume(a.traffic));
}
function rankPersonalTrends(trends: ExploreTrend[], preferences: RecommendationPreferences): ExploreTrend[] {
  const maximumVolume = Math.max(1, ...trends.map(trend => Math.log1p(trendSearchVolume(trend.traffic))));
  const scored = trends.map((trend, index) => {
    const terms = recommendationTerms(`${trend.title} ${trend.category ?? ''} ${trend.context ?? ''}`);
    const interest = terms.reduce((sum, term) => sum + Math.log1p(Math.max(0, preferences.terms[term] ?? 0)) + 1.5 * Math.log1p(Math.max(0, preferences.recentTerms?.[term] ?? 0)), 0) / Math.sqrt(Math.max(1, terms.length));
    return {trend, index, score: 8 * interest + Math.log1p(trendSearchVolume(trend.traffic)) / maximumVolume + 12*topicAffinity(`${trend.title} ${trend.category??''} ${trend.context??''}`,{followed:preferences.followedTopics,dismissed:preferences.dismissedTopics})};
  });
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map(row => row.trend);
}

export { isTopicId };
export { matchingTopics };
export { topicAffinity };
export { TOPICS };
export type { TopicId };
export type { TopicPreferences };
export { EMPTY_TOPIC_PREFERENCES };
export { GLOBAL_TOPICS };
export { classifyTrendCategory };
export { trendSearchVolume };
export type { TrendCategory };
export { prepareExploreTrends };
export { rankPersonalTrends };
export type { ExploreTrend };
