import { expect, it } from 'vitest';
import { selectProfilePosts } from './profilePostOptions';
const items = [
  {post:{id:'post',createdAt:'2026-10-11',likesCount:2}},
  {reply:{comment:{id:'reply',likes_count:5}},sortAt:'2026-10-10'},
  {post:{id:'repost',profileRepostedBy:'owner',createdAt:'2026-10-09',likesCount:9}},
  {post:{id:'quote',isQuote:true,parentId:'parent',createdAt:'2026-10-08',likesCount:2}},
  {post:{id:'external-reply',externalReplyToId:'parent',createdAt:'2026-10-07',likesCount:3}},
];
const id = (item:any) => item.post?.id ?? item.reply.comment.id;
it('all includes posts, replies and repost activity in chronological order',()=>{
 expect(selectProfilePosts(items,'all','latest').map(id)).toEqual(['post','reply','repost','quote','external-reply']);
});
it('posts excludes native/external replies and reposts but keeps authored quotes',()=>{
 expect(selectProfilePosts(items,'posts','latest').map(id)).toEqual(['post','quote']);
});
it('popular uses likes and resolves ties by newest first without mutating input',()=>{
 expect(selectProfilePosts(items,'all','popular').map(id)).toEqual(['repost','reply','external-reply','post','quote']);
 expect(items.map(id)).toEqual(['post','reply','repost','quote','external-reply']);
});
it('uses stable post identity when likes and timestamps are identical', () => {
 const posts = ['z', 'a', 'm'].map(id => ({ id, createdAt: '2026-10-11', likesCount: 3 }));
 expect(selectProfilePosts(posts, 'all', 'popular').map(p => p.id)).toEqual(['a', 'm', 'z']);
 expect(selectProfilePosts([...posts].reverse(), 'all', 'popular').map(p => p.id)).toEqual(['a', 'm', 'z']);
});
