type PreviewPost={content?:string;imageUrls?:readonly string[];video?:unknown;externalVideo?:unknown;linkPreview?:{image?:string}};
export function hasAttachedPostVideo(post:unknown):boolean{
 const media=post as {video?:unknown;externalVideo?:unknown}|null|undefined;return !!(media?.video||media?.externalVideo);
}
/** A link-card thumbnail is not an attached photo. */
export function canShowPostLinkPreview(post:PreviewPost,embedded=false):boolean{
 return !embedded&&!post.video&&!post.externalVideo&&!(post.imageUrls??[]).some(url=>url!==post.linkPreview?.image)&&!/(https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp|svg)(?:[?#][^\s]*)?|https?:\/\/pbs\.twimg\.com\/media\/[^\s]+)/i.test(post.content??'');
}
export const QUOTE_TEXT_LIMIT=140;
export function quotePreviewText(content:string):string{
 const characters=Array.from(content);return characters.length>QUOTE_TEXT_LIMIT?characters.slice(0,QUOTE_TEXT_LIMIT).join('').trimEnd()+'…':content;
}
