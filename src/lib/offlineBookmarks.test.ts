import {afterEach,expect,it,vi} from 'vitest';
const invoke=vi.hoisted(()=>vi.fn());vi.mock('./supabase',()=>({supabase:{functions:{invoke}}}));
import {bookmarkAssetUrls,downloadBookmarkAssets,isInstalledPwa,openOfflineBookmarks,type OfflineBookmarks} from './offlineBookmarks';
import type {PostWithAuthor} from '@/types';
afterEach(()=>vi.unstubAllGlobals());
it('collects unique avatars and media from originals and nested quote snapshots',()=>{
 const post={id:'p',content:'https://external.example/article',imageUrls:['https://media.example/image'],author:{avatarUrl:'https://media.example/avatar'},parentPost:{imageUrl:'https://media.example/quote',imageUrls:['https://media.example/image']}} as PostWithAuthor;
 expect(bookmarkAssetUrls([post])).toEqual(['https://media.example/image','https://media.example/avatar','https://media.example/quote']);
});
it('keeps network failures from being mistaken for a completed offline download',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false}));
 await expect(downloadBookmarkAssets(['https://media.example/broken'],vi.fn())).rejects.toThrow('画像を保存できません');
});
it('opens stored image blobs locally and releases every allocated URL',()=>{
 const create=vi.fn().mockReturnValue('blob:offline');const revoke=vi.fn();
 class OfflineURL extends URL {static createObjectURL=create;static revokeObjectURL=revoke;}
 vi.stubGlobal('URL',OfflineURL);
 const snapshot={userId:'alice',savedAt:'now',emojis:[],posts:[{id:'post',imageUrls:['https://media.example/image'],author:{avatarUrl:'https://media.example/image'}}],assets:[{url:'https://media.example/image',bytes:new TextEncoder().encode('image').buffer,type:'image/png'}]} as OfflineBookmarks;
 const opened=openOfflineBookmarks(snapshot);
 expect(opened.posts[0].imageUrls).toEqual(['blob:offline']);expect(opened.posts[0].author.avatarUrl).toBe('blob:offline');
 expect(snapshot.posts[0].imageUrls).toEqual(['https://media.example/image']);
 opened.release();expect(revoke).toHaveBeenCalledWith('blob:offline');
});
it('recognizes installed iOS apps while ordinary browser windows remain unchanged',()=>{
 vi.stubGlobal('navigator',{standalone:true});expect(isInstalledPwa()).toBe(true);
 vi.stubGlobal('navigator',{standalone:false});expect(isInstalledPwa()).toBe(false);
});

it('saves media through the authenticated reader when its host blocks browser fetch',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
 const blob=new Blob(['image-bytes'],{type:'application/octet-stream'});Object.defineProperty(blob,'arrayBuffer',{value:async()=>new TextEncoder().encode('image-bytes').buffer});
 invoke.mockResolvedValue({data:blob,error:null,response:{headers:new Headers({'x-lime-image-type':'image/png'})}});
 const assets=await downloadBookmarkAssets(['https://cdn.bsky.app/image/a'],vi.fn());
 expect(assets[0].type).toBe('image/png');expect(assets[0].bytes.byteLength).toBeGreaterThan(0);
 expect(invoke).toHaveBeenCalledWith('link-preview',expect.objectContaining({body:{url:'https://cdn.bsky.app/image/a',mode:'image'}}));
});
