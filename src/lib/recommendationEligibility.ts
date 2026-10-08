import type {PostWithAuthor} from '@/types';
import {GLOBAL_TOPICS,type TopicId} from './topics';
import {recommendationTopicSignals,recommendationText} from './recommendationSignals';
import {isDeclaredGeneratedArt} from './artRecommendations';
const japanese=(text:string)=>/[\u3040-\u30ff]/.test(text);
/** Language records take precedence over inferred origin. Country is never inferred from a name. */
export function recommendationIsEligible(post:PostWithAuthor,followed:TopicId[]=[]):boolean {
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
