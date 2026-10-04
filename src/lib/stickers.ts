export type CustomSticker = {id: string; name: string; public_id: string; format: string};
export const stickerToken = (name: string) => `[[stamp:${encodeURIComponent(name)}]]`;
export const appendSticker = (text: string, name: string | null) => [serializeDraftEmojis(text).trim(), name ? stickerToken(name) : ''].filter(Boolean).join(' ');
export function splitStickers(text: string): {text: string; name?: string; inline?: boolean}[] {
  const result: {text: string; name?: string; inline?: boolean}[] = []; let end = 0;
  for (const match of text.matchAll(/\[\[(stamp|emoji):([^\]\s]+)\]\]/g)) {
    let name: string; try {name=decodeURIComponent(match[2]);} catch {continue;}
    if (!name || name.length > 100) continue;
    if (match.index! > end) result.push({text:text.slice(end,match.index)});
    result.push({text:match[0],name,...(match[1]==="emoji"?{inline:true}:{})}); end=match.index!+match[0].length;
  }
  if (end < text.length) result.push({text:text.slice(end)});
  return result;
}
export const hasStickers = (text: string) => splitStickers(text).some(p=>p.name);
export function stickerUrl(sticker: CustomSticker): string | null {
  if (!/^[\w/-]+$/.test(sticker.public_id) || !/^(png|jpg|jpeg|gif|webp|avif)$/i.test(sticker.format)) return null;
  const id=sticker.public_id.startsWith('custom_emojis/')?sticker.public_id:`custom_emojis/${sticker.public_id}`;
  return `https://res.cloudinary.com/dveiikhhw/image/upload/${id}.${sticker.format}`;
}

export const stickersAreInline = (text: string) => splitStickers(text).some(part => !part.name && !!part.text.trim());

const draftEmojis = new Map<string,string>();
export function draftEmojiCharacter(name:string):string {
  for(const [character,existing] of draftEmojis) if(existing===name)return character;
  const character=String.fromCharCode(0xE000+draftEmojis.size);
  draftEmojis.set(character,name);
  return character;
}
export const draftEmojiName = (character:string) => draftEmojis.get(character);
export const hasDraftEmojis = (text:string) => [...text].some(character=>draftEmojis.has(character));
export const serializeDraftEmojis = (text:string) => [...text].map(character=>draftEmojiName(character)?`[[emoji:${encodeURIComponent(draftEmojiName(character)!)}]]`:character).join('');
export function insertDraftEmoji(input:HTMLTextAreaElement|HTMLInputElement|null,text:string,name:string,onChange:(text:string)=>void) {
  const start=input?.selectionStart??text.length,end=input?.selectionEnd??start;
  const next=text.slice(0,start)+draftEmojiCharacter(name)+text.slice(end);
  onChange(next);
  requestAnimationFrame(()=>{if(input?.value!==next)return;input.focus();input.setSelectionRange(start+1,start+1);});
}
