/** Translate LimeNote search conditions to the provider's search syntax. */
export function twitterSearchQuery(p:{terms:string[];phrases:string[];orGroups:string[][];excludes:string[];from:string[];notFrom:string[];to?:string[];bareHandle:string|null;since:Date|null;until:Date|null;minLikes:number|null;maxLikes:number|null;minReposts:number|null;media:'any'|'image'|'video'|null;excludeImage:boolean;excludeVideo:boolean;hasLink:boolean;excludeLink:boolean}){
 const day=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
 const handle=(value:string)=>value.replace(/@(?:x|twitter)\.com$/i,'').replace(/^@/,'');
 const parts=[...p.terms.filter(term=>!(p.to??[]).some(name=>term.toLowerCase()===`@${name.toLowerCase()}`)),...p.phrases.map(value=>JSON.stringify(value)),...p.orGroups.map(group=>`(${group.join(' OR ')})`),...p.excludes.map(value=>`-${JSON.stringify(value)}`)];
 if(p.bareHandle)parts.push(`from:${handle(p.bareHandle)}`);
 if(p.from.length)parts.push(`(${p.from.map(value=>`from:${handle(value)}`).join(' OR ')})`);
 parts.push(...p.notFrom.map(value=>`-from:${handle(value)}`),...(p.to??[]).map(value=>`to:${handle(value)}`));
 if(p.since)parts.push(`since:${day(p.since)}`);
 if(p.until){const exclusive=new Date(p.until);exclusive.setDate(exclusive.getDate()+1);parts.push(`until:${day(exclusive)}`);}
 if(p.minLikes!==null)parts.push(`min_faves:${p.minLikes}`);
 if(p.maxLikes!==null)parts.push(`-min_faves:${p.maxLikes+1}`);
 if(p.minReposts!==null)parts.push(`min_retweets:${p.minReposts}`);
 if(p.media)parts.push(`filter:${p.media==='any'?'media':p.media==='image'?'images':'videos'}`);
 if(p.excludeImage)parts.push('-filter:images');if(p.excludeVideo)parts.push('-filter:videos');
 if(p.hasLink)parts.push('filter:links');if(p.excludeLink)parts.push('-filter:links');
 return parts.join(' ').trim();
}
