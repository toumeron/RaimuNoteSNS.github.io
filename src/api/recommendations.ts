import { supabase } from '@/lib/supabase';
import { getFeed, getPostsByUser, searchPosts } from './posts';
import { fetchBlueskyAuthorFeed, fetchBlueskyTopicPosts, fetchTrendingJapaneseBlueskyPosts } from '@/lib/bluesky';
import { normalizeTimelineBlueskyPost } from '@/lib/timelinePaging';
import { addRecommendationInterest, rankRecommendations, recommendationQueries, readRecommendationLikes, type RecommendationPreferences } from '@/lib/recommendations';
import type { PostWithAuthor } from '@/types';
import type { FeedCursor } from './posts';

export async function getRecommendationPreferences(viewerId:string|null):Promise<RecommendationPreferences> {
  const preferences:RecommendationPreferences={authors:{},terms:{},followedAuthors:[],likedPostIds:[]};
  if(viewerId) {
    const results=await Promise.allSettled([
      supabase.from('follows').select('followee_id').eq('follower_id',viewerId),
      supabase.from('likes').select('created_at,posts:post_id(id,user_id,content)').eq('user_id',viewerId).order('created_at',{ascending:false}).limit(100),
      supabase.from('reposts').select('created_at,posts:post_id(id,user_id,content)').eq('user_id',viewerId).order('created_at',{ascending:false}).limit(100),
      supabase.from('external_reposts').select('created_at,post_snapshot').eq('user_id',viewerId).order('created_at',{ascending:false}).limit(100),
      supabase.from('comments').select('created_at,content,post:post_id(user_id,content)').eq('user_id',viewerId).order('created_at',{ascending:false}).limit(50),
    ]);
    results.forEach((result,index)=>{
      if(result.status!=='fulfilled' || result.value.error) return;
      for(const row of result.value.data ?? []) {
        if ('followee_id' in row) { preferences.followedAuthors!.push(row.followee_id); preferences.authors[row.followee_id]=(preferences.authors[row.followee_id] ?? 0)+3; }
        else if ('post' in row) {
          const source=Array.isArray(row.post)?row.post[0]:row.post;
          if(source) addRecommendationInterest(preferences,source,1.5,row.created_at);
          addRecommendationInterest(preferences,{content:row.content},.5,row.created_at);
        } else {
          const interest = 'posts' in row ? (Array.isArray(row.posts) ? row.posts[0] : row.posts) : row.post_snapshot;
          if(index===1 && interest?.id) preferences.likedPostIds!.push(interest.id);
          if (interest) addRecommendationInterest(preferences, interest, index===1?2:4, row.created_at);
        }
      }
    });
  }
  for(const post of readRecommendationLikes(viewerId)) addRecommendationInterest(preferences,post,2,post.engagedAt ?? new Date(Date.now()-30*86400000).toISOString());
  return preferences;
}
export type RecommendationCursor={
  lime:{page:number;before?:FeedCursor;done:boolean};
  trending:{cursor:string|null;done:boolean};
  authors:Record<string,{cursor:string|null;done:boolean}>;
  topics:Record<string,{limePage:number;limeDone:boolean;blueCursor:string|null;blueDone:boolean}>;
  nativeAuthors:Record<string,{page:number;done:boolean}>;
  history:PostWithAuthor[];
  remaining:PostWithAuthor[];seen:string[];preferences?:RecommendationPreferences;
};
export function createRecommendationCursor(handles:string[]):RecommendationCursor {
  return {lime:{page:0,done:false},trending:{cursor:null,done:false},authors:Object.fromEntries(handles.slice(0,4).map(actor=>[actor,{cursor:null,done:false}])),topics:{},nativeAuthors:{},history:[],remaining:[],seen:[]};
}
export async function getRecommendationPage(previous:RecommendationCursor,viewerId:string|null,signal?:AbortSignal) {
  const cursor:RecommendationCursor={...previous,lime:{...previous.lime},trending:{...previous.trending},authors:Object.fromEntries(Object.entries(previous.authors).map(([id,state])=>[id,{...state}])),topics:Object.fromEntries(Object.entries(previous.topics).map(([term,state])=>[term,{...state}])),nativeAuthors:Object.fromEntries(Object.entries(previous.nativeAuthors).map(([id,state])=>[id,{...state}])),history:[...previous.history],remaining:[...previous.remaining],seen:[...previous.seen]};
  const preferences=cursor.preferences ?? await getRecommendationPreferences(viewerId);
  cursor.preferences=preferences;
  const favoriteBlueskyAuthors = Object.entries(preferences.authors)
    .filter(([id]) => (id.startsWith('did:') || id.startsWith('misskey-user:')))
    .sort((a,b) => b[1]-a[1]).slice(0,3);
  for (const [actor] of favoriteBlueskyAuthors) {
    if (!cursor.authors[actor]) cursor.authors[actor]={cursor:null,done:false};
  }
  for (const term of recommendationQueries(preferences)) {
    if (!cursor.topics[term]) cursor.topics[term]={limePage:0,limeDone:false,blueCursor:null,blueDone:false};
  }
  const favoriteNativeAuthors=Object.entries(preferences.authors).filter(([id])=>/^[0-9a-f-]{36}$/i.test(id) && id!==viewerId).sort((a,b)=>b[1]-a[1]).slice(0,2);
  for (const [author] of favoriteNativeAuthors) if(!cursor.nativeAuthors[author]) cursor.nativeAuthors[author]={page:0,done:false};
  if(cursor.remaining.length<20) {
    const jobs:{load:()=>Promise<PostWithAuthor[]>}[]=[];
    if(!cursor.lime.done) jobs.push({load:async()=>{
      const rows=await getFeed(cursor.lime.page,60,cursor.lime.before);
      cursor.lime.page++;cursor.lime.done=rows.length<60;
      const last=rows[rows.length-1];if(last) cursor.lime.before={createdAt:last.createdAt,id:last.id};
      return rows;
    }});
    if(!cursor.trending.done) jobs.push({load:async()=>{
      const page=await fetchTrendingJapaneseBlueskyPosts({cursor:cursor.trending.cursor,limit:30,signal});
      cursor.trending.done=!page.cursor || page.cursor===cursor.trending.cursor;cursor.trending.cursor=page.cursor ?? null;
      return page.posts.map(normalizeTimelineBlueskyPost);
    }});
    for(const [actor,state] of Object.entries(cursor.authors)) {
      if(state.done) continue;
      jobs.push({load:async()=>{
        const page=await fetchBlueskyAuthorFeed({actor,cursor:state.cursor,limit:15,signal});
        state.done=!page.cursor || page.cursor===state.cursor;state.cursor=page.cursor ?? null;
        return page.posts.map(normalizeTimelineBlueskyPost);
      }});
    }
    for (const [term,state] of Object.entries(cursor.topics)) {
      if(!state.limeDone) jobs.push({load:async()=>{
        const rows=await searchPosts(term,state.limePage,20);
        state.limePage++;state.limeDone=rows.length<20;return rows;
      }});
      if(!state.blueDone) jobs.push({load:async()=>{
        const page=await fetchBlueskyTopicPosts({query:term,cursor:state.blueCursor,limit:20,signal});
        state.blueDone=!page.cursor || page.cursor===state.blueCursor;state.blueCursor=page.cursor ?? null;
        return page.posts.map(normalizeTimelineBlueskyPost);
      }});
    }
    for(const [author,state] of Object.entries(cursor.nativeAuthors)) if(!state.done) jobs.push({load:async()=>{
      const rows=await getPostsByUser(author,state.page,20);state.page++;state.done=rows.length<20;return rows;
    }});
    const results:PromiseSettledResult<PostWithAuthor[]>[]=new Array(jobs.length);
    let nextJob=0;
    await Promise.all(Array.from({length:Math.min(2,jobs.length)},async()=>{
      while(nextJob<jobs.length) {
        if(signal?.aborted)throw signal.reason;
        const index=nextJob++;
        try {results[index]={status:'fulfilled',value:await jobs[index].load()};}
        catch(reason) {results[index]={status:'rejected',reason};}
      }
    }));
    const successful=results.filter(result=>result.status==='fulfilled');
    const failed=results.find((result):result is PromiseRejectedResult=>result.status==='rejected');
    if(failed && !cursor.remaining.length && successful.every(result=>result.status==='fulfilled' && !result.value.length)) throw failed.reason;
    // Retain failed source cursors for retry; never discard the other service.
    for(const result of results) if(result.status==='fulfilled') cursor.remaining.push(...result.value);
  }
  if(signal?.aborted) throw new DOMException('Aborted','AbortError');
  const seen=new Set(cursor.seen);
  const ranked=rankRecommendations(cursor.remaining.filter(post=>!seen.has(post.id)),preferences,viewerId,Date.now(),cursor.history);
  const posts=ranked.slice(0,20);cursor.remaining=ranked.slice(20);cursor.seen.push(...posts.map(p=>p.id));cursor.history=[...cursor.history,...posts].slice(-6);
  const more=cursor.remaining.length>0 || !cursor.lime.done || !cursor.trending.done || Object.values(cursor.authors).some(state=>!state.done) || Object.values(cursor.topics).some(state=>!state.limeDone || !state.blueDone) || Object.values(cursor.nativeAuthors).some(state=>!state.done);
  return {posts,next:more?cursor:undefined};
}
