import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {makeDraftStore} from '@/test/draftStore';
import {createDraftMediaUrl,flushPostDrafts,loadPostDraft,postDraftKey,removePostDraft,revokeDraftMediaUrl,savePostDraft,savePostDraftText,type PostDraft} from './postDrafts';
const store=makeDraftStore();
let counter=0;
const empty:PostDraft={content:'',previews:[],originals:[],poll:null,sticker:null,scheduledAt:null,visibility:'public',quotedPost:null,video:null};
beforeEach(()=>{store.data.clear();store.control.failWrites=false;localStorage.clear();vi.stubGlobal('indexedDB',store.factory);URL.createObjectURL=vi.fn(()=>`blob:runtime-${++counter}`);URL.revokeObjectURL=vi.fn();});
afterEach(async()=>{store.control.failWrites=false;await flushPostDrafts();vi.unstubAllGlobals();});
it('restores image data and its original after runtime URLs have been revoked',async()=>{
 const key=postDraftKey('owner','inline'),original=new File(['original'],'photo.png',{type:'image/png'}),crop=new Blob(['cropped'],{type:'image/jpeg'});
 const preview=createDraftMediaUrl(crop),source=createDraftMediaUrl(original);
 await savePostDraft(key,{...empty,content:'入力した本文',previews:[preview],originals:[source],visibility:'following',communityId:'community'});
 revokeDraftMediaUrl(preview);revokeDraftMediaUrl(source);
 const before=store.control.reads,restored=await loadPostDraft(key);
 expect(store.control.reads).toBeGreaterThan(before);expect(restored).toMatchObject({content:'入力した本文',visibility:'following',communityId:'community'});
 expect(restored!.previews[0]).not.toBe(preview);expect(restored!.originals[0]).not.toBe(source);
 expect(URL.createObjectURL).toHaveBeenCalledWith(crop);expect(URL.createObjectURL).toHaveBeenCalledWith(original);
});
it('keeps the latest text without dropping committed images when hydration is interrupted',async()=>{
 const key=postDraftKey('owner','interrupted'),image=createDraftMediaUrl(new Blob(['image'],{type:'image/png'}));
 await savePostDraft(key,{...empty,content:'old',previews:[image],originals:[image]});
 savePostDraftText(key,{...empty,content:'new typing before close'});
 const restored=await loadPostDraft(key);expect(restored!.content).toBe('new typing before close');expect(restored!.previews).toHaveLength(1);
});
it('isolates accounts, community contexts, quote surfaces and map composers',async()=>{
 const key=postDraftKey('owner','overlay','community',{latitude:35,longitude:139});await savePostDraft(key,{...empty,content:'private draft'});
 expect(await loadPostDraft(postDraftKey('other','overlay','community',{latitude:35,longitude:139}))).toBeNull();
 expect(await loadPostDraft(postDraftKey('owner','inline','community',{latitude:35,longitude:139}))).toBeNull();
 expect(await loadPostDraft(postDraftKey('owner','overlay','other',{latitude:35,longitude:139}))).toBeNull();
});
it('restores polls and prepared video bytes as well as ordinary images',async()=>{
 const key=postDraftKey('owner','media'),image=createDraftMediaUrl(new Blob(['poll'],{type:'image/png'})),file=new File(['video'],'movie.webm',{type:'video/webm'});
 await savePostDraft(key,{...empty,content:'question',poll:{durationMinutes:60,options:[{label:'A',image},{label:'B'}]},scheduledAt:'2026-10-24T00:00:00Z',video:{file,url:'blob:video',duration:8,width:1280,height:720}});
 revokeDraftMediaUrl(image);const restored=await loadPostDraft(key);expect(restored!.poll!.options[0].image).not.toBe(image);expect(restored!.video!.file).toBe(file);expect(restored!.scheduledAt).toBe('2026-10-24T00:00:00Z');
});
it('orders edits, success deletion and a newer draft without resurrecting the sent draft',async()=>{
 const key=postDraftKey('owner','race');const first=savePostDraft(key,{...empty,content:'sent'});const clear=removePostDraft(key);const next=savePostDraft(key,{...empty,content:'new draft'});
 await Promise.all([first,clear,next]);expect((await loadPostDraft(key))!.content).toBe('new draft');
 await removePostDraft(key);expect(await loadPostDraft(key)).toBeNull();
});
it('keeps attachments in memory on storage failure and tombstones a sent draft',async()=>{
 const key=postDraftKey('owner','quota'),image=createDraftMediaUrl(new Blob(['image'],{type:'image/png'}));
 store.control.failWrites=true;await expect(savePostDraft(key,{...empty,content:'keep',previews:[image],originals:[image]})).rejects.toThrow();
 expect((await loadPostDraft(key))!.previews).toHaveLength(1);
 store.control.failWrites=false;await savePostDraft(key,{...empty,content:'sent'});store.control.failWrites=true;
 await expect(removePostDraft(key)).rejects.toThrow();expect(await loadPostDraft(key)).toBeNull();
});
