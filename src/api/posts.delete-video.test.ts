vi.mock("@/lib/mediaThumbnail", async importOriginal => {
 const actual = await importOriginal<typeof import("@/lib/mediaThumbnail")>();
 return {...actual, ...await (async importOriginal => ({...await importOriginal<typeof import("@/lib/mediaThumbnail")>(), deleteVideoPost:(id:string)=>mocks.remove(id), uploadPostVideo:vi.fn(), discardPostVideo:vi.fn()}))(importOriginal)};
});


import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({remove:vi.fn(),readError:null as Error|null,writeError:null as Error|null,post:{id:'post',video:{key:'video'}} as {id:string;video:object|null}|null,filters:[] as [string,unknown][],deletes:0}));
vi.mock('@/lib/currentUser',()=>({getCurrentUserId:async()=> 'owner'}));

vi.mock('@/lib/supabase',()=>({supabase:{from:()=>{
 let write=false;const builder={select:()=>builder,eq:(key:string,value:unknown)=>{mocks.filters.push([key,value]);return builder;},maybeSingle:()=>builder,delete:()=>{mocks.deletes++;write=true;return builder;},then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:write?null:mocks.post,error:write?mocks.writeError:mocks.readError}).then(resolve)};return builder;
}}}));
import {deletePost} from './posts';
beforeEach(()=>{vi.clearAllMocks();mocks.post={id:'post',video:{key:'video'}};mocks.readError=null;mocks.writeError=null;mocks.filters=[];mocks.deletes=0;mocks.remove.mockResolvedValue(undefined);});
it('routes owned video deletion through the storage worker instead of deleting the metadata first',async()=>{
 await deletePost('post');expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('post');expect(mocks.deletes).toBe(0);expect(mocks.filters).toEqual([['id','post'],['user_id','owner']]);
});
it('preserves the existing direct deletion path for posts without video',async()=>{
 mocks.post={id:'post',video:null};await deletePost('post');expect(mocks.remove).not.toHaveBeenCalled();expect(mocks.deletes).toBe(1);
});
it('never falls back to deleting the row when video cleanup fails',async()=>{
 mocks.remove.mockRejectedValue(new Error('動画ファイルを削除できませんでした'));await expect(deletePost('post')).rejects.toThrow('動画ファイル');expect(mocks.deletes).toBe(0);
});
it('does not touch storage or delete a row when reading ownership metadata fails',async()=>{
 mocks.readError=new Error('database unavailable');await expect(deletePost('post')).rejects.toThrow('database unavailable');expect(mocks.remove).not.toHaveBeenCalled();expect(mocks.deletes).toBe(0);
});
