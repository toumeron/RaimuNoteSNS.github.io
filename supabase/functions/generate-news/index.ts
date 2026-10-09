import { secretMatches } from '../_shared/security.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { newsRefreshIsDue, loadRecentLimeNewsPosts, recentNewsWindow, selectRecentNewsPosts, selectPopularPosts, validateSummary, selectNewsTopic, topicSelectionPrompt, focusedNewsPrompt, type NewsPost, type BlueskyPost } from './sources.ts';

serve(async (request:Request): Promise<Response> => {
  const headers = {'Content-Type': 'application/json', 'Cache-Control': 'no-store'};
  if (request.method !== 'POST') return Response.json({error: 'Method not allowed'}, {status: 405, headers});
  if (!await secretMatches(request.headers.get('x-news-secret'), Deno.env.get('NEWS_CRON_SECRET'))) return Response.json({error: 'Unauthorized'}, {status: 401, headers});
  try {
    const key = Deno.env.get('GEMINI_API_KEY');
    const url = Deno.env.get('SUPABASE_URL');
    const service = Deno.env.get('PRIVATE_SERVICE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!key || !url || !service) throw new Error('Missing news configuration');
    const db = createClient(url, service);
    const newsDb = db as unknown as Parameters<typeof loadRecentLimeNewsPosts>[0];
    const input=await request.json().catch(()=>({}));
    const scheduled=input?.scheduled===true;
    const results = await Promise.allSettled(['limenote', 'bluesky'].map(async source => {
      if(scheduled){
        const state=await db.from('news_generation_state').select('last_completed_at,last_attempted_at').eq('source',source).maybeSingle();
        if(state.error)throw new Error(state.error.message);
        if(!newsRefreshIsDue(state.data))return {source,skipped:true};
      }
      const claim=await db.rpc('claim_news_generation',{p_source:source,p_scheduled:scheduled});
      if(claim.error)throw new Error(claim.error.message);
      if(!claim.data)return {source,skipped:true};
      let completed=false;
      let failure:string|null=null;
      try{
      let posts: NewsPost[];
      if (source === 'limenote') {
        posts = await loadRecentLimeNewsPosts(newsDb);
      } else {
        const batches = await Promise.allSettled(['の', 'は', 'た', 'です'].map(async q => {
          const params = new URLSearchParams({q, lang: 'ja', sort: 'top', since: recentNewsWindow().since, limit: '100'});
          for (const host of ['public.api.bsky.app', 'api.bsky.app']) {
            const response = await fetch(`https://${host}/xrpc/app.bsky.feed.searchPosts?${params}`, {signal: AbortSignal.timeout(15000)});
            if (response.ok) return (await response.json()).posts as BlueskyPost[];
          }
          throw new Error('Bluesky popular search unavailable');
        }));
        posts = selectPopularPosts(batches.flatMap(b => b.status === 'fulfilled' ? b.value : []),Date.now(),200);
      }
      if (!posts.length) throw new Error(`${source}: no public source posts`);
      const generate = async (prompt: string) => {
        let response: Response | undefined;
        for (let attempt = 0; attempt < 3; attempt++) {
          // Rate limits and transient outages should not stop both news sources.
          const model=attempt===0?'gemini-2.5-flash':'gemini-3.1-flash-lite';
          response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
            method: 'POST', headers, signal: AbortSignal.timeout(60000),
            body: JSON.stringify({contents: [{parts: [{text: prompt}]}], generationConfig: {responseMimeType: 'application/json', ...(attempt===0?{thinkingConfig:{thinkingBudget:1024}}:{})}}),
          });
          if (![429, 502, 503, 504].includes(response.status) || attempt === 2) break;
          const retryAfter=Number(response.headers.get('Retry-After'));
          await response.body?.cancel();
          await new Promise(resolve => setTimeout(resolve, Number.isFinite(retryAfter)&&retryAfter>0?Math.min(retryAfter,30)*1000:5000*(attempt+1)));
        }
        if (!response) throw new Error('News AI unavailable');
        if (!response.ok) throw new Error(`News AI request failed (${response.status})`);
        const data = await response.json();
        const raw = data.candidates?.[0]?.content?.parts?.map((p: {text?: string}) => p.text || '').join('');
        return JSON.parse(raw || '{}');
      };
      const candidates=posts;
      let selection: ReturnType<typeof selectNewsTopic> | undefined;
      let excludedTopic='';
      for(let topicAttempt=0;topicAttempt<2;topicAttempt++){
        posts=candidates;
        selection = selectNewsTopic(await generate(topicSelectionPrompt(posts)+(excludedTopic?`\n「${excludedTopic}」は同じ出来事の根拠が不足したため除外し、別の具体的な出来事を選んでください。`:'')), posts,0);
        // The broad pool chooses the story; only relevant posts become sources.
        // Expand a sparse topic before writing, instead of publishing a one-post analysis.
        if(selection.query){
          if(source==='limenote'){
            const extra=await loadRecentLimeNewsPosts(newsDb,{query:selection.query,limit:100});
            posts=[...new Map([...selection.posts,...extra].map(p=>[p.id,p])).values()];
          }else{
            const params=new URLSearchParams({q:selection.query,lang:'ja',sort:'top',since:recentNewsWindow().since,limit:'100'});
            for(const host of ['public.api.bsky.app','api.bsky.app']){
              const response=await fetch(`https://${host}/xrpc/app.bsky.feed.searchPosts?${params}`,{signal:AbortSignal.timeout(15000)});
              if(response.ok){const extra=selectPopularPosts((await response.json()).posts,Date.now(),100);posts=[...new Map([...selection.posts,...extra].map(p=>[p.id,p])).values()];break;}
              await response.body?.cancel();
            }
          }
          selection=selectNewsTopic(await generate(topicSelectionPrompt(posts,selection.topic)),posts,0);
        }
        if(selection.posts.length>=5)break;
        excludedTopic=selection.topic;
      }
      if(!selection || selection.posts.length<5)throw new Error(`${source}: fewer than five relevant public source posts after topic search`);
      const summary = validateSummary(await generate(focusedNewsPrompt(selection.topic, selection.posts)), selection.posts,5);
      // Generation may outlive the freshness window; recheck before saving.
      const currentSources=selectRecentNewsPosts(selection.posts);
      if(summary.related_post_ids.some(id=>!currentSources.some(post=>post.id===id)))throw new Error('Source posts are no longer recent');
      // Recheck visibility after generation; the author may have restricted a post meanwhile.
      if (source === 'limenote') {
        const check = await loadRecentLimeNewsPosts(newsDb,{ids:summary.related_post_ids});
        if (check.length !== summary.related_post_ids.length) throw new Error('Source visibility or freshness changed');
      }
      const saved = await db.from('news_summaries').insert({...summary, source, public_sources_verified: true, source_post_ids: summary.related_post_ids});
      if (saved.error) throw new Error(saved.error.message);
      completed=true;
      return {source, sourcePostsCount: selection.posts.length, citedPostsCount:summary.related_post_ids.length, candidatePostsCount:posts.length};
      }catch(error){failure=error instanceof Error?error.message:'Generation failed';throw error;}
      finally{
        const release=await db.from('news_generation_state').update({lease_token:null,lease_until:null,last_error:failure,...(completed?{last_completed_at:new Date().toISOString()}:{})}).eq('source',source).eq('lease_token',claim.data);
        if(release.error)throw new Error('Cannot update news refresh state');
      }
    }));
    return new Response(JSON.stringify({results: results.map((r, i) => r.status === 'fulfilled' ? r.value : {source: i ? 'bluesky' : 'limenote', error: r.reason instanceof Error ? r.reason.message : 'Generation failed'})}), {status: results.every(r => r.status === 'rejected') ? 500 : 200, headers});
  } catch { return new Response(JSON.stringify({error: 'News generation failed'}), {status: 500, headers}); }
});
