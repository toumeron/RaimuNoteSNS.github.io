import { useParams } from 'react-router-dom';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { PostCard } from '@/components/feed/PostCard';
import { PostCardSkeleton } from '@/components/feed/PostCardSkeleton';
import { Skeleton } from '@/components/ui/skeleton';
import { useProfile } from '@/hooks/useProfile';
import { useUserPosts } from '@/hooks/useFeed';

export default function Profile() {
  const { username = '' } = useParams();
  const { data: user, isLoading: userLoading, isError: userError } = useProfile(username);
  const { data: posts, isLoading: postsLoading } = useUserPosts(user?.id);

  if (userLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-72 w-full rounded-3xl" />
        <PostCardSkeleton />
        <PostCardSkeleton />
      </div>
    );
  }

  if (userError || user === null) {
    return (
      <div className="rounded-3xl border border-border/60 bg-card p-10 text-center text-muted-foreground">
        ユーザーが見つかりませんでした。
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {user && <ProfileHeader user={user} />}

      <h2 className="font-display text-lg font-bold">投稿</h2>

      <div className="space-y-4">
        {postsLoading && (
          <>
            <PostCardSkeleton />
            <PostCardSkeleton />
          </>
        )}
        {posts && posts.length === 0 && (
          <div className="rounded-3xl border border-dashed border-border bg-card/60 p-8 text-center text-sm text-muted-foreground">
            まだ投稿がありません。
          </div>
        )}
        {posts?.map((p) => (
          <PostCard key={p.id} post={p} />
        ))}
      </div>
    </div>
  );
}
