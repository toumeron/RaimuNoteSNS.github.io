import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { selectPopularPosts, validateSummary, selectNewsTopic, topicSelectionPrompt, focusedNewsPrompt, type NewsPost, type BlueskyPost } from './sources.ts';

serve(async (): Promise<Response> => {
  const headers = {'Content-Type': 'application/json'};
  try {
    const key = Deno.env.get('GEMINI_API_KEY');
    const url = Deno.env.get('SUPABASE_URL');
    const service = Deno.env.get('PRIVATE_SERVICE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!key || !url || !service) throw new Error('Missing news configuration');
    const db = createClient(url, service);
    const results = await Promise.allSettled(['limenote', 'bluesky'].map(async source => {
      let posts: NewsPost[];
      if (source === 'limenote') {
        const result = await db.from('posts').select('id, content').eq('visibility', 'public').order('created_at', {ascending: false}).limit(10);
        if (result.error) throw new Error(result.error.message);
        posts = result.data || [];
      } else {
        const batches = await Promise.allSettled(['の', 'は', 'た', 'です'].map(async q => {
          const params = new URLSearchParams({q, lang: 'ja', sort: 'top', since: new Date(Date.now() - 5 * 86400000).toISOString(), limit: '100'});
          for (const host of ['public.api.bsky.app', 'api.bsky.app']) {
            const response = await fetch(`https://${host}/xrpc/app.bsky.feed.searchPosts?${params}`, {signal: AbortSignal.timeout(15000)});
            if (response.ok) return (await response.json()).posts as BlueskyPost[];
          }
          throw new Error('Bluesky popular search unavailable');
        }));
        posts = selectPopularPosts(batches.flatMap(b => b.status === 'fulfilled' ? b.value : []));
      }
      if (!posts.length) throw new Error(`${source}: no public source posts`);
      const generate = async (prompt: string) => {
        let response: Response | undefined;
        for (let attempt = 0; attempt < 3; attempt++) {
          response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
            method: 'POST', headers, signal: AbortSignal.timeout(60000),
            body: JSON.stringify({contents: [{parts: [{text: prompt}]}], generationConfig: {responseMimeType: 'application/json'}}),
          });
          if (![429, 502, 503, 504].includes(response.status) || attempt === 2) break;
          await response.body?.cancel();
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
        if (!response) throw new Error('News AI unavailable');
        if (!response.ok) throw new Error(`News AI request failed (${response.status})`);
        const data = await response.json();
        const raw = data.candidates?.[0]?.content?.parts?.map((p: {text?: string}) => p.text || '').join('');
        return JSON.parse(raw || '{}');
      };
      const selection = selectNewsTopic(await generate(topicSelectionPrompt(posts)), posts);
      const summary = validateSummary(await generate(focusedNewsPrompt(selection.topic, selection.posts)), selection.posts);
      // Recheck visibility after generation; the author may have restricted a post meanwhile.
      if (source === 'limenote') {
        const check = await db.from('posts').select('id').in('id', summary.related_post_ids).eq('visibility', 'public');
        if (check.error || check.data?.length !== summary.related_post_ids.length) throw new Error('Source visibility changed');
      }
      const saved = await db.from('news_summaries').insert({...summary, source, public_sources_verified: true, source_post_ids: summary.related_post_ids});
      if (saved.error) throw new Error(saved.error.message);
      return {source, sourcePostsCount: posts.length};
    }));
    return new Response(JSON.stringify({results: results.map((r, i) => r.status === 'fulfilled' ? r.value : {source: i ? 'bluesky' : 'limenote', error: r.reason instanceof Error ? r.reason.message : 'Generation failed'})}), {status: results.every(r => r.status === 'rejected') ? 500 : 200, headers});
  } catch { return new Response(JSON.stringify({error: 'News generation failed'}), {status: 500, headers}); }
});
