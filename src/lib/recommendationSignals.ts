import type { PostWithAuthor } from "@/types";
import { isTopicId, matchingTopics, type TopicId, type TopicPreferences, GLOBAL_TOPICS } from "@/lib/topics";
import { isTimelinePost } from "@/lib/timelinePaging";

type Signals={content?:string;imageAltTexts?:string[];recommendationTopics?:string[];recommendationVisual?:PostWithAuthor['recommendationVisual'];author?:{id?:string;bio?:string};linkPreview?:{title?:string;description?:string};parentPost?:Signals|null};
export function recommendationText(post:Signals):string {
 return [post.content,...(post.imageAltTexts??[]),post.linkPreview?.title,post.linkPreview?.description,post.parentPost?.content,...(post.parentPost?.imageAltTexts??[]),post.parentPost?.linkPreview?.title,post.parentPost?.linkPreview?.description].filter(Boolean).join(' ');
}
/** Source context and media/link metadata remain usable when body text is empty. */
export function recommendationTopicSignals(post:Signals):TopicId[] {
 const own=[...(post.recommendationVisual?.topics??[]),...(post.recommendationTopics??[]).filter(isTopicId),...matchingTopics([post.content,...(post.imageAltTexts??[]),post.linkPreview?.title,post.linkPreview?.description].filter(Boolean).join(' '))];
 const parent=post.parentPost?[...(post.parentPost.recommendationTopics??[]).filter(isTopicId),...matchingTopics([post.parentPost.content,...(post.parentPost.imageAltTexts??[]),post.parentPost.linkPreview?.title,post.parentPost.linkPreview?.description].filter(Boolean).join(' '))]:[];
 return [...new Set([...own,...parent])];
}
export function recommendationTopicAffinity(post:PostWithAuthor,preferences:Partial<TopicPreferences>,learned:Partial<Record<TopicId,number>>={}):number {
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
export function topicAuthorCandidates(posts:PostWithAuthor[],followed:TopicId[]):{actor:string;topics:TopicId[]}[] {
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
 for(const topic of followed)for(const prefix of ['did:','misskey-user:']){
  const candidate=ranked.find(row=>row.actor.startsWith(prefix)&&row.topics.includes(topic)&&!selected.some(old=>old.actor===row.actor));
  if(candidate&&selected.filter(row=>row.actor.startsWith(prefix)).length<2)selected.push({actor:candidate.actor,topics:candidate.topics});
 }
 return selected;
}
/** Language context can follow a creator's works without requiring text on each work. */
export function recommendationOriginLanguages(post:{languages?:string[];recommendationLanguages?:string[];content?:string;author?:{bio?:string;displayName?:string}}):string[] {
 if(post.languages?.length)return post.languages.filter(lang=>/^ja(?:-|$)/i.test(lang)).length?['ja']:[];
 if(post.recommendationLanguages?.includes('ja'))return ['ja'];
 return /[\u3040-\u30ff]/.test([post.content,post.author?.bio,post.author?.displayName].filter(Boolean).join(' '))?['ja']:[];
}

export function recommendationIdentity(post:Pick<PostWithAuthor,'id'|'blueskyUri'>):string {
 const uri=post.blueskyUri??post.id.replace(/^bsky:/,'');
 return uri.startsWith('at://')?`bsky:${uri}`:post.id;
}
/** Identify the same work across resized CDN URLs, copied posts and page boundaries. */
export function recommendationFingerprint(post:Pick<PostWithAuthor,'content'|'imageUrls'>):string|undefined {
 const media=post.imageUrls.map(raw=>{
  try{const url=new URL(raw);for(const key of ['w','h','width','height','format','q','quality','fit','auto','resize'])url.searchParams.delete(key);url.hash='';const blob=url.hostname==='cdn.bsky.app'?url.pathname.match(/\/(baf[a-z0-9]+)(?:@[a-z]+)?$/i)?.[1]:undefined;if(blob)return `bsky-media:${blob}`;url.pathname=url.pathname.replace(/\/img\/feed_(?:thumbnail|fullsize)\//,'/img/feed/');return url.toString();}catch{return raw;}
 }).sort();
 const text=post.content.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
 if(!media.length&&text.length<32)return undefined;
 const value=media.length?JSON.stringify(media):text;
 let a=2166136261,b=5381;for(let i=0;i<value.length;i++){a=Math.imul(a^value.charCodeAt(i),16777619);b=Math.imul(b,33)^value.charCodeAt(i);}
 return `fp:${(a>>>0).toString(36)}:${(b>>>0).toString(36)}`;
}

export function isDeclaredGeneratedArt(post:PostWithAuthor):boolean {
 const text=[post.content,...(post.imageAltTexts??[]),post.author?.bio??''].join('\n').normalize('NFKC')
  .replace(/(?:no|non|not|anti)[ -]?ai(?:[ -]?(?:art|generated))?|AI(?:学習|生成)?(?:に)?(?:禁止|反対|不使用)|AI(?:生成|イラスト|画像|絵)(?:ではない|ではありません|じゃない)|生成AI(?:不使用|反対)|AIを(?:使わない|使用しない)/gi,'');
 return (post.contentLabels??[]).some(label=>/^(?:ai-generated|generative-ai|synthetic-media)$/i.test(label)) || /AI[ _-]?(?:イラスト|画像|生成|絵|art|generated)|生成AI|人工知能で(?:描|生成)|midjourney|stable[ _-]?diffusion|novelai|dall[ -]?e|#AIart/i.test(text);
}

const japanese=(text:string)=>/[\u3040-\u30ff]/.test(text);
/** Language records take precedence over inferred origin. Country is never inferred from a name. */
export function recommendationIsEligible(post:PostWithAuthor,followed:TopicId[]=[]):boolean {
 if(!isTimelinePost(post))return false;
 const external=post.source==='bluesky'||post.source==='misskey'||post.id.startsWith('bsky:')||post.id.startsWith('misskey:');
 const signals=recommendationTopicSignals(post);
 const digital=followed.includes('digital-illustration');
 const visual=post.recommendationVisual;
 if(followed.length&&visual&&visual.kind!=='unknown'&&visual.topics.length&&!visual.topics.some(topic=>followed.includes(topic)))return false;
 const digitalContext=post.recommendationTopics?.includes('digital-illustration')||post.recommendationAuthorTopics?.includes('digital-illustration');
 const digitalMatch=digital&&post.imageUrls.length>0&&!isDeclaredGeneratedArt(post)&&(visual?.kind==='moe'||(!visual&&!post.recommendationVisualStatus&&digitalContext));
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

export type RecommendationAction = 'impression' | 'like' | 'repost' | 'bookmark' | 'not_interested';
export function recordRecommendationEngagement(post: Pick<PostWithAuthor, 'id' | 'blueskyUri'>, viewer: string | null, action: RecommendationAction, active = true) {
 if (viewer) window.dispatchEvent(new CustomEvent('lime:recommendation-engagement', {detail: {id: recommendationIdentity(post), viewer, action, active}}));
}
