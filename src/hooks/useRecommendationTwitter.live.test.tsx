vi.mock("@/api/search-news", async importOriginal => ({...await importOriginal<typeof import("@/api/search-news")>(), relayTwitterSearch:async(query:string,feed:string,offset:number)=>loadTwitterSearch(query,feed,offset)}));

import {expect,it,vi} from 'vitest';
import { loadTwitterSearch } from "../../supabase/functions/link-preview/metadata.ts";
// Read real public account media. These are retrieval candidates, not evidence
// that an unexamined image is suitable for a viewer's recommendation feed.

import {getRecommendationTwitterPage} from "@/api/search-news";
const actor=process.env.LIME_LIVE_TWITTER_ACTOR;
it.skipIf(process.env.LIME_LIVE_TWITTER_TEST!=='1'||!actor)('retrieves public account media without caption keywords, preserving a separate continuation',async()=>{
 const preferences={visualOnly:true,allowUnverifiedMedia:true,authors:{},terms:{},followedTopics:[] as any,followedAuthors:[actor!]};
 const first=await getRecommendationTwitterPage(preferences,undefined,undefined,'live-author-candidates');
 expect(first.error).toBeUndefined();expect(first.posts.length).toBeGreaterThan(0);
 expect(first.posts.every(post=>post.imageUrls.length>0)).toBe(true);
 expect(first.state.positions).toEqual({});
 expect(first.state.authors?.[actor!]).toBeDefined();
},20000);
