import { CommentCard } from './CommentList';
import { useAuth } from '@/hooks/useAuth';
import type { PostWithAuthor } from '@/types';

export function RepostedReplyCard({post,repostedByLabel,embedded=false}:{post:PostWithAuthor;repostedByLabel?:string;embedded?:boolean}) {
  const {user}=useAuth();
  return <CommentCard currentUserId={user?.id ?? null} mobileFlat thread={embedded} embedded={embedded} repostedByLabel={repostedByLabel} replyToUsername={post.replyToUsername}
    comment={{id:post.replyId!,postId:post.replyPostId!,userId:post.userId,content:post.content,imageUrls:post.imageUrls,
      createdAt:post.createdAt,likesCount:post.likesCount,likedByMe:post.likedByMe,commentsCount:post.commentsCount,author:post.author}} />;
}
