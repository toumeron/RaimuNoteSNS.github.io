import { isTimelinePost } from "@/lib/timelinePaging";
import { matchingTopics, TOPICS, isTopicId, topicAffinity, type TopicId, type TopicPreferences, GLOBAL_TOPICS } from "@/lib/topics";
import { type PostWithAuthor } from "@/types/index";
import { visualSimilarity as directVisualSimilarity, createVisualSimilarityComparator, readVisualCache, applyCachedRecommendationVisuals, visualMatchesRecommendationTopic, restoreRecommendationVisuals, classifyRecommendationVisual, recommendationImageIdentity } from "@/lib/recommendationVisual";
import { type RecommendationCursor } from "@/api/recommendations";
import { type getBalancedRecommendationPage } from "@/api/balanced-recommendations";

// recommendationSignals
type Signals={content?:string;imageAltTexts?:string[];recommendationTopics?:string[];recommendationVisual?:PostWithAuthor['recommendationVisual'];author?:{id?:string;bio?:string};linkPreview?:{title?:string;description?:string};parentPost?:Signals|null};
function recommendationText(post:Signals):string {
 return [post.content,...(post.imageAltTexts??[]),post.linkPreview?.title,post.linkPreview?.description,post.parentPost?.content,...(post.parentPost?.imageAltTexts??[]),post.parentPost?.linkPreview?.title,post.parentPost?.linkPreview?.description].filter(Boolean).join(' ');
}
/** Source context and media/link metadata remain usable when body text is empty. */
function recommendationTopicSignals(post:Signals):TopicId[] {
 const own=[...(post.recommendationVisual?.topics??[]),...(post.recommendationTopics??[]).filter(isTopicId),...matchingTopics([post.content,...(post.imageAltTexts??[]),post.linkPreview?.title,post.linkPreview?.description].filter(Boolean).join(' '))];
 const parent=post.parentPost?[...(post.parentPost.recommendationTopics??[]).filter(isTopicId),...matchingTopics([post.parentPost.content,...(post.parentPost.imageAltTexts??[]),post.parentPost.linkPreview?.title,post.parentPost.linkPreview?.description].filter(Boolean).join(' '))]:[];
 return [...new Set([...own,...parent])];
}
/** Work content overrides broad creator biographies and retrieval-feed labels. */
function hasCuratedArtworkSource(post:PostWithAuthor,followed:TopicId[]):boolean {
 if(!post.imageUrls.length||post.imageUrls.every(url=>url===post.linkPreview?.image)||isDeclaredGeneratedArt(post)||(post.recommendationVisual&&post.recommendationVisual.kind!=='unknown'))return false;
 if(!(post.recommendationTopics??[]).some(topic=>(topic==='anime'||topic==='digital-illustration')&&followed.includes(topic)))return false;
 return (post.recommendationSources??[]).some(source=>/^at:\/\/did:[^/]+\/app\.bsky\.feed\.generator\/[^/]+$/.test(source));
}
/** Require both work-specific subject and creator evidence for twitter artwork. */
function hasDeclaredArtworkContext(post:PostWithAuthor,followed:TopicId[]):boolean {
 if(!(post.source==='x'||post.id.startsWith('x:'))||!post.imageUrls.length||(post.recommendationVisual&&post.recommendationVisual.kind!=='unknown')||isDeclaredGeneratedArt(post))return false;
 if(!/イラストレーター|絵描|お絵(?:描|か)き|落書き|らくがき|漫画家|漫画描|アニメーター|絵(?:を)?描|イラスト.*(?:描|制作)|artist|illustrat|animator|drawing|sketch/i.test(post.author?.bio??''))return false;
 return matchingTopics(recommendationText(post)).some(topic=>(topic==='anime'||topic==='digital-illustration')&&followed.includes(topic))||((post.recommendationSources??[]).some(source=>source.startsWith('twitter-interest:#'))&&(post.recommendationTopics??[]).some(topic=>(topic==='anime'||topic==='digital-illustration')&&followed.includes(topic)));
}
function recommendationMatchesFollowedTopics(post:PostWithAuthor,followed:TopicId[]):boolean {
 if(!followed.length)return true;
 if(followed.includes('ai')&&isDeclaredGeneratedArt(post))return true;
 const visual=post.recommendationVisual;
 const workTopics=[...new Set([
   ...(visual&&visual.kind!=='unknown'?visual.topics:[]),
   ...matchingTopics(recommendationText(post).replace(/(?:no|non|not|anti)[ -]?ai(?:[ -]?(?:art|generated))?|AI(?:学習|生成)?(?:に)?(?:禁止|反対|不使用)|AI(?:生成|イラスト|画像|絵)(?:ではない|ではありません|じゃない)|生成AI(?:不使用|反対)|AIを(?:使わない|使用しない)/gi,'')),
 ])];
 const specificTopics=workTopics.filter(topic=>topic!=='art');
 if(specificTopics.length)return specificTopics.some(topic=>followed.includes(topic));
 if(workTopics.length&&followed.includes('art'))return true;
 if(hasCuratedArtworkSource(post,followed)||hasDeclaredArtworkContext(post,followed))return true;
 // Image-only work may use a curated feed or learned creator subject, never a generic author affinity.
 const source=[...(post.recommendationTopics??[]),...(post.parentPost?.recommendationTopics??[])];
 // General illustration feeds also contain cars, landscapes and animals.
 // Retrieval labels alone cannot establish an anime/character-art subject.
 if(source.some(topic=>isTopicId(topic)&&followed.includes(topic)&&topic!=='anime'&&topic!=='digital-illustration'))return true;
 const creatorTopics=matchingTopics(post.author?.bio??'');
 if(creatorTopics.some(topic=>followed.includes(topic)&&(topic==='anime'||topic==='digital-illustration'))&&
   (!recommendationText(post).trim()||/イラスト|線画|お絵描き|落書き|らくがき|illustration|drawing|sketch/i.test(recommendationText(post))))return true;
 // A daily caption does not become art because the author also draws art.
 if(recommendationText(post).trim())return false;
 return (post.recommendationAuthorTopics??[]).some(topic=>isTopicId(topic)&&followed.includes(topic));
}

function recommendationTopicAffinity(post:PostWithAuthor,preferences:Partial<TopicPreferences>,learned:Partial<Record<TopicId,number>>={}):number {
 const sources=new Set([...(post.recommendationTopics??[]),...(post.parentPost?.recommendationTopics??[])]);
 const text=new Set(matchingTopics(`${post.content} ${post.parentPost?.content??''}`));
 const metadata=new Set(matchingTopics([...(post.imageAltTexts??[]),post.linkPreview?.title,post.linkPreview?.description,...(post.parentPost?.imageAltTexts??[]),post.parentPost?.linkPreview?.title].filter(Boolean).join(' ')));
 const hints=new Set([...(post.recommendationAuthorTopics??[]).filter(isTopicId),...matchingTopics(post.author?.bio??'')]);
 const visual=post.recommendationVisual;
 const strength=(id:TopicId)=>{
  if(visual?.topics.includes(id))return .8+.2*visual.confidence;
  // A feed is a retrieval hint, not a content label. A confidently different
  // image must not inherit full relevance from its retrieval source.
  const conflict=!!visual&&visual.kind!=='unknown'&&visual.topics.length>0;
  return Math.max(sources.has(id)?(conflict?.08:.2):0,metadata.has(id)?(conflict?.08:.2):0,text.has(id)?.08:0,hints.has(id)?(conflict?.08:.25):0,Math.min(.35,Math.log1p(learned[id]??0)/6));
 };
 // Mentioning many topic names cannot accumulate a larger relevance boost.
 return Math.min(1,(preferences.followed??[]).reduce((sum,id)=>sum+strength(id),0))-2*Math.min(1,(preferences.dismissed??[]).reduce((sum,id)=>sum+strength(id),0));
}
function topicAuthorCandidates(posts:PostWithAuthor[],followed:TopicId[]):{actor:string;topics:TopicId[]}[] {
 const authors=new Map<string,Map<TopicId,Set<string>>>();
 for(const post of posts){
  // Text-only search hits do not recruit creators into a topic indefinitely.
  const topics=(post.recommendationVisual?post.recommendationVisual.topics:post.imageUrls.length?[]:(post.recommendationTopics??[]).filter(isTopicId)).filter(topic=>followed.includes(topic));
  if(!topics.length)continue;
  const counts=authors.get(post.userId)??new Map<TopicId,Set<string>>();
  for(const topic of topics){const ids=counts.get(topic)??new Set<string>();ids.add(post.id);counts.set(topic,ids);}
  authors.set(post.userId,counts);
 }
 const ranked=[...authors].map(([actor,counts])=>({actor,topics:[...counts].filter(([,ids])=>ids.size>=2).map(([topic])=>topic),works:Math.max(...[...counts.values()].map(ids=>ids.size))})).filter(row=>row.topics.length).sort((a,b)=>b.works-a.works);
 const selected:{actor:string;topics:TopicId[]}[]=[];
 for(const topic of followed)for(const prefix of ['did:','misskey-user:','x-user:']){
  const candidate=ranked.find(row=>row.actor.startsWith(prefix)&&row.topics.includes(topic)&&!selected.some(old=>old.actor===row.actor));
  if(candidate&&selected.filter(row=>row.actor.startsWith(prefix)).length<2)selected.push({actor:candidate.actor,topics:candidate.topics});
 }
 return selected;
}
/** Language context can follow a creator's works without requiring text on each work. */
function recommendationOriginLanguages(post:{languages?:string[];recommendationLanguages?:string[];content?:string;author?:{bio?:string;displayName?:string}}):string[] {
 if(post.languages?.length)return post.languages.filter(lang=>/^ja(?:-|$)/i.test(lang)).length?['ja']:[];
 if(post.recommendationLanguages?.includes('ja'))return ['ja'];
 return /[\u3040-\u30ff]/.test([post.content,post.author?.bio,post.author?.displayName].filter(Boolean).join(' '))?['ja']:[];
}

