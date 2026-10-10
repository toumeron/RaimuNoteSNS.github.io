export type FriendPhoto={url:string;sourceUrl:string;title:string;artist:string;license:string};
export const FRIEND_IMAGE_INSTRUCTION='具体的な食べ物・動植物・建物・観光スポット・物の説明、紹介、おすすめ、旅行や料理の話では写真を積極的に添えてください。具体物の説明・紹介に対しては、文章だけで返答せず画像検索タグを付けてください。見た目が分かると役立つ具体的な対象がある場合は毎回画像を選び、ユーザーが画像や写真を求めた場合は必ず画像検索語を出してください。リアクションタグの後・本文の前に <image-query>具体的な英語の画像検索語</image-query> を1つ出力してください（例: 担々麺の説明なら dandan noodles）。雑談・感情・抽象的な相談には画像は不要です。URLや画像Markdownは絶対に生成せず、画像が見つかったと断言しないでください。画像検索語は80文字以下にしてください。';
export function stripImageQuery(text:string):{reply:string;imageQuery?:string}{
 const match=text.match(/<image-query>([^<\n]{1,80})<\/image-query>/);
 const start=text.lastIndexOf('<');
 const complete=text.replace(/<image-query>[\s\S]*?(?:<\/image-query>|$)/g,'').replace(/!\[[^\]]*\]\([^)]+\)/g,'').replace(/<friend-photo>[\s\S]*?(?:<\/friend-photo>|$)/g,'');
 const reply=(start>=0&&'<image-query>'.startsWith(text.slice(start))?complete.slice(0,start):complete).trimStart();
 return {reply,...(match?.[1].trim()?{imageQuery:match[1].trim()}: {})};
}
const plain=(value:unknown)=>typeof value==='string'?value.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').slice(0,300):'';
const validImage=(url:string)=>{try{const u=new URL(url);return u.protocol==='https:'&&['upload.wikimedia.org','thumb.wikimedia.org'].includes(u.hostname)&&!u.username&&!u.password;}catch{return false}};
export function validFriendPhoto(value:unknown):value is FriendPhoto{
 if(!value||typeof value!=='object')return false;const p=value as FriendPhoto;
 return typeof p.url==='string'&&validImage(p.url)&&typeof p.sourceUrl==='string'&&p.sourceUrl.startsWith('https://commons.wikimedia.org/wiki/File:')&&['title','artist','license'].every(key=>typeof (p as unknown as Record<string,unknown>)[key]==='string');
}
/** Only the provider chooses URLs; model output can supply a bounded search term. */
export async function findFriendPhoto(query:string,transport:typeof fetch=fetch):Promise<FriendPhoto|null>{
 if(!query.trim()||query.length>80)return null;
 const signal=AbortSignal.timeout(12000);
 try{
  const search=async(term:string)=>{
   const url=new URL('https://commons.wikimedia.org/w/api.php');url.search=new URLSearchParams({action:'query',format:'json',generator:'search',gsrsearch:term,gsrnamespace:'6',gsrlimit:'8',prop:'imageinfo',iiprop:'url|mime|extmetadata',iiurlwidth:'960',iiextmetadatafilter:'Artist|LicenseShortName',origin:'*'}).toString();
   const response=await transport(url,{signal});if(!response.ok)return null;const data=await response.json();
   const pages=Object.values(data.query?.pages??{}) as {index?:number;title:string;imageinfo?:{url:string;thumburl?:string;descriptionurl:string;mime:string;extmetadata?:Record<string,{value:string}>}[]}[];
   for(const page of pages.sort((a,b)=>(a.index??0)-(b.index??0))){
    const info=page.imageinfo?.[0];if(!info||!['image/jpeg','image/png','image/webp'].includes(info.mime))continue;
    for(const imageUrl of [...new Set([info.thumburl,info.url].filter(Boolean))]){
     const photo={url:imageUrl!,sourceUrl:info.descriptionurl,title:plain(page.title.replace(/^File:/,'')),artist:plain(info.extmetadata?.Artist?.value),license:plain(info.extmetadata?.LicenseShortName?.value)};
     if(!validFriendPhoto(photo)||!photo.license)continue;
     try{const check=await transport(photo.url,{method:'HEAD',signal,redirect:'error'});if(check.ok&&/^image\/(jpeg|png|webp)(?:;|$)/i.test(check.headers.get('content-type')??''))return photo;}catch{if(signal.aborted)return null;}
    }
   }
   return null;
  };
  const found=await search(query);if(found)return found;
  // Commons file names often use English. Resolve the actual topic through Wikipedia
  // rather than relying on the model to translate or invent an image URL.
  if(/[ぁ-んァ-ヶ一-龯]/.test(query)&&!signal.aborted){
   const wiki=new URL('https://ja.wikipedia.org/w/api.php');wiki.search=new URLSearchParams({action:'query',format:'json',generator:'search',gsrsearch:query,gsrlimit:'1',prop:'langlinks',lllang:'en',origin:'*'}).toString();
   const response=await transport(wiki,{signal});if(response.ok){const data=await response.json();const pages=Object.values(data.query?.pages??{}) as {langlinks?:{'*':string}[]}[];const english=pages[0]?.langlinks?.[0]?.['*'];if(english&&english.length<=80)return await search(english);}
  }
 }catch{/* A missing photo must never suppress the text reply. */}
 return null;
}
export function appendFriendPhoto(reply:string,photo:FriendPhoto|null,maxLength=Infinity):string{
 if(!photo||!validFriendPhoto(photo))return reply.slice(0,maxLength);
 const metadata=`\n<friend-photo>${JSON.stringify(photo)}</friend-photo>`;
 return metadata.length>=maxLength?reply.slice(0,maxLength):reply.slice(0,maxLength-metadata.length)+metadata;
}
export function readFriendPhoto(content:string):{text:string;photo:FriendPhoto|null}{
 const match=content.match(/\n<friend-photo>([^\n]+)<\/friend-photo>$/);if(!match)return {text:content,photo:null};
 let photo:FriendPhoto|null=null;try{const value=JSON.parse(match[1]);if(validFriendPhoto(value))photo=value;}catch{}return {text:content.slice(0,match.index),photo};
}
/** Recover visual explanation requests even when the model omits its metadata tag. */
export function chooseFriendImageQuery(query:string|undefined,question:string,reply:string):string|undefined{
 if(query?.trim()&&query.length<=80)return query.trim();
 const text=question.trim().slice(0,1000);
 const match=text.match(/^(.{1,60}?)(?:って|とは|は)(?:どんな(?:食べ物|料理|動物|植物|建物|物|もの|見た目)|何ですか|なんですか|なに|何|どんなもの)/)||text.match(/^(.{1,60}?)(?:の)?(?:写真|画像|見た目)(?:を|が|は)?(?:見せ|教え|知り|どんな|見たい|ください|お願い)/)||text.match(/^(.{1,60}?)(?:について|を)(?:教えて|知りたい|紹介して|説明して|見せて)/);
 if(!match)return undefined;

 const topic=match[1].replace(/^[「『\s]+|[」』\s?？。！!]+$/g,'').trim();
 if(!topic||/(気持ち|人生|愛|友情|幸せ|意味|エラー|プログラム|コード|設定|機能|方法|使い方)/.test(topic))return undefined;
 return topic;
}
