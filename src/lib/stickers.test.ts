import {it,expect} from 'vitest';
import {appendSticker,splitStickers,hasStickers,stickerUrl,stickersAreInline,draftEmojiCharacter,serializeDraftEmojis,insertDraftEmoji} from './stickers';
it('persists a sticker-only post and a mixed text reply without changing normal emoji syntax',()=>{
 const body=appendSticker('ありがとう','ねこ');
 expect(splitStickers(body)).toEqual([{text:'ありがとう '},{text:'[[stamp:%E3%81%AD%E3%81%93]]',name:'ねこ'}]);
 expect(hasStickers(':cat:')).toBe(false);
 expect(hasStickers(appendSticker('','cat'))).toBe(true);
});
it('keeps invalid tokens as text and supports multiple stamps in stored bodies',()=>{
 expect(splitStickers('[[stamp:%ZZ]]')).toEqual([{text:'[[stamp:%ZZ]]'}]);
 expect(splitStickers('[[stamp:a]] [[stamp:b]]').filter(p=>p.name)).toHaveLength(2);
});
it('allows only existing Cloudinary image asset formats and safe paths',()=>{
 const base={id:'1',name:'cat',public_id:'cat',format:'gif'};
 expect(stickerUrl(base)).toBe('https://res.cloudinary.com/dveiikhhw/image/upload/custom_emojis/cat.gif');
 expect(stickerUrl({...base,public_id:'https://evil.test/a'})).toBeNull();
 expect(stickerUrl({...base,format:'svg'})).toBeNull();
});

it('uses normal emoji size only when the body also contains text',()=>{
 expect(stickersAreInline('[[stamp:cat]]')).toBe(false);
 expect(stickersAreInline('  [[stamp:cat]]\n')).toBe(false);
 expect(stickersAreInline(appendSticker('こんにちは','cat'))).toBe(true);
});

it('stores multiple inline emoji separately from a standalone stamp',()=>{
 const character=draftEmojiCharacter('cat');
 expect(character).toHaveLength(1);
 expect(serializeDraftEmojis(`a${character}b${character}`)).toBe('a[[emoji:cat]]b[[emoji:cat]]');
 expect(splitStickers(serializeDraftEmojis(character))[0]).toMatchObject({name:'cat',inline:true});
 expect(appendSticker(character,null)).toBe('[[emoji:cat]]');
});
it('replaces the selected text with one inline emoji at the cursor',()=>{
 const input=document.createElement('textarea');input.value='abcd';input.setSelectionRange(1,3);
 let changed='';insertDraftEmoji(input,input.value,'cat',value=>changed=value);
 expect(serializeDraftEmojis(changed)).toBe('a[[emoji:cat]]d');
});
