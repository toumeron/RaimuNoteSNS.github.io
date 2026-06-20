import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import { Loader2, Image as ImageIcon, X, MessageCircle } from 'lucide-react';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { PostCard } from '@/components/feed/PostCard';
import { PostCardSkeleton } from '@/components/feed/PostCardSkeleton';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LikeButton } from '@/components/post/LikeButton';
import {
  useProfile,
  useUserPostsInfinite,
  useUserLikesInfinite,
  useUserMediaInfinite,
  useUserReactionsInfinite,
} from '@/hooks/useProfile';

type ProfileTabValue = 'posts' | 'likes' | 'media' | 'reactions';

const profileTabs: Array<{ value: ProfileTabValue; label: string }> = [
  { value: 'posts', label: 'ポスト' },
  { value: 'media', label: 'メディア' },
  { value: 'likes', label: 'いいね' },
  { value: 'reactions', label: 'リアクション' },
];

export default function Profile() {
  const { username = '' } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<ProfileTabValue>('posts');

  // メディア拡大用のステート
  const [selectedMedia, setSelectedMedia] = useState<{ url: string; post: any } | null>(null);
  const [isScrolled, setIsScrolled] = useState(false);
  const tabsSentinelRef = useRef<HTMLDivElement>(null);

  const { data: user, isLoading: userLoading, isError: userError } = useProfile(username);

  // 各無限スクロールクエリの定義
  const postsQuery = useUserPostsInfinite(user?.id);
  const likesQuery = useUserLikesInfinite(user?.id);
  const mediaQuery = useUserMediaInfinite(user?.id);
  const reactionsQuery = useUserReactionsInfinite(user?.id);

  // タブに応じて使用するクエリを切り替え（Supabaseレベルでフィルタリングされた結果を取得）
  const currentQuery =
    activeTab === 'likes'
      ? likesQuery
      : activeTab === 'media'
        ? mediaQuery
        : activeTab === 'reactions'
          ? reactionsQuery
          : postsQuery;

  const {
    data,
    isLoading: contentLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isError: contentError,
  } = currentQuery;

  const { ref, inView } = useInView();

  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

  useEffect(() => {
    const handleScroll = () => {
      if (!tabsSentinelRef.current) return;
      setIsScrolled(tabsSentinelRef.current.getBoundingClientRect().top <= 0);
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, []);

  // モーダル表示時にスクロールを固定
  useEffect(() => {
    if (selectedMedia) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [selectedMedia]);

  // 数値をフォーマットする関数 (PostCardと同期)
  const formatDisplayCount = (count: number) => {
    const safeCount = Number(count) || 0;

    if (safeCount >= 10000) {
      return (safeCount / 10000).toFixed(1).replace(/\.0$/, '') + '万';
    }

    return safeCount.toLocaleString();
  };

  // 画像URLを判定する正規表現 (PostCardと同期)
  const imageRegex =
    /https?:\/\/[^\s]+?\.(?:png|jpg|jpeg|gif|webp|svg)(?:\?[^\s]*)?|https?:\/\/pbs\.twimg\.com\/media\/[^\s?]+(?:\?[^\s]*)?/gi;

  // PostCardに渡す前に、undefinedになりやすい投稿者情報を補完する
  const normalizeAuthor = (author: any, fallbackUserId = ''): any => {
    const safeUsername = author?.username ?? '';
    const safeDisplayName = author?.display_name ?? author?.displayName ?? safeUsername;

    return {
      ...author,
      id: author?.id ?? fallbackUserId ?? '',
      username: safeUsername,
      display_name: safeDisplayName,
      displayName: safeDisplayName,
      bio: author?.bio ?? '',
      avatar_url: author?.avatar_url ?? author?.avatarUrl ?? null,
      avatarUrl: author?.avatarUrl ?? author?.avatar_url ?? null,
      cover_url: author?.cover_url ?? author?.coverUrl ?? null,
      coverUrl: author?.coverUrl ?? author?.cover_url ?? null,
      created_at: author?.created_at ?? author?.createdAt ?? new Date().toISOString(),
      createdAt: author?.createdAt ?? author?.created_at ?? new Date().toISOString(),
      is_official: !!(author?.is_official ?? author?.isOfficial),
      isOfficial: !!(author?.isOfficial ?? author?.is_official),
      emoji_effect: author?.emoji_effect ?? author?.emojiEffect ?? '',
      emojiEffect: author?.emojiEffect ?? author?.emoji_effect ?? '',
      bot_enabled: !!(author?.bot_enabled ?? author?.botEnabled),
      botEnabled: !!(author?.botEnabled ?? author?.bot_enabled),
      bot_prompt: author?.bot_prompt ?? author?.botPrompt ?? '',
      botPrompt: author?.botPrompt ?? author?.bot_prompt ?? '',
      bot_interval_hours: author?.bot_interval_hours ?? author?.botIntervalHours ?? 5,
      botIntervalHours: author?.botIntervalHours ?? author?.bot_interval_hours ?? 5,
      prefecture: author?.prefecture ?? '',
      city: author?.city ?? '',
    };
  };

  // PostCardに渡す前に、undefinedになりやすい投稿情報を補完する
  const normalizePost = (post: any, reaction?: any): any | null => {
    if (!post) return null;

    const baseAuthor = post.author ?? post.profiles ?? post.user ?? null;
    const safeAuthor = normalizeAuthor(baseAuthor, post.user_id ?? post.userId ?? '');

    const imageUrls = Array.isArray(post.imageUrls)
      ? post.imageUrls
      : Array.isArray(post.image_urls)
        ? post.image_urls
        : [];

    return {
      ...post,

      id: post.id ?? '',

      user_id: post.user_id ?? post.userId ?? safeAuthor.id,
      userId: post.userId ?? post.user_id ?? safeAuthor.id,

      content: post.content ?? '',

      image_urls: imageUrls,
      imageUrls,

      created_at: post.created_at ?? post.createdAt ?? new Date().toISOString(),
      createdAt: post.createdAt ?? post.created_at ?? new Date().toISOString(),

      likes_count: Number(post.likes_count ?? post.likesCount ?? 0),
      likesCount: Number(post.likesCount ?? post.likes_count ?? 0),

      comments_count: Number(post.comments_count ?? post.commentsCount ?? 0),
      commentsCount: Number(post.commentsCount ?? post.comments_count ?? 0),

      reposts_count: Number(post.reposts_count ?? post.repostsCount ?? 0),
      repostsCount: Number(post.repostsCount ?? post.reposts_count ?? 0),

      liked_by_me: !!(post.liked_by_me ?? post.likedByMe),
      likedByMe: !!(post.likedByMe ?? post.liked_by_me),

      reposted_by_me: !!(post.reposted_by_me ?? post.repostedByMe),
      repostedByMe: !!(post.repostedByMe ?? post.reposted_by_me),

      client_name: post.client_name ?? post.clientName ?? '',
      clientName: post.clientName ?? post.client_name ?? '',

      parent_id: post.parent_id ?? post.parentId ?? null,
      parentId: post.parentId ?? post.parent_id ?? null,

      is_quote: !!(post.is_quote ?? post.isQuote),
      isQuote: !!(post.isQuote ?? post.is_quote),

      visibility: post.visibility ?? 'public',

      is_bot: !!(post.is_bot ?? post.isBot),
      isBot: !!(post.isBot ?? post.is_bot),

      source_twitter: !!(post.source_twitter ?? post.sourceTwitter),
      sourceTwitter: !!(post.sourceTwitter ?? post.source_twitter),

      origin_url: post.origin_url ?? post.originUrl ?? '',
      originUrl: post.originUrl ?? post.origin_url ?? '',

      prefecture: post.prefecture ?? '',
      city: post.city ?? '',

      author: safeAuthor,
      profiles: safeAuthor,
      user: safeAuthor,

      reactionId: reaction?.id ?? post.reactionId ?? null,
      reactionEmoji: reaction?.emoji ?? post.reactionEmoji ?? '',
      reactionCreatedAt: reaction?.created_at ?? post.reactionCreatedAt ?? null,

      reactionEmojis: Array.isArray(post.reactionEmojis)
        ? post.reactionEmojis
        : reaction?.emoji
          ? [reaction.emoji]
          : [],
    };
  };

  // 通常投稿・いいね投稿でも同じ投稿が重複した場合に key 警告を防ぐ
  const uniquePostsById = (posts: any[]) => {
    const map = new Map<string, any>();

    posts.forEach((post: any) => {
      const normalized = normalizePost(post);
      if (!normalized?.id) return;

      if (!map.has(normalized.id)) {
        map.set(normalized.id, normalized);
      }
    });

    return Array.from(map.values());
  };

  // リアクション欄用：全ページをまとめてから同じ投稿を1枚にまとめる
  const groupReactionPosts = (reactions: any[]) => {
    const grouped = new Map<string, any>();

    reactions.forEach((reaction: any) => {
      const rawPost = reaction.posts ?? reaction.post;
      const post = normalizePost(rawPost, reaction);

      if (!post?.id) return;

      const existing = grouped.get(post.id);
      const nextEmoji = reaction.emoji ?? post.reactionEmoji ?? '';

      if (!existing) {
        grouped.set(post.id, {
          ...post,
          reactionId: reaction.id ?? post.reactionId ?? post.id,
          reactionEmoji: nextEmoji,
          reactionCreatedAt: reaction.created_at ?? post.reactionCreatedAt ?? null,
          reactionEmojis: nextEmoji ? [nextEmoji] : [],
        });
        return;
      }

      const currentEmojis = Array.isArray(existing.reactionEmojis)
        ? existing.reactionEmojis
        : existing.reactionEmoji
          ? [existing.reactionEmoji]
          : [];

      const mergedEmojis =
        nextEmoji && !currentEmojis.includes(nextEmoji)
          ? [...currentEmojis, nextEmoji]
          : currentEmojis;

      grouped.set(post.id, {
        ...existing,
        reactionId: existing.reactionId ?? reaction.id ?? post.id,
        reactionCreatedAt: existing.reactionCreatedAt ?? reaction.created_at ?? null,
        reactionEmojis: mergedEmojis,
        reactionEmoji: mergedEmojis.join(' '),
      });
    });

    return Array.from(grouped.values());
  };

  const pages = data?.pages ?? [];
  const flatPageItems = pages.flatMap((page: any) => (Array.isArray(page) ? page : []));

  // データのフラット化
  const items = (() => {
    if (activeTab === 'likes') {
      return uniquePostsById(
        flatPageItems
          .map((like: any) => like.posts)
          .filter(Boolean)
      );
    }

    if (activeTab === 'reactions') {
      return groupReactionPosts(flatPageItems);
    }

    if (activeTab === 'media') {
      return flatPageItems.flatMap((rawPost: any) => {
        const p: any | null = normalizePost(rawPost);
        if (!p) return [];

        const dbImages = Array.isArray(p.imageUrls)
          ? p.imageUrls
          : Array.isArray(p.image_urls)
            ? p.image_urls
            : [];

        const extractedImages = typeof p.content === 'string' ? p.content.match(imageRegex) || [] : [];
        const allUrls = Array.from(new Set([...dbImages, ...extractedImages]));

        if (allUrls.length === 0) return [];

        // 投稿オブジェクトそのものを返しつつ、表示用のURLだけを個別に持たせる
        return allUrls.map((url, idx) => ({
          ...p,
          displayImageUrl: url,
          displayImageKey: `${p.id}-${idx}-${url}`,
          isMulti: allUrls.length > 1,
          // 確実に数値を維持
          likesCount: p.likesCount ?? p.likes_count ?? 0,
          commentsCount: p.commentsCount ?? p.comments_count ?? 0,
          likedByMe: !!(p.likedByMe ?? p.liked_by_me),
        }));
      });
    }

    return uniquePostsById(flatPageItems);
  })();

  if (userLoading) {
    return (
      <div className="-mt-[56px] space-y-0 sm:mt-0 sm:space-y-5">
        <Skeleton className="h-72 w-full rounded-none sm:rounded-3xl" />

        <div className="h-16 w-full sm:hidden">
          <div className="grid h-full w-full grid-cols-4 rounded-none bg-transparent p-0">
            <Skeleton className="h-full rounded-none bg-muted/40" />
            <Skeleton className="h-full rounded-none bg-muted/40" />
            <Skeleton className="h-full rounded-none bg-muted/40" />
            <Skeleton className="h-full rounded-none bg-muted/40" />
          </div>
        </div>

        <div className="hidden gap-2 sm:flex">
          <Skeleton className="h-10 w-1/4 rounded-xl" />
          <Skeleton className="h-10 w-1/4 rounded-xl" />
          <Skeleton className="h-10 w-1/4 rounded-xl" />
          <Skeleton className="h-10 w-1/4 rounded-xl" />
        </div>

        <div className="space-y-0 sm:space-y-4">
          <PostCardSkeleton />
          <PostCardSkeleton />
        </div>
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
    <div className="-mt-[56px] space-y-0 sm:mt-0 sm:space-y-5">
      <style>
        {`
          .profile-tabs-trigger[data-state='active'] {
            color: hsl(var(--foreground));
            font-weight: 1000;
          }

          .profile-tabs-trigger[data-state='inactive'] {
            color: hsl(var(--muted-foreground));
            font-weight: 500;
          }

          .profile-tabs-trigger[data-state='active'] .profile-tabs-underline {
            display: block;
          }

          .profile-tabs-trigger[data-state='inactive'] .profile-tabs-underline {
            display: none;
          }
        `}
      </style>

      {user && <ProfileHeader user={user} />}

      <Tabs
        value={activeTab}
        defaultValue="posts"
        className="w-full"
        onValueChange={(value) => setActiveTab(value as ProfileTabValue)}
      >
        <div ref={tabsSentinelRef} className="h-0" />

        <div
          className={[
            'relative sticky top-0 z-50 flex h-16 w-full items-center sm:transition-all sm:duration-300',
            isScrolled
              ? 'bg-[#fbf9f2]/65 backdrop-blur-md dark:bg-[#000000]/65 sm:border-b sm:border-black/[0.03] sm:bg-[#fbf9f2]/70 sm:dark:border-white/[0.05] sm:dark:bg-[#000000]/70'
              : 'bg-transparent',
          ].join(' ')}
        >
          <div
            className={[
              'pointer-events-none absolute h-px sm:hidden',
              'left-1/2 w-screen -translate-x-1/2',
              isScrolled
                ? 'bottom-0 bg-black/[0.03] dark:bg-white/[0.05]'
                : 'bottom-2 bg-border/50',
            ].join(' ')}
          />

          <TabsList className="grid h-full w-full grid-cols-4 rounded-none bg-transparent p-0 shadow-none sm:hidden">
            {profileTabs.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="profile-tabs-trigger relative h-full min-h-15 min-w-0 rounded-none border-0 bg-transparent px-0 text-[16px] leading-none shadow-none outline-none transition-none duration-0 hover:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=inactive]:bg-transparent min-[390px]:text-[13px] sm:text-[14px]"
              >
                <span className="whitespace-nowrap">
                  {tab.label}
                </span>

                <span className="profile-tabs-underline absolute bottom-2 left-1/2 h-[4px] w-16 -translate-x-1/2 rounded-full bg-pink-500 sm:w-10" />
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsList className="hidden w-full grid-cols-4 rounded-2xl bg-muted/50 p-1 sm:grid">
            {profileTabs.map((tab) => (
              <TabsTrigger
                key={`desktop-${tab.value}`}
                value={tab.value}
                className="rounded-xl font-bold transition-all"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="space-y-0 sm:space-y-4">
          {contentLoading && (
            <>
              <PostCardSkeleton />
              <PostCardSkeleton />
            </>
          )}

          {!contentLoading && contentError && (
            <div className="m-4 rounded-3xl border border-dashed border-border bg-card/60 p-10 text-center text-sm text-muted-foreground animate-in fade-in zoom-in duration-300 sm:m-0 sm:p-12">
              {activeTab === 'posts' && '投稿の取得に失敗しました。'}
              {activeTab === 'likes' && 'いいねした投稿の取得に失敗しました。'}
              {activeTab === 'media' && 'メディア投稿の取得に失敗しました。'}
              {activeTab === 'reactions' && 'リアクションの取得に失敗しました。'}
            </div>
          )}

          {!contentLoading && !contentError && !isFetchingNextPage && items.length === 0 && (
            <div className="m-4 rounded-3xl border border-dashed border-border bg-card/60 p-10 text-center text-sm text-muted-foreground animate-in fade-in zoom-in duration-300 sm:m-0 sm:p-12">
              {activeTab === 'posts' && 'まだ投稿がありません。'}
              {activeTab === 'likes' && 'いいねした投稿がありません。'}
              {activeTab === 'media' && 'メディア投稿がありません。'}
              {activeTab === 'reactions' && 'リアクションした投稿がありません。'}
            </div>
          )}

          {activeTab === 'media' ? (
            <div className="grid grid-cols-3 gap-1 px-0 md:gap-2">
              {items.map((p: any, idx: number) => (
                <div
                  key={`media-${p.displayImageKey ?? `${p.id}-${idx}`}`}
                  className="relative aspect-square cursor-pointer overflow-hidden rounded-md bg-muted animate-float-up md:rounded-xl"
                  onClick={() => setSelectedMedia({ url: p.displayImageUrl, post: p })}
                >
                  <img
                    src={p.displayImageUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />

                  {p.isMulti && (
                    <div className="absolute right-1.5 top-1.5 rounded-md bg-black/40 p-1 backdrop-blur-sm">
                      <ImageIcon className="h-3.5 w-3.5 text-white" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            items.map((p: any, idx: number) => (
              <div
                key={activeTab === 'reactions' ? `reactions-${p.id}-${idx}` : `${activeTab}-${p.id}-${idx}`}
                className="animate-float-up"
              >
                {activeTab === 'reactions' && (
                  <div className="px-1 pb-1 text-sm text-muted-foreground">
                    <span className="mr-1 text-base">
                      {Array.isArray(p.reactionEmojis) && p.reactionEmojis.length > 0
                        ? p.reactionEmojis.join(' ')
                        : p.reactionEmoji}
                    </span>
                    でリアクションしました
                  </div>
                )}

                <PostCard post={p} />
              </div>
            ))
          )}

          <div ref={ref} className="flex justify-center py-8 sm:py-10">
            {isFetchingNextPage ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">さらに読み込み中...</span>
              </div>
            ) : hasNextPage ? (
              <div className="h-8 sm:h-10" />
            ) : items.length > 0 ? (
              <p className="text-center text-xs text-muted-foreground">
                すべての表示が完了しました
              </p>
            ) : null}
          </div>
        </div>
      </Tabs>

      {/* メディア拡大オーバーレイ */}
      {selectedMedia && (
        <div
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/95 backdrop-blur-sm animate-in fade-in duration-200"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            margin: 0,
            padding: 0,
          }}
          onClick={() => setSelectedMedia(null)}
        >
          <button
            type="button"
            className="absolute left-5 top-5 z-[10000] rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
            onClick={() => setSelectedMedia(null)}
          >
            <X className="h-6 w-6" />
          </button>

          <div className="relative flex h-full w-full items-center justify-center p-4">
            <img
              src={selectedMedia.url}
              alt="Expanded view"
              className="max-h-[92vh] max-w-[95vw] object-contain shadow-2xl animate-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <div
            className="absolute bottom-0 left-0 right-0 flex items-center justify-center bg-gradient-to-t from-black/90 to-transparent pb-10 pt-20"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-8 rounded-full border border-white/10 bg-black/60 px-8 py-4 shadow-xl backdrop-blur-md">
              <div className="scale-125">
                <LikeButton
                  postId={selectedMedia.post.id}
                  liked={selectedMedia.post.likedByMe}
                  count={Number(selectedMedia.post.likesCount)}
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  setSelectedMedia(null);
                  navigate(`/post/${selectedMedia.post.id}`);
                }}
                className="inline-flex items-center gap-2 text-white/90 transition-colors hover:text-white"
              >
                <MessageCircle className="h-6 w-6" />

                <span className="text-lg font-bold tabular-nums">
                  {formatDisplayCount(selectedMedia.post.commentsCount)}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}