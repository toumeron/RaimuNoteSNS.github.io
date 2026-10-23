/** Community posts stay under their community, including reply permalinks. */
export function postPath(post:{id:string;communityId?:string;replyPostId?:string;replyId?:string}){
 const root=post.replyPostId??post.id;
 const path=post.communityId?`/communities/${encodeURIComponent(post.communityId)}/post/${encodeURIComponent(root)}`:`/post/${encodeURIComponent(post.id)}`;
 return post.communityId&&post.replyId?`${path}?reply=${encodeURIComponent(post.replyId)}`:path;
}

export function postActivityPath(post:Parameters<typeof postPath>[0]){return postPath(post).split('?')[0]+'/activity';}
