import type {PostWithAuthor} from '@/types';
import {isTopicId,matchingTopics,type TopicId,type TopicPreferences} from './topics';
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
