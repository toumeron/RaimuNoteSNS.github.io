

// postPresentation
type PreviewPost={content?:string;imageUrls?:readonly string[];video?:unknown;externalVideo?:unknown;linkPreview?:{image?:string}};
function hasAttachedPostVideo(post:unknown):boolean{
 const media=post as {video?:unknown;externalVideo?:unknown}|null|undefined;return !!(media?.video||media?.externalVideo);
}
/** A link-card thumbnail is not an attached photo. */
function canShowPostLinkPreview(post:PreviewPost,embedded=false):boolean{
 return !embedded&&!post.video&&!post.externalVideo&&!(post.imageUrls??[]).some(url=>url!==post.linkPreview?.image)&&!/(https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp|svg)(?:[?#][^\s]*)?|https?:\/\/pbs\.twimg\.com\/media\/[^\s]+)/i.test(post.content??'');
}
const QUOTE_TEXT_LIMIT=140;
function quotePreviewText(content:string):string{
 const characters=Array.from(content);return characters.length>QUOTE_TEXT_LIMIT?characters.slice(0,QUOTE_TEXT_LIMIT).join('').trimEnd()+'…':content;
}

// spaceLinks
const SPACE_LINK = /https?:\/\/[^\s<>]+\/spaces\/([\w-]+)(?:\?[^\s<>]*)?/g;
function spaceLinkIn(content: string): { id: string; text: string } | null {
  for (const match of content.matchAll(SPACE_LINK)) {
    try {
      const url = new URL(match[0]);
      if ((url.hostname === 'toumeron.github.io' && url.pathname.startsWith('/RaimuNoteSNS.github.io/spaces/')) || (url.origin === window.location.origin && url.pathname.startsWith(`${import.meta.env.BASE_URL}spaces/`))) return { id: match[1], text: content.replace(match[0], '').trim() };
    } catch { /* Ignore malformed links. */ }
  }
  return null;
}
const spacePublicLink = (id: string) => `https://toumeron.github.io/RaimuNoteSNS.github.io/spaces/${encodeURIComponent(id)}`;

export { hasAttachedPostVideo };
export { canShowPostLinkPreview };
export { quotePreviewText };
export { QUOTE_TEXT_LIMIT };
export { spaceLinkIn };
export { spacePublicLink };
