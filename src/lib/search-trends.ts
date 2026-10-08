import { recommendationTerms, type RecommendationPreferences } from './recommendations';
import { classifyTrendCategory, trendSearchVolume } from './trend-categories';
import {topicAffinity} from './topics';
export type ExploreTrend = {title: string; traffic: string; rank?: number; category?: string; categories?: string[]; context?: string};
export function prepareExploreTrends(trends: ExploreTrend[], news: {title: string; content: string; category: string}[]): ExploreTrend[] {
  return trends.map(trend => {
    const related = news.filter(item => item.title.includes(trend.title) || (trend.title.length >= 3 && item.content.includes(trend.title)));
    const context = [trend.context, ...related.map(item => `${item.category}。${item.title}`)].filter(Boolean).join('\n');
    return {...trend, context, category: classifyTrendCategory(trend.title, context, trend.category) ?? trend.category};
  }).sort((a, b) => trendSearchVolume(b.traffic) - trendSearchVolume(a.traffic));
}
export function rankPersonalTrends(trends: ExploreTrend[], preferences: RecommendationPreferences): ExploreTrend[] {
  const maximumVolume = Math.max(1, ...trends.map(trend => Math.log1p(trendSearchVolume(trend.traffic))));
  const scored = trends.map((trend, index) => {
    const terms = recommendationTerms(`${trend.title} ${trend.category ?? ''} ${trend.context ?? ''}`);
    const interest = terms.reduce((sum, term) => sum + Math.log1p(Math.max(0, preferences.terms[term] ?? 0)) + 1.5 * Math.log1p(Math.max(0, preferences.recentTerms?.[term] ?? 0)), 0) / Math.sqrt(Math.max(1, terms.length));
    return {trend, index, score: 8 * interest + Math.log1p(trendSearchVolume(trend.traffic)) / maximumVolume + 12*topicAffinity(`${trend.title} ${trend.category??''} ${trend.context??''}`,{followed:preferences.followedTopics,dismissed:preferences.dismissedTopics})};
  });
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map(row => row.trend);
}
