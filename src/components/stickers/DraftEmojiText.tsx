import {Fragment, type ReactNode} from 'react';
import {draftEmojiName} from '@/lib/stickers';
import {StickerImage} from './Stickers';

// Each draft emoji occupies one native text character, so cursor movement,
// selection, deletion and IME composition remain native textarea operations.
export function DraftEmojiText({text,renderText=(value)=>value}:{text:string;renderText?:(value:string)=>ReactNode}) {
  return text.split(/([\uE000-\uF8FF])/).map((part,index)=>{
    const name=draftEmojiName(part);
    return <Fragment key={index}>{name?<span data-lime-draft-emoji className="relative inline-block align-baseline"><span className="invisible">{part}</span><span className="pointer-events-none absolute inset-0 flex items-center justify-center [&_img]:!m-0 [&_img]:!h-[1em] [&_img]:!w-full"><StickerImage name={name} inline/></span></span>:renderText(part)}</Fragment>;
  });
}
