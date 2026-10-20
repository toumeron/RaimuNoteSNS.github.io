import { loadBlueskySearch } from "./bluesky.ts";
Deno.test('searches the fixed search AppView and preserves query/cursor without forwarding credentials',async()=>{
 const original=globalThis.fetch;let called='';globalThis.fetch=async(input,init)=>{called=String(input);if(new Headers((init as RequestInit|undefined)?.headers).has('Authorization'))throw new Error('Provider credential forwarded');return Response.json({posts:[{uri:'at://example'}],cursor:'next'});};
 try{const result=await loadBlueskySearch('app.bsky.feed.searchPosts',{q:'JR東日本',limit:'30',cursor:'before'}) as {cursor:string};const url=new URL(called);if(url.origin!=='https://api.bsky.app'||url.searchParams.get('q')!=='JR東日本'||url.searchParams.get('cursor')!=='before'||result.cursor!=='next')throw new Error('Search metadata lost');}finally{globalThis.fetch=original;}
});
Deno.test('refuses writes, arbitrary targets, credentials and unbounded requests',async()=>{
 for(const [endpoint,params]of [['com.atproto.repo.createRecord',{q:'test'}],['https://evil.test',{q:'test'}],['app.bsky.feed.searchPosts',{q:'test',accessJwt:'secret'}],['app.bsky.feed.searchPosts',{q:'test',limit:'1000'}],['app.bsky.feed.searchPosts',{q:''}]] as const){let rejected=false;try{await loadBlueskySearch(endpoint,params);}catch{rejected=true;}if(!rejected)throw new Error('Invalid request accepted');}
});
Deno.test('reports upstream errors without replacing them with an empty search result',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response('{}',{status:503});try{let rejected=false;try{await loadBlueskySearch('app.bsky.feed.searchPosts',{q:'JR東日本'});}catch{rejected=true;}if(!rejected)throw new Error('Provider failure hidden');}finally{globalThis.fetch=original;}
});