function recommendationIdentity(post:Pick<PostWithAuthor,'id'|'blueskyUri'>):string {
 const uri=post.blueskyUri??post.id.replace(/^bsky:/,'');
 return uri.startsWith('at://')?`bsky:${uri}`:post.id;
}
/** Identify the same work across resized CDN URLs, copied posts and page boundaries. */
function recommendationFingerprint(post:Pick<PostWithAuthor,'content'|'imageUrls'>):string|undefined {
 const media=post.imageUrls.map(raw=>{
  try{const url=new URL(raw);for(const key of ['w','h','width','height','format','q','quality','fit','auto','resize'])url.searchParams.delete(key);url.hash='';const blob=url.hostname==='cdn.bsky.app'?url.pathname.match(/\/(baf[a-z0-9]+)(?:@[a-z]+)?$/i)?.[1]:undefined;if(blob)return `bsky-media:${blob}`;url.pathname=url.pathname.replace(/\/img\/feed_(?:thumbnail|fullsize)\//,'/img/feed/');return url.toString();}catch{return raw;}
 }).sort();
 const text=post.content.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
 if(!media.length&&text.length<32)return undefined;
 const value=media.length?JSON.stringify(media):text;
 let a=2166136261,b=5381;for(let i=0;i<value.length;i++){a=Math.imul(a^value.charCodeAt(i),16777619);b=Math.imul(b,33)^value.charCodeAt(i);}
 return `fp:${(a>>>0).toString(36)}:${(b>>>0).toString(36)}`;
}

function isDeclaredGeneratedArt(post:PostWithAuthor):boolean {
 const text=[post.content,...(post.imageAltTexts??[]),post.author?.bio??''].join('\n').normalize('NFKC')
  .replace(/(?:no|non|not|anti)[ -]?ai(?:[ -]?(?:art|generated))?|AI(?:学習|生成)?(?:に)?(?:禁止|反対|不使用)|AI(?:生成|イラスト|画像|絵)(?:ではない|ではありません|じゃない)|生成AI(?:不使用|反対)|AIを(?:使わない|使用しない)/gi,'');
 return (post.contentLabels??[]).some(label=>/^(?:ai-generated|generative-ai|synthetic-media)$/i.test(label)) || /AI[ _-]?(?:イラスト|画像|生成|絵|art|generated)|生成AI|人工知能で(?:描|生成)|midjourney|stable[ _-]?diffusion|novelai|dall[ -]?e|#AIart/i.test(text);
}

const japanese=(text:string)=>/[\u3040-\u30ff]/.test(text);
/** Language records take precedence over inferred origin. Country is never inferred from a name. */
/** Crypto promotion is not character-art interest, even when its picture is a drawing. */
function isUnrelatedCryptoRecommendation(post:PostWithAuthor,followed:TopicId[]):boolean {
 if(followed.includes('crypto'))return false;
 const text=recommendationText(post).normalize('NFKC').replace(/(?:no|not|anti)[ -]?(?:NFTs?|crypto)|NFT(?:化)?(?:禁止|不可|お断り)|NFT(?:化)?(?:は|を)?(?:しない|しません)/gi,'');
 return /\b(?:NFTs?|web3|opensea|rarible|ethereum|crypto|blockchain|minting)\b|暗号資産|仮想通貨|ミント(?:開始|販売)|エアドロップ/i.test(text)||/https?:\/\/(?:[^/]+\.)?(?:opensea\.io|foundation\.app|rarible\.com)\//i.test(post.content);
}
function recommendationIsEligible(post:PostWithAuthor,followed:TopicId[]=[]):boolean {
 if(isUnrelatedCryptoRecommendation(post,followed))return false;
 if(!isTimelinePost(post))return false;
 const external=post.source==='bluesky'||post.source==='misskey'||post.source==='x'||post.id.startsWith('bsky:')||post.id.startsWith('misskey:')||post.id.startsWith('x:');
 const signals=recommendationTopicSignals(post);
 const digital=followed.includes('digital-illustration');
 const visual=post.recommendationVisual;
 if(followed.length&&visual&&visual.kind!=='unknown'&&visual.topics.length&&!visual.topics.some(topic=>followed.includes(topic)))return false;
 const digitalContext=post.recommendationTopics?.includes('digital-illustration')||post.recommendationAuthorTopics?.includes('digital-illustration')||hasDeclaredArtworkContext(post,followed);
 const digitalMatch=digital&&post.imageUrls.length>0&&!isDeclaredGeneratedArt(post)&&(visual?.kind==='moe'||(!visual&&!post.recommendationVisualStatus&&digitalContext)||(visual?.kind==='unknown'&&(hasCuratedArtworkSource(post,followed)||hasDeclaredArtworkContext(post,followed))));
 // A generic art feed, a photograph, or an author's unrelated update is not digital illustration.
 if(digital&&!digitalMatch&&!signals.some(id=>id!=='digital-illustration'&&followed.includes(id)))return false;
 if(!external)return true;
 const text=recommendationText(post);
 const prose=text.replace(/https?:\/\/\S+/g,'').replace(/#[\p{L}\p{N}_]+/gu,'');
 const jp=prose.match(/[\u3040-\u30ff\u3400-\u9fff]/g)?.length??0;
 const latin=prose.match(/[a-z]/gi)?.length??0;
 if((japanese(prose)&&jp>=latin/2)||post.languages?.some(lang=>/^ja(?:-|$)/i.test(lang)))return true;
 // An English post is allowed only when its actual topic matches a followed global topic.
 const globalSignals=visual&&visual.kind!=='unknown'?visual.topics:signals;
 if(globalSignals.some(id=>GLOBAL_TOPICS.includes(id)&&followed.includes(id)))return true;
 if(post.languages?.length)return false;
 if(/[\u3400-\u9fff]/.test(text)&&signals.length>0&&!/[a-z]{3,}/i.test(text))return true;
 const readable=text.replace(/https?:\/\/\S+/g,'').replace(/#[\p{L}\p{N}_]+/gu,'').trim();
 if(/[a-z]{3,}/i.test(readable))return false;
 // Empty/short posts need Japanese source or creator context, rather than a body keyword.
 return japanese(post.author?.bio??'')||japanese(post.author?.displayName??'')||post.recommendationLanguages?.includes('ja')===true;
}

type RecommendationAction = 'impression' | 'like' | 'repost' | 'bookmark' | 'not_interested';
function recordRecommendationEngagement(post: Pick<PostWithAuthor, 'id' | 'blueskyUri'>, viewer: string | null, action: RecommendationAction, active = true) {
 if (viewer) window.dispatchEvent(new CustomEvent('lime:recommendation-engagement', {detail: {id: recommendationIdentity(post), viewer, action, active}}));
}

// topicRecommendations
/** Content evidence outranks retrieval hints; a creator's bio is not post evidence. */
function topicPostRelevance(post:PostWithAuthor,topic:TopicId):number {
 const visual=post.recommendationVisual;
 if(visual?.kind!=='unknown'&&visual?.topics.length&&!visual.topics.includes(topic)&&!matchingTopics(post.content).includes(topic))return 0;
 if(visual?.topics.includes(topic)&&visual.confidence>=.6)return 3;
 if(matchingTopics(recommendationText(post)).includes(topic))return 2;
 return post.recommendationTopics?.includes(topic)?1:0;
}
/** Topic-only ranking. It deliberately does not consume the general feed's delivered history. */
function rankTopicPosts(posts:PostWithAuthor[],topic:TopicId,preferences:RecommendationPreferences,now:number):PostWithAuthor[] {
 const ids=new Set<string>(),fingerprints=new Set<string>();
 const score=(post:PostWithAuthor)=>{
  const age=Math.max(0,now-Date.parse(post.createdAt))/3600000;
  const affinity=Math.max(0,preferences.authors[post.userId]??0);
  const engagement=Math.log1p(Math.max(0,post.likesCount)+2*Math.max(0,post.repostsCount)+Math.max(0,post.commentsCount));
  const interest=recommendationTerms(recommendationText(post)).reduce((sum,term)=>sum+Math.log1p(Math.max(0,preferences.terms[term]??0)+Math.max(0,preferences.recentTerms?.[term]??0)),0);
  return topicPostRelevance(post,topic)*100+Math.min(8,interest)+Math.min(8,Math.log1p(affinity)*2)+Math.min(6,engagement)+5*Math.exp(-(Number.isFinite(age)?age:720)/72);
 };
 return posts.filter(post=>{
  const id=recommendationIdentity(post),fingerprint=recommendationFingerprint(post);
  if(ids.has(id)||fingerprint&&fingerprints.has(fingerprint)||!topicPostRelevance(post,topic)||!recommendationIsEligible(post,[topic])||recommendationIsDismissed(post,{...preferences,dismissedTopics:preferences.dismissedTopics?.filter(id=>id!==topic)}))return false;
  ids.add(id);if(fingerprint)fingerprints.add(fingerprint);return true;
 }).sort((a,b)=>score(b)-score(a)||b.createdAt.localeCompare(a.createdAt)||recommendationIdentity(a).localeCompare(recommendationIdentity(b)));
}

// recommendationPaging
function preserveRecommendationHistory(cursor:RecommendationCursor,shown:PostWithAuthor[]):RecommendationCursor {
 const seen=[...new Set([...cursor.seen,...shown.flatMap(post=>[recommendationIdentity(post),...(recommendationFingerprint(post)?[recommendationFingerprint(post)!]:[])])])];
 const allCounts={...(cursor.authorCounts??{})},shownCounts:Record<string,number>={};
 for(const post of shown)shownCounts[post.userId]=(shownCounts[post.userId]??0)+1;
 for(const [actor,count] of Object.entries(shownCounts))allCounts[actor]=Math.max(allCounts[actor]??0,count);
 const counts={...(cursor.twitterAuthorCounts??{})},handles={...(cursor.twitterAuthorHandles??{})},visibleCounts:Record<string,number>={};
 for(const post of shown)if(post.source==='x'||post.id.startsWith('x:')){visibleCounts[post.userId]=(visibleCounts[post.userId]??0)+1;handles[post.userId]=post.author.username;}
 for(const [actor,count] of Object.entries(visibleCounts))counts[actor]=Math.max(counts[actor]??0,count);
 const twitter=shown.filter(post=>post.source==='x'||post.id.startsWith('x:')).length;
 return {...cursor,seen,authorCounts:allCounts,twitterAuthorCounts:counts,twitterAuthorHandles:handles,history:shown.slice(-20),providerTotals:{twitter,other:shown.length-twitter}};
}
function uniqueRecommendationPosts(posts:PostWithAuthor[],shown:PostWithAuthor[]=[]):PostWithAuthor[] {
 const seen=new Set(shown.flatMap(post=>[recommendationIdentity(post),...(recommendationFingerprint(post)?[recommendationFingerprint(post)!]:[])]));
 return posts.filter(post=>{
  const id=recommendationIdentity(post),fingerprint=recommendationFingerprint(post);
  if(seen.has(id)||fingerprint&&seen.has(fingerprint))return false;
  seen.add(id);if(fingerprint)seen.add(fingerprint);return true;
 });
}

// recommendationReserve
type Page=Awaited<ReturnType<typeof getBalancedRecommendationPage>>;
const KEY='lime-recommendation-reserve-v2';
const MAX_AGE=120_000;
/** Only an unconsumed, accepted reserve is persisted, scoped to the active account and sources. */
function readRecommendationReserve(scope:string):Page|undefined{
 try{
  const entry=JSON.parse(sessionStorage.getItem(KEY)??'null');
  if(!entry||entry.scope!==scope||Date.now()-entry.at>MAX_AGE||Date.now()<entry.at)return;
  const page=entry.page;
  if(!Array.isArray(page?.posts)||page.posts.length<20||!page.preferences?.authors||!page.preferences?.terms)return;
  if(!page.posts.every((post:any)=>typeof post.id==='string'&&typeof post.userId==='string'&&post.author&&Array.isArray(post.imageUrls)))return;
  if(page.next&&(!Array.isArray(page.next.remaining)||!Array.isArray(page.next.seen)||!Array.isArray(page.next.history)))return;
  const posts=restoreRecommendationVisuals(page.posts);
  if(posts.some(post=>{const visual=post.recommendationVisual;return !visual||['unknown','render-3d','vehicle'].includes(visual.kind)||visual.confidence<.25||visual.similarity<.24||page.preferences.followedTopics?.length&&!page.preferences.followedTopics.some((topic:any)=>visualMatchesRecommendationTopic(visual,topic));}))return;
  return {...page,posts,preferences:{...page.preferences,visualOnly:true,allowUnverifiedMedia:false,likedSamples:restoreRecommendationVisuals(page.preferences.likedSamples??[])}};
 }catch{return;}
}
function saveRecommendationReserve(scope:string,page:Page){
 if(page.posts.length<20)return;
 try{sessionStorage.setItem(KEY,JSON.stringify({scope,at:Date.now(),page}));}catch{}
}
function clearRecommendationReserve(){try{sessionStorage.removeItem(KEY);sessionStorage.removeItem('lime-recommendation-reserve-v1');}catch{}}

// recommendationCatalog
const RECOMMENDATION_CATALOG_VERSION=1;
const RECOMMENDATION_CATALOG_MAX_AGE=2*60*60*1000;
type Catalog={version:number;generatedAt:string;model:string;revision:string;posts:PostWithAuthor[]};
const model='Xenova/clip-vit-base-patch32';
const revision='d15189d7028b43f1d3e65039190477f6af591c2a';
let cached:{expires:number;validUntil:number;posts:PostWithAuthor[]}|undefined;
let pending:Promise<PostWithAuthor[]>|undefined;
let bootstrapRead=false;

/** Restore reference and candidate vectors only for the same immutable image.
 * A matching author or caption is never sufficient evidence. */
function applyCatalogRecommendationVisuals(posts:PostWithAuthor[],catalog:PostWithAuthor[]):PostWithAuthor[]{
 const visuals=new Map(catalog.filter(post=>post.imageUrls[0]&&post.recommendationVisual).map(post=>[recommendationImageIdentity(post.imageUrls[0]),post.recommendationVisual!]));
 return posts.map(post=>{
  const visual=!post.recommendationVisual&&post.imageUrls[0]?visuals.get(recommendationImageIdentity(post.imageUrls[0])):undefined;
  return visual?{...post,recommendationVisual:visual,recommendationVisualStatus:'checked'}:post;
 });
}

/** Only public, already analysed candidates belong in the shared catalog.
 * Personal interests, likes and dismissals are applied locally by the ranker. */
function parseRecommendationCatalog(value:unknown,now=Date.now(),maxAge=RECOMMENDATION_CATALOG_MAX_AGE):PostWithAuthor[]{
 if(!value||typeof value!=='object')return [];
 const input=value as Catalog;
 const age=now-Date.parse(input.generatedAt);
 if(input.version!==RECOMMENDATION_CATALOG_VERSION||input.model!==model||input.revision!==revision||!Number.isFinite(age)||age< -60000||age>maxAge||!Array.isArray(input.posts)||input.posts.length>1000)return [];
 const ids=new Set<string>();
 return input.posts.filter(post=>{
  const visual=post?.recommendationVisual;
  if(!post||typeof post.id!=='string'||ids.has(post.id)||typeof post.userId!=='string'||post.author?.id!==post.userId||typeof post.author?.username!=='string'||post.visibility!=='public'||!['x','bluesky','misskey'].includes(post.source??'')||typeof post.content!=='string'||!Number.isFinite(Date.parse(post.createdAt))||!Array.isArray(post.imageUrls)||!post.imageUrls.length||!post.imageUrls.every(url=>{try{return new URL(url).protocol==='https:';}catch{return false;}})||!visual||visual.version!==1||!Array.isArray(visual.vector)||visual.vector.length!==512||!visual.vector.every(Number.isFinite))return false;
  // Reclassify with the application prototypes instead of trusting labels in
  // a shared artifact. No caption or feed label can certify an image.
  ids.add(post.id);return true;
 }).map(post=>({...post,likedByMe:false,repostedByMe:false,recommendationVisual:classifyRecommendationVisual(post.recommendationVisual!.vector),recommendationVisualStatus:'checked'}));
}

/** A bounded public read; never download the image model to read this catalog. */
async function readRecommendationCatalog(signal?:AbortSignal):Promise<PostWithAuthor[]>{
 if(signal?.aborted)throw signal.reason;
 const url=import.meta.env.VITE_RECOMMENDATION_CATALOG_URL;
 if(!url)return [];
 if(cached&&cached.validUntil>Date.now()){
  if(cached.expires<=Date.now()){
   cached.expires=Date.now()+60000;
   pending??=loadCatalog(url,5000).finally(()=>{pending=undefined;});
  }
  return cached.posts;
 }
 if(!bootstrapRead){
  bootstrapRead=true;
  // Public pixels are analysed during the build. This is a source catalog,
  // not a saved user's timeline; all personal quality gates still run below.
  // Keep a bounded offline fallback while the hourly public snapshot refreshes.
  const raw=import.meta.env.VITE_RECOMMENDATION_BOOTSTRAP;
  let bootstrap:unknown;try{bootstrap=typeof raw==='string'?JSON.parse(raw):raw;}catch{/* Ignore an invalid build artifact. */}
  const posts=parseRecommendationCatalog(bootstrap,Date.now(),7*24*60*60*1000);
  if(posts.length){
   cached={posts,expires:Date.now()+60000,validUntil:Date.parse((bootstrap as Catalog).generatedAt)+7*24*60*60*1000};
   pending??=loadCatalog(url,5000).finally(()=>{pending=undefined;});
   return posts;
  }
 }
 const job=pending??=loadCatalog(url).finally(()=>{pending=undefined;});
 if(!signal)return job;
 let abort:()=>void;
 const cancelled=new Promise<never>((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
 try{return await Promise.race([job,cancelled]);}
 finally{signal.removeEventListener('abort',abort!);}
}
async function loadCatalog(url:string,timeout=400):Promise<PostWithAuthor[]>{
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),timeout);
 try{
  const response=await fetch(url,{credentials:'omit',signal:controller.signal,referrerPolicy:'no-referrer'});
  if(!response.ok||Number(response.headers.get('content-length'))>8*1024*1024)return [];
  const text=await response.text();if(text.length>8*1024*1024)return [];
  const input=JSON.parse(text),posts=parseRecommendationCatalog(input);
  if(!posts.length)return [];
  cached={posts,validUntil:Date.parse(input.generatedAt)+7*24*60*60*1000,expires:Math.min(Date.now()+60000,Date.parse(input?.generatedAt)+RECOMMENDATION_CATALOG_MAX_AGE)};
  return posts;
 }catch{return [];}
 finally{clearTimeout(timer);}
}

// recommendations
// The scope ends with each scoring pass: no stale cache after feedback changes.
let compareVisual:ReturnType<typeof createVisualSimilarityComparator>|undefined;
const visualSimilarity=(a:number[],b:number[])=>compareVisual?compareVisual(a,b):directVisualSimilarity(a,b);
function withScoringComparisons<T>(read:()=>T):T{
 if(compareVisual)return read();
 compareVisual=createVisualSimilarityComparator();try{return read();}finally{compareVisual=undefined;}
}
type RecommendationFeedback={id:string;userId:string;fingerprint?:string;topics?:TopicId[];vector?:number[];imageUrls?:string[];visualKind?:string;createdAt:string};
type RecommendationPreferences = {
  visualOnly?:boolean;
  allowUnverifiedMedia?:boolean;
  authors: Record<string, number>;
  terms: Record<string, number>;
  recentAuthors?: Record<string, number>;
  recentTerms?: Record<string, number>;
  followedAuthors?: string[];
  likedPostIds?: string[];
  followedTopics?: TopicId[];
  dismissedTopics?: TopicId[];
  authorHandles?:Record<string,string>;
  authorLanguages?:Record<string,string[]>;
  authorTopics?:Record<string,Partial<Record<TopicId,number>>>;
  visualInterests?:number[][];
  likedSamples?:(PostWithAuthor & {engagedAt?:string})[];
  feedback?:RecommendationFeedback[];
};
/** Keep diverse compact references while all loaded likes contribute to scores. */
function selectRecommendationLikeSamples(rows:(PostWithAuthor & {engagedAt?:string})[],limit=128) {
 const ids=new Set<string>(),authors=new Set<string>();
 const unique=rows.filter(row=>{const id=recommendationIdentity(row);if(ids.has(id))return false;ids.add(id);return true;}).sort((a,b)=>(Date.parse(b.engagedAt??'')||0)-(Date.parse(a.engagedAt??'')||0));
 const selected:typeof rows=[],rest:typeof rows=[];
 for(const row of unique){if(!authors.has(row.userId)&&selected.length<limit){authors.add(row.userId);selected.push(row);}else rest.push(row);}
 for(const row of rest){if(selected.length>=limit)break;selected.push(row);}
 return selected.map(row=>({id:row.id,userId:row.userId,content:row.content.slice(0,2000),imageUrls:row.imageUrls.slice(0,4),imageAltTexts:row.imageAltTexts?.slice(0,4),source:row.source,languages:row.languages,recommendationLanguages:row.recommendationLanguages,recommendationTopics:row.recommendationTopics,recommendationAuthorTopics:row.recommendationAuthorTopics,recommendationSources:row.recommendationSources,recommendationVisual:row.recommendationVisual,engagedAt:row.engagedAt,author:{id:row.userId,username:row.author?.username,bio:row.author?.bio,displayName:row.author?.displayName}} as PostWithAuthor & {engagedAt?:string}));
}
const stopWords = new Set(['です','ます','した','して','する','ある','いる','これ','それ','ため','さん','こと','よう','今日','昨日','今回','自分','本当','こちら','みんな','https','http','www','com','the','and','with','this','that']);
const concepts = [
  ['cats','猫','ねこ','ネコ','cat','cats','kitten'],
  ['dogs','犬','いぬ','イヌ','dog','dogs','puppy'],
  ['art','イラスト','絵','お絵描き','illustration','drawing'],
  ['music','音楽','楽曲','music','ライブ','コンサート'],
  ['programming','プログラミング','開発','typescript','javascript','python','coding'],
];
let wordSegmenter:any;
const termCache=new Map<string,string[]>();
function recommendationTerms(content: string): string[] {
  const text=content.replace(/https?:\/\/\S+/g,' ').normalize('NFKC').toLowerCase();
  const cached=termCache.get(text);if(cached)return [...cached];
  const Segmenter=(Intl as any).Segmenter;
  if(Segmenter&&!wordSegmenter)wordSegmenter=new Segmenter('ja',{granularity:'word'});
  const words: string[]=Segmenter ? [...wordSegmenter.segment(text)].filter((s:any)=>s.isWordLike).map((s:any)=>s.segment) : text.match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms=[...new Set(words.filter(word=>!stopWords.has(word) && !/^\d+$/.test(word) && (word.length>1 || /\p{Script=Han}/u.test(word))))].slice(0,64);
  for(const [concept,...aliases] of concepts) if(aliases.some(alias=>terms.includes(alias))) terms.push(`topic:${concept}`);
  if(termCache.size>=512)termCache.delete(termCache.keys().next().value!);
  termCache.set(text,terms);return [...terms];
}
function addRecommendationInterest(preferences: RecommendationPreferences, post: {content?:string;userId?:string;user_id?:string;imageAltTexts?:string[];recommendationTopics?:string[];recommendationAuthorTopics?:string[];recommendationVisual?:PostWithAuthor['recommendationVisual'];linkPreview?:{title?:string;description?:string};languages?:string[];recommendationLanguages?:string[];author?:{id?:string;username?:string;bio?:string;displayName?:string}}, weight:number, eventAt?:string, now=Date.now()) {
  const timestamp=eventAt ? Date.parse(eventAt) : now;
  const age=Number.isFinite(timestamp)?Math.max(0,(now-timestamp)/86400000):30;
  const longWeight=weight*Math.pow(0.5,age/60);
  const recentWeight=weight*Math.pow(0.5,age/7);
  preferences.recentAuthors ??= {};
  preferences.recentTerms ??= {};
  if(post.recommendationVisual?.vector.length===512){preferences.visualInterests??=[];if(preferences.visualInterests.length<24)preferences.visualInterests.push(post.recommendationVisual.vector);}
  const author=post.userId ?? post.user_id ?? post.author?.id;
  if(author) {
    if(post.author?.username){preferences.authorHandles??={};preferences.authorHandles[author]=post.author.username;}
    preferences.authors[author]=(preferences.authors[author] ?? 0)+longWeight;
    preferences.recentAuthors[author]=(preferences.recentAuthors[author] ?? 0)+recentWeight;
    preferences.authorLanguages??={};
    preferences.authorLanguages[author]=[...new Set([...(preferences.authorLanguages[author]??[]),...recommendationOriginLanguages(post)])];
    preferences.authorTopics??={};const profile=preferences.authorTopics[author]??={};
    // A liked image-only work can carry creator context without body keywords.
    // Confident visual classification still takes precedence over source hints.
    const topics=post.recommendationVisual?.kind&&post.recommendationVisual.kind!=='unknown'
      ? post.recommendationVisual.topics
      : [...new Set([...recommendationTopicSignals(post),...(post.recommendationAuthorTopics??[]).filter(isTopicId)])];
    for(const topic of topics)profile[topic]=(profile[topic]??0)+longWeight;
  }
  const terms=recommendationTerms(recommendationText(post));
  // Normalize each event so verbose posts cannot dominate the user's profile.
  const lengthWeight=1/Math.sqrt(Math.max(1,terms.length));
  for(const term of terms) {
    preferences.terms[term]=(preferences.terms[term] ?? 0)+longWeight*lengthWeight;
    preferences.recentTerms[term]=(preferences.recentTerms[term] ?? 0)+recentWeight*lengthWeight;
  }
}
function recommendationQueries(preferences:RecommendationPreferences):string[] {
  if(preferences.visualOnly)return [];
  const explicit=TOPICS.filter(topic=>preferences.followedTopics?.includes(topic.id)).map(topic=>topic.queries[0]);
  const learned=Object.entries(preferences.terms).filter(([term])=>!term.startsWith('topic:') && topicAffinity(term,{dismissed:preferences.dismissedTopics})>=0)
    .sort((a,b)=>(b[1]+(preferences.recentTerms?.[b[0]] ?? 0))-(a[1]+(preferences.recentTerms?.[a[0]] ?? 0)))
    .slice(0,3).map(([term])=>term);
  // Keep a bounded candidate budget and leave a slot for learned interests.
  return [...new Set([...explicit.slice(0,2),...learned,...explicit.slice(2)])].slice(0,3);
}
type Impression={at:number;count:number};
const impressionKey=(viewerId:string|null)=>`lime_recommendation_impressions:${viewerId ?? 'guest'}`;
function readRecommendationImpressions(viewerId:string|null,now=Date.now()):Record<string,Impression> {
  try {
    const data:Record<string,Impression>=JSON.parse(localStorage.getItem(impressionKey(viewerId)) ?? '{}');
    return Object.fromEntries(Object.entries(data).filter(([,row]:[string,any])=>row && Number.isFinite(row.at) && row.at<=now && now-row.at<30*86400000 && Number.isFinite(row.count)));
  } catch {return {};}
}
function recordRecommendationImpression(id:string,viewerId:string|null,now=Date.now(),fingerprint?:string) {
  try {
    const data=readRecommendationImpressions(viewerId,now);
    for(const key of [id,...(fingerprint?[fingerprint]:[])])data[key]={at:now,count:Math.min(10,(data[key]?.count ?? 0)+1)};
    const rows=Object.entries(data).sort((a,b)=>b[1].at-a[1].at).slice(0,2000);
    localStorage.setItem(impressionKey(viewerId),JSON.stringify(Object.fromEntries(rows)));
  } catch { /* Storage is optional; never interrupt browsing. */ }
}
type RecommendationDelivery={at:number;userId:string;fingerprint?:string};
const deliveredMemory=new Map<string,Record<string,RecommendationDelivery>>();
const deliveredKey=(viewerId:string|null)=>`lime_recommendation_deliveries:${viewerId??'guest'}`;
function readRecommendationDeliveries(viewerId:string|null,now=Date.now()):Record<string,RecommendationDelivery>{
 // A fetched card is not a view. Reserve it briefly in this document so
 // overlapping requests cannot repeat it; only visible impressions persist.
 // Ignore legacy persisted deliveries, which suppressed unseen work for 30 days.
 const stored=deliveredMemory.get(deliveredKey(viewerId))??{};
 return Object.fromEntries(Object.entries(stored).filter(([,row])=>Number.isFinite(row.at)&&row.at<=now&&now-row.at<120000)) as Record<string,RecommendationDelivery>;
}
function recordRecommendationDelivery(posts:PostWithAuthor[],viewerId:string|null,now=Date.now()):void{
 const key=deliveredKey(viewerId),rows=readRecommendationDeliveries(viewerId,now);
 for(const post of posts)rows[recommendationIdentity(post)]={at:now,userId:post.userId,fingerprint:recommendationFingerprint(post)};
 const bounded=Object.fromEntries(Object.entries(rows).sort((a,b)=>b[1].at-a[1].at).slice(0,5000));
 deliveredMemory.set(key,bounded);
}
/** Keep a hard run limit independently of popularity or creator affinity. */
function selectRecommendationPage(ranked:PostWithAuthor[],preferences:RecommendationPreferences,history:PostWithAuthor[],limit=20){
 return withScoringComparisons(()=>selectRecommendationPageInternal(ranked,preferences,history,limit));
}
function selectRecommendationPageInternal(ranked:PostWithAuthor[],preferences:RecommendationPreferences,history:PostWithAuthor[],limit:number){
 const posts:PostWithAuthor[]=[],remaining=[...ranked];
 const feedback=activeRecommendationFeedback(preferences,Date.now());
 const scoring=prepareScoringContext(preferences,{},Date.now());
 const hasLikedPixels=preferences.likedSamples?.some(post=>post.recommendationVisual);
 while(posts.length<limit&&remaining.length){
  const recent=[...history.slice(-3),...posts].slice(-3),last=recent.at(-1)?.userId;
  let index=0;
  if(recent.length===3&&recent.every(post=>post.userId===last)){
   index=remaining.findIndex(post=>post.userId!==last&&scoreRecommendation(post,preferences,null,scoring).total>0&&(!hasLikedPixels||!!preferences.authors[post.userId]||relatedRecommendationScore(post,preferences.likedSamples??[],preferences,feedback)>0));
   // Prefer another related creator when available. A creator run is not
   // exhaustion: do not hide the remaining eligible works or keep fetching
   // unrelated sources merely to break the run.
   if(index<0)index=0;
  }
  posts.push(remaining.splice(index,1)[0]);
 }
 return {posts,remaining,blocked:posts.length<limit&&remaining.length>0};
}
type CosineProfile={vector:Record<string,number>;norm:number};
function prepareCosine(profile:Record<string,number>,idf:Record<string,number>):CosineProfile {
  const strongest=Object.entries(profile).filter(([,weight])=>weight>0).sort((a,b)=>b[1]-a[1]).slice(0,96);
  const vector=Object.fromEntries(strongest.map(([term,weight])=>[term,Math.log1p(weight)*(idf[term] ?? 1)]));
  return {vector,norm:Object.values(vector).reduce((sum,value)=>sum+value*value,0)};
}
function cosine(terms:string[],profile:Record<string,number>,idf:Record<string,number>,prepared?:CosineProfile):number{
  const {vector,norm:profileNorm}=prepared??prepareCosine(profile,idf);
  let dot=0,candidateNorm=0;
  for(const term of terms) {const weight=idf[term] ?? 1;dot+=weight*(vector[term] ?? 0);candidateNorm+=weight*weight;}

  return candidateNorm && profileNorm ? dot/Math.sqrt(candidateNorm*profileNorm):0;
}
function activeRecommendationFeedback(preferences:RecommendationPreferences,now:number):RecommendationFeedback[] {
 const positive=new Map<string,number>();
 for(const liked of preferences.likedSamples??[]){const at=Date.parse(liked.engagedAt??'');if(Number.isFinite(at))positive.set(liked.userId,Math.max(positive.get(liked.userId)??0,at));}
 return (preferences.feedback??[]).filter(row=>{const at=Date.parse(row.createdAt);return Number.isFinite(at)&&at>(positive.get(row.userId)??0);});
}
function imageFeedbackSimilarity(post:PostWithAuthor,feedback:RecommendationFeedback[]):number {
 return post.recommendationVisual?Math.max(0,...feedback.filter(row=>Array.isArray(row.vector)).slice(0,32).map(row=>visualSimilarity(row.vector!,post.recommendationVisual!.vector))):0;
}
function positiveImageSimilarity(post:PostWithAuthor,preferences:RecommendationPreferences):number {
 return post.recommendationVisual?Math.max(0,...(preferences.visualInterests??[]).map(vector=>visualSimilarity(vector,post.recommendationVisual!.vector)),...(preferences.likedSamples??[]).filter(row=>row.recommendationVisual).map(row=>visualSimilarity(row.recommendationVisual!.vector,post.recommendationVisual!.vector))):0;
}
type RecommendationScore = {
  interest:number;recentInterest:number;author:number;follow:number;freshness:number;quality:number;seenPenalty:number;spamPenalty:number;selfPenalty:number;total:number;
};
type ScoringContext={idf?:Record<string,number>;impressions?:Record<string,Impression>;now?:number;profiles?:{long:CosineProfile;recent:CosineProfile};feedback?:RecommendationFeedback[]};
function prepareScoringContext(preferences:RecommendationPreferences,idf:Record<string,number>,now:number,impressions?:Record<string,Impression>):ScoringContext {
 return {idf,now,impressions,profiles:{long:prepareCosine(preferences.terms,idf),recent:prepareCosine(preferences.recentTerms??preferences.terms,idf)},feedback:activeRecommendationFeedback(preferences,now)};
}
function scoreRecommendation(post:PostWithAuthor,preferences:RecommendationPreferences,viewerId:string|null,context:ScoringContext={}):RecommendationScore {
  const now=context.now ?? Date.now();
  if(preferences.visualOnly){
   const visual=post.recommendationVisual,similarity=visual?positiveImageSimilarity(post,preferences):0;
   const follow=Number(!!preferences.followedAuthors?.includes(post.userId));
   return {interest:0,recentInterest:0,author:0,follow,freshness:0,quality:0,seenPenalty:0,spamPenalty:0,selfPenalty:0,total:100*similarity+8*follow};
  }
  const relevanceText=recommendationText(post);
  const terms=recommendationTerms(relevanceText);
  const timestamp=Date.parse(post.createdAt);
  const age=Number.isFinite(timestamp)?Math.max(0,(now-timestamp)/3600000):168;
  const interest=cosine(terms,preferences.terms,context.idf ?? {},context.profiles?.long);
  const recentInterest=cosine(terms,preferences.recentTerms ?? preferences.terms,context.idf ?? {},context.profiles?.recent);
  const author=1-Math.exp(-((preferences.authors[post.userId] ?? 0)+(preferences.recentAuthors?.[post.userId] ?? 0))/8);
  const follow=preferences.followedAuthors?.includes(post.userId)?1:0;
  const freshness=Math.pow(0.5,age/48);
  // Popularity contributes modestly and decays with age. It cannot overpower
  // personal relevance, and fresh posts with few likes can still rank highly.
  const engagement=Math.max(0,Number(post.likesCount)||0)+2*Math.max(0,Number(post.commentsCount)||0)+2*Math.max(0,Number(post.repostsCount)||0);
  const quality=Math.min(1,Math.log1p(engagement/(age+6))/6);
  const impression=context.impressions?.[post.id];
  const seenPenalty=impression?(12+Math.min(12,impression.count*3))*Math.pow(0.5,Math.max(0,now-impression.at)/(3*86400000)):0;
  const hashtags=post.content.match(/#[\p{L}\p{N}_]+/gu)?.length ?? 0;
  const spamPenalty=Math.min(16,Math.max(0,hashtags-6)*2);
  const selfPenalty=post.userId===viewerId?12:0;
  const topicScore=recommendationTopicAffinity(post,{followed:preferences.followedTopics,dismissed:preferences.dismissedTopics},preferences.authorTopics?.[post.userId]);
  const unrelatedPenalty=preferences.followedTopics?.length&&topicScore===0?14:0;
  const authorWeight=preferences.followedTopics?.length&&topicScore<.2?8:36;
  const hasCreatorContext=[...(post.recommendationTopics??[]),...(post.recommendationAuthorTopics??[])].some(topic=>preferences.followedTopics?.includes(topic as TopicId)) || Object.entries(preferences.authorTopics?.[post.userId]??{}).some(([topic,weight])=>(weight??0)>0&&preferences.followedTopics?.includes(topic as TopicId));
  // Topic/source and creator evidence should beat a saturated text-only match.
  const historyWeight=preferences.followedTopics?.length?(hasCreatorContext?.15:.08):.3;
  const neighbours=post.recommendationVisual?(preferences.visualInterests??[]).map(vector=>visualSimilarity(vector,post.recommendationVisual!.vector)).sort((a,b)=>b-a).slice(0,3):[];
 const visualInterest=neighbours.length?neighbours.reduce((sum,value)=>sum+value,0)/neighbours.length:0;
  // Shared visual composition/style learned from liked works applies to every
  // media topic. A caption cannot provide this signal.
  const mediaInterest=72*Math.max(0,(visualInterest-.35)/.65);
  const negatives=context.feedback??activeRecommendationFeedback(preferences,now);
  const dislikedAuthor=negatives.filter(row=>row.userId===post.userId).length;
  const negativeSimilarity=imageFeedbackSimilarity(post,negatives);
  const positiveSimilarity=positiveImageSimilarity(post,preferences);
  const dislikedImage=Math.max(0,(negativeSimilarity-.65)/.35);
  const negativeWins=negativeSimilarity>=.72&&negativeSimilarity>positiveSimilarity+.04;
  const feedbackPenalty=Math.min(128,64*dislikedAuthor)+96*dislikedImage+(negativeWins?48:0);
  return {interest,recentInterest,author,follow,freshness,quality,seenPenalty,spamPenalty,selfPenalty,
    total:historyWeight*(30*interest+36*recentInterest)+mediaInterest+authorWeight*author+8*follow+8*freshness+4*quality-seenPenalty-spamPenalty-selfPenalty+60*topicScore-unrelatedPenalty-feedbackPenalty};
}
/** Related discovery uses creator/source context and pixels, not caption overlap. */
function relatedRecommendationScore(post:PostWithAuthor,anchors:PostWithAuthor[],preferences:RecommendationPreferences,feedback:RecommendationFeedback[]):number {
 if(post.imageUrls.length){
  // A broad art/feed label alone cannot establish personal visual taste.
  if(!post.recommendationVisual||post.recommendationVisual.kind==='unknown')return 0;
  const references=anchors.filter(anchor=>anchor.userId!==post.userId&&anchor.recommendationVisual&&anchor.recommendationVisual.kind===post.recommendationVisual!.kind);
  const similarity=Math.max(0,...references.map(anchor=>visualSimilarity(anchor.recommendationVisual!.vector,post.recommendationVisual!.vector)));
  const negative=imageFeedbackSimilarity(post,feedback);
  return similarity>=.72&&similarity>negative+.05?1+similarity:0;
 }
 // Non-image discovery needs repeated engagement with different creators in
 // the same source/topic, rather than one topic name or a caption keyword.
 const own=new Set([...(post.recommendationTopics??[]),...(post.recommendationAuthorTopics??[])]);
 const supported=new Set(anchors.filter(anchor=>anchor.userId!==post.userId&&post.recommendationSources?.some(source=>anchor.recommendationSources?.includes(source))&&[...(anchor.recommendationTopics??[]),...(anchor.recommendationAuthorTopics??[])].some(topic=>own.has(topic))).map(anchor=>anchor.userId));
 return supported.size>=2?1:0;
}
/** A whole followed topic is not a negative visual match. Require actual image evidence. */
function recommendationNeedsPersonalMediaEvidence(post:PostWithAuthor,preferences:RecommendationPreferences,feedback=activeRecommendationFeedback(preferences,Date.now())):boolean {
 if(!post.imageUrls?.length||!post.recommendationVisual||post.recommendationVisual.kind==='unknown')return false;
 const neighbors=feedback.filter(row=>row.vector&&visualSimilarity(row.vector,post.recommendationVisual!.vector)>=.70);
 return new Set(neighbors.map(row=>row.id)).size>=3;
}
function hasPersonalMediaEvidence(post:PostWithAuthor,preferences:RecommendationPreferences):boolean {
 if((preferences.authors[post.userId]??0)>0||preferences.followedAuthors?.includes(post.userId))return true;
 const positive=positiveImageSimilarity(post,preferences);
 return !!post.recommendationVisual&&post.recommendationVisual.kind!=='unknown'&&positive>=.8;
}
function rejectedRecommendationTopics(preferences:RecommendationPreferences):TopicId[]{
 // Only an explicit topic dismissal disables discovery. Work-level feedback stays work-level.
 return [...new Set(preferences.dismissedTopics??[])];
}
function isRecommendationAuthorRejected(author:string,preferences:RecommendationPreferences):boolean{
 return activeRecommendationFeedback(preferences,Date.now()).some(row=>row.userId===author);
}
function recommendationIsDismissed(post:PostWithAuthor,preferences:RecommendationPreferences,now=Date.now(),feedback=activeRecommendationFeedback(preferences,now)):boolean {
 const identity=recommendationIdentity(post),fingerprint=recommendationFingerprint(post);
 if(preferences.feedback?.some(row=>row.id===identity||!!fingerprint&&row.fingerprint===fingerprint))return true;
 if(feedback.some(row=>row.userId===post.userId))return true;
 if(recommendationNeedsPersonalMediaEvidence(post,preferences,feedback)&&!hasPersonalMediaEvidence(post,preferences))return true;
 const negative=imageFeedbackSimilarity(post,feedback);
 const positive=positiveImageSimilarity(post,preferences);
 if(negative>=.80&&negative>positive+.04)return true;
 // Repeated negative neighbors outweigh a broad topic/source hint. One disliked
 // work must not ban an entire topic; require three independently dismissed works.
 const neighbors=post.recommendationVisual?feedback.filter(row=>row.vector&&visualSimilarity(row.vector,post.recommendationVisual!.vector)>=.70).map(row=>visualSimilarity(row.vector!,post.recommendationVisual!.vector)).sort((a,b)=>b-a):[];
 return neighbors.length>=3&&neighbors.slice(0,3).reduce((sum,value)=>sum+value,0)/3>positive+.025;
}
function rankRecommendations(posts:PostWithAuthor[], preferences:RecommendationPreferences, viewerId:string|null, now=Date.now(), history:PostWithAuthor[]=[],rankLimit=Infinity,includeReserved=false):PostWithAuthor[] {
 return withScoringComparisons(()=>rankRecommendationsInternal(posts,preferences,viewerId,now,history,rankLimit,includeReserved));
}
/** Home recommendations deliberately do not inspect captions, tags, alt text or biographies. */
function rankVisualRecommendations(posts:PostWithAuthor[],preferences:RecommendationPreferences,viewer:string|null,now:number,history:PostWithAuthor[],limit:number,includeReserved:boolean):PostWithAuthor[]{
 const impressions=readRecommendationImpressions(viewer,now),deliveries=readRecommendationDeliveries(viewer,now);
 const seen=new Set(history.flatMap(post=>[recommendationIdentity(post),recommendationFingerprint(post)].filter(Boolean)));
 const liked=new Set([...(preferences.likedPostIds??[]),...readRecommendationLikes(viewer).map(post=>post.id)]);
 const feedback=activeRecommendationFeedback(preferences,now);
 const references=applyCachedRecommendationVisuals(preferences.likedSamples??[],true).filter(post=>post.recommendationVisual&&post.recommendationVisual.kind!=='unknown');
 const referencesFor=(visual:NonNullable<PostWithAuthor['recommendationVisual']>)=>{
  const topics=(preferences.followedTopics??[]).filter(topic=>visualMatchesRecommendationTopic(visual,topic));
  return topics.length?references.filter(reference=>topics.some(topic=>visualMatchesRecommendationTopic(reference.recommendationVisual!,topic))):references;
 };
 const ranked:PostWithAuthor[]=[];
 for(const post of applyCachedRecommendationVisuals(posts,true)){
  if(!isTimelinePost(post))continue;
  const id=recommendationIdentity(post),fingerprint=recommendationFingerprint(post),visual=post.recommendationVisual;
  if(seen.has(id)||fingerprint&&seen.has(fingerprint)||liked.has(post.id)||post.likedByMe||impressions[id]||fingerprint&&impressions[fingerprint])continue;
  if(!includeReserved&&(deliveries[id]||fingerprint&&Object.values(deliveries).some(row=>row.fingerprint===fingerprint)))continue;
  if(feedback.some(row=>row.id===id||row.userId===post.userId||!!fingerprint&&row.fingerprint===fingerprint))continue;
  if(visual){
   if(visual.kind==='unknown'||visual.kind==='render-3d'||visual.kind==='vehicle'||visual.confidence<.25||visual.similarity<.24)continue;
   if(preferences.dismissedTopics?.some(topic=>visualMatchesRecommendationTopic(visual,topic)))continue;
   // Explicit topics remain a requirement even when liked-image references exist.
   if(preferences.followedTopics?.length&&!preferences.followedTopics.some(topic=>visualMatchesRecommendationTopic(visual,topic)))continue;
   const relatedReferences=referencesFor(visual);
   const similar=relatedReferences.filter(reference=>reference.recommendationVisual!.kind===visual.kind);
   const positive=Math.max(0,...similar.map(reference=>visualSimilarity(reference.recommendationVisual!.vector,visual.vector)));
   if(relatedReferences.length&&(!similar.length||positive<.65))continue;

   const negative=imageFeedbackSimilarity(post,feedback);
   if(negative>=.7&&negative>positive+.04)continue;
  }else if(!preferences.allowUnverifiedMedia||!post.imageUrls.length||post.recommendationVisualStatus==='unavailable')continue;
  seen.add(id);if(fingerprint)seen.add(fingerprint);ranked.push(post);
 }
 const score=(post:PostWithAuthor)=>{
  const visual=post.recommendationVisual;
  const similarity=visual?Math.max(0,...referencesFor(visual).map(reference=>visualSimilarity(reference.recommendationVisual!.vector,visual.vector)),...(preferences.visualInterests??[]).map(vector=>visualSimilarity(vector,visual.vector))):0;
  const age=Math.floor(Math.max(0,(now-Date.parse(post.createdAt))/3600000));
  return 100*similarity+8*Number(!!preferences.followedAuthors?.includes(post.userId))+4*(1-Math.exp(-(preferences.authors[post.userId]??0)/8))+2*Math.pow(.5,(Number.isFinite(age)?age:168)/48);
 };
 return ranked.sort((a,b)=>score(b)-score(a)).slice(0,limit);
}

function rankRecommendationsInternal(posts:PostWithAuthor[], preferences:RecommendationPreferences, viewerId:string|null, now:number, history:PostWithAuthor[],rankLimit:number,includeReserved:boolean):PostWithAuthor[] {
  if(preferences.visualOnly)return rankVisualRecommendations(posts,preferences,viewerId,now,history,rankLimit,includeReserved);
  const impressions=readRecommendationImpressions(viewerId,now);
  const deliveries=readRecommendationDeliveries(viewerId,now);
  const deliveredFingerprints=new Set(Object.values(deliveries).map(row=>row.fingerprint).filter(Boolean));
  const likedIds=new Set([...(preferences.likedPostIds ?? []),...readRecommendationLikes(viewerId).map(post=>post.id),...readRecommendationLikedIds(viewerId)]);
  const ids=new Set<string>(),contents=new Set(history.map(recommendationFingerprint).filter((key):key is string=>!!key));
  const merged=new Map<string,PostWithAuthor>();
  for(const input of posts){
    const learnedTopics=Object.entries(preferences.authorTopics?.[input.userId]??{}).filter(([,weight])=>(weight??0)>=1).map(([topic])=>topic);
    const post={...input,recommendationAuthorTopics:[...new Set([...(input.recommendationAuthorTopics??[]),...learnedTopics])],recommendationLanguages:[...new Set([...(input.recommendationLanguages??[]),...(preferences.authorLanguages?.[input.userId]??[])])]};
    const identity=recommendationIdentity(post);
    const old=merged.get(identity);
    merged.set(identity,old?{...old,recommendationVisual:old.recommendationVisual??post.recommendationVisual,recommendationVisualStatus:old.recommendationVisualStatus==='checked'||post.recommendationVisualStatus==='checked'?'checked':post.recommendationVisualStatus??old.recommendationVisualStatus,recommendationSources:[...new Set([...(old.recommendationSources??[]),...(post.recommendationSources??[])])],author:{...old.author,bio:old.author.bio||post.author.bio},languages:[...new Set([...(old.languages??[]),...(post.languages??[])])],recommendationLanguages:[...new Set([...(old.recommendationLanguages??[]),...(post.recommendationLanguages??[])])],recommendationTopics:[...new Set([...(old.recommendationTopics??[]),...(post.recommendationTopics??[])])],recommendationAuthorTopics:[...new Set([...(old.recommendationAuthorTopics??[]),...(post.recommendationAuthorTopics??[])])],imageAltTexts:[...new Set([...(old.imageAltTexts??[]),...(post.imageAltTexts??[])])],contentLabels:[...new Set([...(old.contentLabels??[]),...(post.contentLabels??[])])]}:post);
  }
  const feedback=activeRecommendationFeedback(preferences,now);
  const artTopics:TopicId[]=(preferences.followedTopics??[]).filter(topic=>topic==='anime'||topic==='digital-illustration');
  const alignedAuthors=preferences.authorTopics?Object.values(preferences.authorTopics).some(topics=>artTopics.some(topic=>(topics[topic]??0)>0)):Object.values(preferences.authors).some(weight=>weight>0);
  const alignedLikes=preferences.likedSamples?.some(post=>artTopics.some(topic=>post.recommendationVisual?.topics.includes(topic)||recommendationTopicSignals(post).includes(topic)));
  const personalArt=artTopics.length>0&&(alignedAuthors||alignedLikes||!!preferences.visualInterests?.length&&!preferences.likedSamples?.length);
  const creatorWorks=new Map<string,Set<string>>();
  for(const sample of preferences.likedSamples??[]){
    const visual=sample.recommendationVisual;
    if(!sample.imageUrls.length||sample.imageUrls.every(url=>url===sample.linkPreview?.image)||isDeclaredGeneratedArt(sample))continue;
    const subjects=visual&&visual.kind!=='unknown'?visual.topics:[...recommendationTopicSignals(sample),...(sample.recommendationAuthorTopics??[])];
    if(!subjects.some(topic=>artTopics.some(active=>active===topic)))continue;
    const works=creatorWorks.get(sample.userId)??new Set<string>();
    works.add(recommendationFingerprint(sample)??recommendationIdentity(sample));creatorWorks.set(sample.userId,works);
  }
  const unique=[...merged.values()].filter(post=>{
    const identity=recommendationIdentity(post),fingerprint=recommendationFingerprint(post);
    if(recommendationIsDismissed(post,preferences,now,feedback))return false;
    if(feedback.some(row=>row.userId===post.userId)&&scoreRecommendation(post,preferences,viewerId,{now}).total<=0)return false;
    if(!recommendationIsEligible(post,preferences.followedTopics))return false;
    if(!recommendationMatchesFollowedTopics(post,preferences.followedTopics??[]))return false;
    // Personalized character-art discovery requires independent evidence.
    // Captions and biographies cannot prove an image match. Dedicated followed
    // subject feeds remain valid discovery evidence when no vision result exists;
    // explicit visual mismatches and negative feedback are checked above.
    const knownCreator=preferences.followedAuthors?.includes(post.userId);
    const curatedArtwork=hasCuratedArtworkSource(post,artTopics)||hasDeclaredArtworkContext(post,artTopics);
    if(personalArt&&!knownCreator&&!curatedArtwork){
      const related=relatedRecommendationScore(post,preferences.likedSamples??[],preferences,feedback);
      const visual=post.recommendationVisual;
      const positive=positiveImageSimilarity(post,preferences),negative=imageFeedbackSimilarity(post,feedback);
      const text=recommendationText(post);
      const establishedMediaCreator=(!visual||visual.kind==='unknown')&&
        (creatorWorks.get(post.userId)?.size??0)>=2&&post.imageUrls.length>0&&
        post.imageUrls.some(url=>url!==post.linkPreview?.image)&&text.length<=160&&
        (!text.trim()||matchingTopics(text).some(topic=>artTopics.includes(topic)));
      if(related<=0&&!establishedMediaCreator&&!(visual&&visual.kind!=='unknown'&&positive>=.72&&positive>negative+.05))return false;
    }
    if((preferences.followedTopics?.includes('art')||preferences.followedTopics?.includes('digital-illustration'))&&!preferences.followedTopics.includes('ai')&&(post.imageUrls.length>0||post.parentPost?.imageUrls.length)&& (isDeclaredGeneratedArt(post)||(post.parentPost&&isDeclaredGeneratedArt(post.parentPost))))return false;
    // A genuine view suppresses this work on later fetches, including refreshes.
    if(!includeReserved&&(deliveries[identity]||fingerprint&&deliveredFingerprints.has(fingerprint)))return false;
    if(post.likedByMe || likedIds.has(post.id) || (impressions[identity]?.count ?? 0)>=1 || (fingerprint&&(impressions[fingerprint]?.count??0)>=1))return false;
    if(ids.has(post.id)) return false;
    ids.add(post.id);
    if(fingerprint&&contents.has(fingerprint))return false;
    if(fingerprint)contents.add(fingerprint);
    return true;
  });
  const termCache=new Map([...unique,...history].map(post=>[post.id,[...recommendationTerms(recommendationText(post)),...recommendationTopicSignals(post).map(id=>`topic:${id}`)]]));
  const counts:Record<string,number>={};
  for(const post of unique) for(const term of recommendationTerms(recommendationText(post))) counts[term]=(counts[term] ?? 0)+1;
  const idf=Object.fromEntries(Object.entries(counts).map(([term,count])=>[term,1+Math.log((unique.length+1)/(count+1))]));
  const scoring=prepareScoringContext(preferences,idf,now,impressions);
  const candidates=unique.map(post=>({post,score:scoreRecommendation(post,preferences,viewerId,scoring).total,terms:termCache.get(post.id)!}));
  const seedAuthors=new Set(Object.entries(preferences.authors).filter(([,weight])=>weight>0).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([id])=>id));
  const anchors=preferences.likedSamples??[];
  const relatedScores=new Map(unique.map(post=>[post.id,relatedRecommendationScore(post,anchors,preferences,feedback)]));
  const result:PostWithAuthor[]=[];
  while(candidates.length&&result.length<rankLimit) {
    const recent=[...history.slice(-6),...result].slice(-6);
    // Three opportunities in each 20-post page retain the main preference
    // while introducing other relevant creators. Never fill them with random
    // or negatively rated work just to satisfy a quota.
    const explore=seedAuthors.size>0&&[5,11,17].includes((history.length+result.length)%20);
    const recentAuthors=new Set([...history,...result.slice(-19)].map(post=>post.userId));
    const related=candidates.filter(candidate=>!seedAuthors.has(candidate.post.userId)&&!recentAuthors.has(candidate.post.userId)&&candidate.score>0&&(relatedScores.get(candidate.post.id)??0)>0&&!feedback.some(row=>row.userId===candidate.post.userId));
    const exploring=explore&&related.length>0;
    const relatedIds=new Set(related.map(candidate=>candidate.post.id));
    let best=0,bestScore=-Infinity;
    const hasPositive=candidates.some(candidate=>candidate.score>0);
    candidates.forEach((candidate,index)=>{
      if(hasPositive&&candidate.score<=0)return;
      if(exploring&&!relatedIds.has(candidate.post.id))return;
      const sameAuthor=recent.filter(p=>p.userId===candidate.post.userId).length;
      const window=[...history,...result.slice(-19)].slice(-19);
      const sources=candidate.post.recommendationSources??[];
      const sameSource=window.filter(post=>post.recommendationSources?.some(source=>sources.includes(source))).length;
      const sameCreator=window.filter(post=>post.userId===candidate.post.userId).length;
      // Visual neighbours reveal near-identical subject/composition even when
      // captions, tags, creators and feed IDs differ.
      const similarImage=candidate.post.recommendationVisual?recent.slice(-4).reduce((count,post)=>count+(post.recommendationVisual&&visualSimilarity(post.recommendationVisual.vector,candidate.post.recommendationVisual!.vector)>.9?1:0),0):0;
      // Preserve the LimeNote / external balance when another external provider
      // is added; treating every provider as a new slot dilutes native posts.
      const external=(post:PostWithAuthor)=>post.source==='bluesky' || post.source==='misskey' || post.source==='x' || post.id.startsWith('bsky:') || post.id.startsWith('misskey:') || post.id.startsWith('x:');
      const sameService=recent.slice(-2).filter(p=>external(p)===external(candidate.post)).length;
      const overlap=recent.slice(-3).reduce((max,p)=>{
        const terms=termCache.get(p.id) ?? [];
        const common=candidate.terms.filter(term=>terms.includes(term)).length;
        return Math.max(max,common/Math.max(1,new Set([...terms,...candidate.terms]).size));
      },0);
      // Diversity must not outweigh relevance and promote a weak match over
      // a strongly preferred creator. Discovery has its own bounded slots.
      const diversityPenalty=Math.min(24,12*sameAuthor+10*sameCreator)+Math.min(32,8*sameSource)+Math.min(32,16*similarImage)+(sameService===2?16:0)+3*overlap;
      const adjusted=candidate.score+(exploring?12*(relatedScores.get(candidate.post.id)??0):0)-diversityPenalty;
      if(adjusted>bestScore) {bestScore=adjusted;best=index;}
    });
    result.push(candidates.splice(best,1)[0].post);
  }
  return [...result,...candidates.map(candidate=>candidate.post)];
}
const preferenceKey=(viewerId:string|null)=>`lime_recommendation_likes:${viewerId ?? 'guest'}`;
const restoredLikes=new Map<string,{raw:string;posts:(PostWithAuthor&{engagedAt?:string})[]}>();
function readRecommendationLikes(viewerId:string|null):(PostWithAuthor & {engagedAt?:string})[] {
  try {
   const key=preferenceKey(viewerId),raw=localStorage.getItem(key)??'[]',previous=restoredLikes.get(key);
   if(previous?.raw===raw)return applyCachedRecommendationVisuals(previous.posts);
   const data=JSON.parse(raw),posts=Array.isArray(data)?restoreRecommendationVisuals(data.filter(p=>p&&typeof p.id==='string'&&typeof p.content==='string').slice(0,100)):[];
   restoredLikes.set(key,{raw,posts});if(restoredLikes.size>3)restoredLikes.delete(restoredLikes.keys().next().value!);
   return applyCachedRecommendationVisuals(posts);
  } catch {return [];}
}
const likedIdsKey=(viewerId:string|null)=>`lime_recommendation_liked_ids:${viewerId ?? 'guest'}`;
function readRecommendationLikedIds(viewerId:string|null):string[] {
  try {
    const data=JSON.parse(localStorage.getItem(likedIdsKey(viewerId)) ?? '[]');
    return Array.isArray(data)?data.filter((id):id is string=>typeof id==='string').slice(0,3000):[];
  } catch {return [];}
}
function recordRecommendationLike(post:PostWithAuthor,liked:boolean,viewerId:string|null,eventAt?:string) {
 recordRecommendationEngagement(post,viewerId,'like',liked);
  // Consumed IDs outlive the small content sample used to learn current interests.
  try {
    const ids=readRecommendationLikedIds(viewerId).filter(id=>id!==post.id);
    if(liked) ids.unshift(post.id);
    localStorage.setItem(likedIdsKey(viewerId),JSON.stringify(ids.slice(0,3000)));
  } catch { /* A like must succeed even when local storage is unavailable. */ }
  try {
    const current=readRecommendationLikes(viewerId).filter(p=>p.id!==post.id);
    const old=readRecommendationLikes(viewerId).find(row=>row.id===post.id);
    const sample={...old,...post,author:post.author??old?.author,imageUrls:post.imageUrls??old?.imageUrls};
    if(liked) current.unshift({id:post.id,userId:sample.userId,content:sample.content||old?.content||'',source:sample.source,imageUrls:sample.imageUrls,languages:sample.languages,recommendationLanguages:recommendationOriginLanguages(sample),imageAltTexts:sample.imageAltTexts,recommendationVisual:sample.recommendationVisual??(sample.imageUrls?.[0]?readVisualCache(sample.imageUrls[0]):undefined),author:{id:sample.userId,bio:sample.author?.bio,displayName:sample.author?.displayName},recommendationTopics:sample.recommendationVisual?.topics??recommendationTopicSignals(sample),engagedAt:eventAt??new Date().toISOString()} as PostWithAuthor & {engagedAt:string});
    localStorage.setItem(preferenceKey(viewerId),JSON.stringify(current.slice(0,100)));
  } catch { /* A disabled/full local store must not fail a successful like. */ }
}

export { selectRecommendationLikeSamples };
export { recommendationTerms };
export { addRecommendationInterest };
export { recommendationQueries };
export { readRecommendationImpressions };
export { recordRecommendationImpression };
export { readRecommendationDeliveries };
export { recordRecommendationDelivery };
export { selectRecommendationPage };
export { scoreRecommendation };
export { recommendationNeedsPersonalMediaEvidence };
export { rejectedRecommendationTopics };
export { isRecommendationAuthorRejected };
export { recommendationIsDismissed };
export { rankRecommendations };
export { readRecommendationLikes };
export { readRecommendationLikedIds };
export { recordRecommendationLike };
export type { RecommendationFeedback };
export type { RecommendationPreferences };
export type { RecommendationScore };
export { recommendationText };
export { recommendationTopicSignals };
export { hasCuratedArtworkSource };
export { hasDeclaredArtworkContext };
export { recommendationMatchesFollowedTopics };
export { recommendationTopicAffinity };
export { topicAuthorCandidates };
export { recommendationOriginLanguages };
export { recommendationIdentity };
export { recommendationFingerprint };
export { isDeclaredGeneratedArt };
export { isUnrelatedCryptoRecommendation };
export { recommendationIsEligible };
export { recordRecommendationEngagement };
export type { RecommendationAction };
export { topicPostRelevance };
export { rankTopicPosts };
export { preserveRecommendationHistory };
export { uniqueRecommendationPosts };
export { readRecommendationReserve };
export { saveRecommendationReserve };
export { clearRecommendationReserve };
export { applyCatalogRecommendationVisuals };
export { parseRecommendationCatalog };
export { readRecommendationCatalog };
export { RECOMMENDATION_CATALOG_VERSION };
export { RECOMMENDATION_CATALOG_MAX_AGE };
