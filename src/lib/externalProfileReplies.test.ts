import { afterEach, expect, it, vi } from 'vitest';
import { fetchBlueskyAuthorFeed, fetchBlueskyPostThread, mapBlueskyFeedItemToPost } from './bluesky';
import { mapMisskeyNote } from './misskey';
import { externalProfileReplyThread } from './externalProfileReplies';
import type { PostWithAuthor } from '@/types';
import { collectProfilePages } from './profilePopularity';
import { selectProfilePosts } from './profilePostOptions';
const author={did:'did:plc:alice',handle:'alice.bsky.social',displayName:'Alice'};
const uri='at://did:plc:alice/app.bsky.feed.post/';
afterEach(() => vi.unstubAllGlobals());
it('ranks a later Bluesky feed page using the actual mapped like counts',async()=>{
 const entry=(id:string,likes:number,date:string)=>({post:{uri:uri+id,author,likeCount:likes,record:{text:id,createdAt:date}}});
 const fetch=vi.fn().mockResolvedValueOnce({ok:true,status:200,json:async()=>({feed:[entry('new',1,'2026-10-11')],cursor:'next'})})
  .mockResolvedValueOnce({ok:true,status:200,json:async()=>({feed:[entry('older-popular',50,'2026-10-01')]})});
 vi.stubGlobal('fetch',fetch);
 const posts=await collectProfilePages<any,string>(cursor=>fetchBlueskyAuthorFeed({actor:author.handle,cursor,includeReposts:true,filter:'posts_with_replies'}));
 const ranked=selectProfilePosts(posts,'all','popular');
 expect(ranked.map(post=>post.id)).toEqual(['bsky:'+uri+'older-popular','bsky:'+uri+'new']);
 expect(new URL(fetch.mock.calls[1][0]).searchParams.get('cursor')).toBe('next');
});
it('uses Misskey reactions and external reply likes for popularity',()=>{
 const note=(id:string,reactions:Record<string,number>)=>mapMisskeyNote({id,text:id,createdAt:'2026-10-11',visibility:'public',user:{id:'alice',username:'alice'},reactions})!;
 const original=note('original',{heart:2});
 const reply=externalProfileReplyThread(normalize({...note('reply',{heart:4,smile:3}),externalReplyToId:original.id}));
 expect(selectProfilePosts([{post:original},{reply}],'all','popular')[0]).toEqual({reply});
});
it('includes repost activity only when requested by the profile all-posts feed',async()=>{
 const item={post:{uri:uri+'shared',author,record:{text:'shared',createdAt:'2026-10-10'}},reason:{$type:'app.bsky.feed.defs#reasonRepost',by:{did:'did:plc:owner'},indexedAt:'2026-10-11'}};
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({feed:[item]})}));
 const all=await fetchBlueskyAuthorFeed({actor:author.handle,includeReposts:true});
 expect(all.posts[0].profileRepostedBy).toBe('did:plc:owner');
 expect(all.posts[0].profileRepostedAt).toBe('2026-10-11');
 const regular=await fetchBlueskyAuthorFeed({actor:author.handle});
 expect(regular.posts).toEqual([]);
});
it('loads nested replies with their immediate parents for native conversation layout', async () => {
 const post=(id:string)=>({uri:uri+id,author,record:{text:id,createdAt:'2026-10-11'}});
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({thread:{post:post('root'),replies:[{post:post('reply'),replies:[{post:post('answer')}]}]}})});
 vi.stubGlobal('fetch',fetch);
 const result=await fetchBlueskyPostThread('bsky:'+uri+'root');
 expect(result.replies.map(reply=>reply.externalReplyToId)).toEqual(['bsky:'+uri+'root','bsky:'+uri+'reply']);
 expect(new URL(fetch.mock.calls[0][0]).searchParams.get('depth')).toBe('6');
});
function normalize(post: any): PostWithAuthor { return {repostsCount:0,repostedByMe:false,...post,author:{coverUrl:'',...post.author}}; }
it('preserves Bluesky reply relationships and renders the native profile thread data',()=>{
 const parent={uri:uri+'parent',author,record:{text:'parent',createdAt:'2026-10-10'}};
 const reply=mapBlueskyFeedItemToPost({post:{uri:uri+'reply',author,record:{text:'reply',createdAt:'2026-10-11',reply:{parent:{uri:parent.uri}}}},reply:{parent}})!;
 expect(reply.externalReplyToId).toBe('bsky:'+parent.uri);
 expect(reply.externalReplyToUsername).toBe(author.handle);
 const thread=externalProfileReplyThread(normalize(reply));
 expect(thread.parentPost?.content).toBe('parent');expect(thread.comments[0].content).toBe('reply');
 expect(thread.comment.externalPost.id).toBe('bsky:'+uri+'reply');expect(thread.createdAt).toBe('2026-10-11');
 expect(thread.comment.externalPost.replyId).toBeUndefined();
});
it('keeps a reply as a reply when its parent is blocked or unavailable',()=>{
 const post=mapBlueskyFeedItemToPost({post:{uri:uri+'reply',author,record:{text:'reply',reply:{parent:{uri:uri+'private'}}}}})!;
 const thread=externalProfileReplyThread(normalize(post));
 expect(thread.parentPost).toBeNull();expect(thread.comments).toHaveLength(1);expect(thread.comment.postId).toBe('bsky:'+uri+'private');
});
it('preserves Misskey reply parents but never renders private parent content',()=>{
 const user={id:'alice',username:'alice'};
 const parent={id:'parent123',text:'parent',createdAt:'2026-10-10',visibility:'public',user};
 const reply={id:'reply123',replyId:parent.id,reply:parent,text:'reply',createdAt:'2026-10-11',visibility:'public',user};
 const mapped=mapMisskeyNote(reply)!;
 const thread=externalProfileReplyThread(normalize(mapped));
 expect(thread.parentPost?.id).toBe('misskey:https://misskey.io/notes/parent123');
 expect(thread.comment.externalPost.id).toBe('misskey:https://misskey.io/notes/reply123');
 const privateReply=mapMisskeyNote({...reply,reply:{...parent,visibility:'followers'}})!;
 expect(privateReply.externalReplyParent).toBeNull();expect(privateReply.externalReplyToId).toBe(mapped.externalReplyToId);
});
it('does not classify original posts as replies',()=>{
 const original=mapBlueskyFeedItemToPost({post:{uri:uri+'original',author,record:{text:'original'}}});
 expect(original?.externalReplyToId).toBeUndefined();
});
