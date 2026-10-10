/** Resolve only links to this app; arbitrary sites with /post paths stay links. */
export function findChatPostLink(content:string):{id:string;url:string}|null{
 for(const raw of content.match(/https?:\/\/[^\s]+/gi)??[]){
  try{
   const url=new URL(raw.replace(/[)\]}>。、，．！？!?]+$/g,''));
   if(!['localhost','127.0.0.1','toumeron.github.io'].includes(url.hostname))continue;
   const match=url.pathname.replace(/\/+$/,'').match(/^(?:\/RaimuNoteSNS\.github\.io)?\/post\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
   if(match)return {id:match[1],url:url.href};
  }catch{/* Incomplete links remain ordinary message text. */}
 }
 return null;
}
