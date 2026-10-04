import {Fragment,type ReactNode} from 'react';
import {splitStickers,stickersAreInline} from '@/lib/stickers';
import {StickerImage} from './Stickers';
export function renderStickerText(text:string,renderText:(text:string)=>ReactNode):ReactNode {
  const inline=stickersAreInline(text);
  return splitStickers(text).map((part,i)=><Fragment key={i}>{part.name?<StickerImage name={part.name} inline={inline || part.inline}/>:renderText(part.text)}</Fragment>);
}
