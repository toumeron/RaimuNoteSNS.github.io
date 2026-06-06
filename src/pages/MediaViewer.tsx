import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  UserCircle,
} from "lucide-react";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { LikeButton } from "@/components/post/LikeButton";

type RawProfile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_official: boolean | null;
};

type RawPost = {
  id: string;
  user_id: string;
  content: string | null;
  image_urls: string[] | null;
  created_at: string;
  likes_count: number | null;
  comments_count: number | null;
  reposts_count: number | null;
  client_name: string | null;
  parent_id: string | null;
  is_quote: boolean | null;
  visibility: "public" | "following" | string | null;
  is_bot: boolean | null;
  source_twitter: boolean | null;
  origin_url: string | null;
  prefecture: string | null;
  city: string | null;
  profiles: RawProfile | RawProfile[] | null;
};

type NormalizedAuthor = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isOfficial: boolean;
};

type NormalizedPost = {
  id: string;
  userId: string;
  content: string;
  displayContent: string;
  imageUrls: string[];
  createdAt: string;
  likesCount: number;
  commentsCount: number;
  repostsCount: number;
  likedByMe: boolean;
  clientName: string;
  parentId: string | null;
  isQuote: boolean;
  visibility: "public" | "following";
  isBot: boolean;
  sourceTwitter: boolean;
  originUrl: string;
  prefecture: string;
  city: string;
  author: NormalizedAuthor;
};

type MediaViewerItem = NormalizedPost & {
  displayImageUrl: string;
  displayImageKey: string;
  imageIndex: number;
  imageCount: number;
};

const PAGE_SIZE = 30;

const imageRegex =
  /https?:\/\/[^\s]+?\.(?:png|jpg|jpeg|gif|webp|svg)(?:\?[^\s]*)?|https?:\/\/pbs\.twimg\.com\/media\/[^\s?]+(?:\?[^\s]*)?/gi;

const youtubeRegex =
  /(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/(watch\?v=|embed\/|shorts\/)?([a-zA-Z0-9_-]{11})([^?\s\n]*)?(\S+)?/g;

const spotifyRegex =
  /https:\/\/open\.spotify\.com\/(?:[\w-]+\/)?(track|album|playlist)\/[a-zA-Z0-9._?=&/%-]+/gi;

const normalizeAuthor = (
  profile: RawProfile | RawProfile[] | null,
  fallbackUserId: string
): NormalizedAuthor => {
  const safeProfile = Array.isArray(profile) ? profile[0] ?? null : profile;

  const safeUsername = safeProfile?.username ?? "";
  const safeDisplayName = safeProfile?.display_name ?? safeUsername;

  return {
    id: safeProfile?.id ?? fallbackUserId,
    username: safeUsername,
    displayName: safeDisplayName,
    avatarUrl: safeProfile?.avatar_url ?? null,
    isOfficial: Boolean(safeProfile?.is_official),
  };
};

const buildDisplayContent = (content: string) => {
  return content
    .replace(youtubeRegex, "")
    .replace(imageRegex, "")
    .replace(spotifyRegex, "")
    .trim();
};

const normalizePost = (
  rawPost: RawPost,
  likedPostIds: Set<string>
): NormalizedPost => {
  const author = normalizeAuthor(rawPost.profiles, rawPost.user_id);

  const dbImageUrls = Array.isArray(rawPost.image_urls)
    ? rawPost.image_urls.filter(
        (url): url is string =>
          typeof url === "string" && url.trim().length > 0
      )
    : [];

  const content = rawPost.content ?? "";

  const extractedImageUrls = content.match(imageRegex) ?? [];

  const imageUrls = Array.from(
    new Set(
      [...dbImageUrls, ...extractedImageUrls]
        .map((url) => url.trim())
        .filter((url) => url.length > 0)
    )
  );

  return {
    id: rawPost.id,
    userId: rawPost.user_id,
    content,
    displayContent: buildDisplayContent(content),
    imageUrls,
    createdAt: rawPost.created_at,
    likesCount: Number(rawPost.likes_count ?? 0),
    commentsCount: Number(rawPost.comments_count ?? 0),
    repostsCount: Number(rawPost.reposts_count ?? 0),
    likedByMe: likedPostIds.has(rawPost.id),
    clientName: rawPost.client_name ?? "",
    parentId: rawPost.parent_id ?? null,
    isQuote: Boolean(rawPost.is_quote),
    visibility: rawPost.visibility === "following" ? "following" : "public",
    isBot: Boolean(rawPost.is_bot),
    sourceTwitter: Boolean(rawPost.source_twitter),
    originUrl: rawPost.origin_url ?? "",
    prefecture: rawPost.prefecture ?? "",
    city: rawPost.city ?? "",
    author,
  };
};

export default function MediaViewer() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const scrollTickingRef = useRef(false);

  const [posts, setPosts] = useState<NormalizedPost[]>([]);
  const [activeItemKey, setActiveItemKey] = useState<string | null>(null);

  const [page, setPage] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(true);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);
  const [isError, setIsError] = useState(false);

  const fetchMediaPosts = useCallback(
    async (pageToFetch: number) => {
      if (pageToFetch === 0) {
        setIsInitialLoading(true);
      } else {
        setIsFetchingNextPage(true);
      }

      setIsError(false);

      const from = pageToFetch * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      try {
        let followingUserIds = new Set<string>();

        if (user?.id) {
          const { data: followsData, error: followsError } = await supabase
            .from("follows")
            .select("followee_id")
            .eq("follower_id", user.id);

          if (followsError) {
            console.warn("MediaViewer follows fetch failed:", followsError);
          }

          followingUserIds = new Set(
            (followsData ?? []).map(
              (follow: { followee_id: string }) => follow.followee_id
            )
          );
        }

        const { data: rawPosts, error: postsError } = await supabase
          .from("posts")
          .select(`
            id,
            user_id,
            content,
            image_urls,
            created_at,
            likes_count,
            comments_count,
            reposts_count,
            client_name,
            parent_id,
            is_quote,
            visibility,
            is_bot,
            source_twitter,
            origin_url,
            prefecture,
            city,
            profiles!posts_user_id_fkey (
              id,
              username,
              display_name,
              avatar_url,
              is_official
            )
          `)
          .order("created_at", { ascending: false })
          .range(from, to);

        if (postsError) {
          throw postsError;
        }

        const safeRawPosts = (rawPosts ?? []) as RawPost[];
        const postIds = safeRawPosts.map((post) => post.id);

        let likedPostIds = new Set<string>();

        if (user?.id && postIds.length > 0) {
          const { data: likesData, error: likesError } = await supabase
            .from("likes")
            .select("post_id")
            .eq("user_id", user.id)
            .in("post_id", postIds);

          if (likesError) {
            console.warn("MediaViewer likes fetch failed:", likesError);
          }

          likedPostIds = new Set(
            (likesData ?? []).map((like) => like.post_id as string)
          );
        }

        const normalizedPosts = safeRawPosts
          .map((rawPost) => normalizePost(rawPost, likedPostIds))
          .filter((post) => {
            if (post.imageUrls.length === 0) {
              return false;
            }

            if (post.visibility === "public") {
              return true;
            }

            if (!user?.id) {
              return false;
            }

            if (post.userId === user.id) {
              return true;
            }

            if (
              post.visibility === "following" &&
              followingUserIds.has(post.userId)
            ) {
              return true;
            }

            return false;
          });

        setPosts((currentPosts) => {
          if (pageToFetch === 0) {
            return normalizedPosts;
          }

          const map = new Map<string, NormalizedPost>();

          currentPosts.forEach((post) => {
            map.set(post.id, post);
          });

          normalizedPosts.forEach((post) => {
            map.set(post.id, post);
          });

          return Array.from(map.values());
        });

        setHasNextPage(safeRawPosts.length === PAGE_SIZE);
        setPage(pageToFetch);
      } catch (error) {
        console.error("MediaViewer fetch error:", error);
        setIsError(true);
      } finally {
        setIsInitialLoading(false);
        setIsFetchingNextPage(false);
      }
    },
    [user?.id]
  );

  useEffect(() => {
    setPosts([]);
    setPage(0);
    setHasNextPage(true);
    setActiveItemKey(null);
    fetchMediaPosts(0);
  }, [fetchMediaPosts]);

  const mediaItems = useMemo<MediaViewerItem[]>(() => {
    return posts.flatMap((post) => {
      const imageUrls = Array.isArray(post.imageUrls) ? post.imageUrls : [];

      if (imageUrls.length === 0) {
        return [];
      }

      return imageUrls.map((imageUrl, index) => {
        return {
          ...post,
          displayImageUrl: imageUrl,
          displayImageKey: `${post.id}-${index}-${imageUrl}`,
          imageIndex: index,
          imageCount: imageUrls.length,
        };
      });
    });
  }, [posts]);

  const activeItem =
    mediaItems.find((item) => item.displayImageKey === activeItemKey) ??
    mediaItems[0] ??
    null;

  const updateActiveItemByScroll = useCallback(() => {
    const rootElement = scrollRootRef.current;

    if (!rootElement) {
      return;
    }

    const itemElements =
      rootElement.querySelectorAll<HTMLElement>("[data-media-key]");

    if (itemElements.length === 0) {
      return;
    }

    const rootRect = rootElement.getBoundingClientRect();
    const isMobile = window.innerWidth < 768;

    if (isMobile) {
      const activeLineY = rootRect.top + rootRect.height * 0.38;

      let nearestKey: string | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;

      itemElements.forEach((element) => {
        const rect = element.getBoundingClientRect();
        const elementCenterY = rect.top + rect.height / 2;
        const distance = Math.abs(elementCenterY - activeLineY);

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestKey = element.getAttribute("data-media-key");
        }
      });

      if (nearestKey) {
        setActiveItemKey((currentKey) => {
          if (currentKey === nearestKey) {
            return currentKey;
          }

          return nearestKey;
        });
      }

      return;
    }

    let mostVisibleKey: string | null = null;
    let mostVisibleHeight = 0;

    itemElements.forEach((element) => {
      const rect = element.getBoundingClientRect();

      const visibleTop = Math.max(rect.top, rootRect.top);
      const visibleBottom = Math.min(rect.bottom, rootRect.bottom);
      const visibleHeight = Math.max(0, visibleBottom - visibleTop);

      if (visibleHeight > mostVisibleHeight) {
        mostVisibleHeight = visibleHeight;
        mostVisibleKey = element.getAttribute("data-media-key");
      }
    });

    if (mostVisibleKey) {
      setActiveItemKey((currentKey) => {
        if (currentKey === mostVisibleKey) {
          return currentKey;
        }

        return mostVisibleKey;
      });
    }
  }, []);

  useEffect(() => {
    if (mediaItems.length === 0) {
      setActiveItemKey(null);
      return;
    }

    setActiveItemKey((currentKey) => {
      const currentStillExists = mediaItems.some(
        (item) => item.displayImageKey === currentKey
      );

      if (currentKey && currentStillExists) {
        return currentKey;
      }

      return mediaItems[0].displayImageKey;
    });

    requestAnimationFrame(() => {
      updateActiveItemByScroll();
    });
  }, [mediaItems, updateActiveItemByScroll]);

  useEffect(() => {
    if (isInitialLoading || isFetchingNextPage) {
      return;
    }

    if (mediaItems.length > 0) {
      return;
    }

    if (!hasNextPage) {
      return;
    }

    fetchMediaPosts(page + 1);
  }, [
    isInitialLoading,
    isFetchingNextPage,
    mediaItems.length,
    hasNextPage,
    page,
    fetchMediaPosts,
  ]);

  const handleViewerScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    const distanceToBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight;

    if (!scrollTickingRef.current) {
      scrollTickingRef.current = true;

      requestAnimationFrame(() => {
        updateActiveItemByScroll();
        scrollTickingRef.current = false;
      });
    }

    if (
      distanceToBottom < 900 &&
      hasNextPage &&
      !isFetchingNextPage &&
      !isInitialLoading
    ) {
      fetchMediaPosts(page + 1);
    }
  };

  const formatDisplayCount = (count: number) => {
    const safeCount = Number(count) || 0;

    if (safeCount >= 10000) {
      return `${(safeCount / 10000).toFixed(1).replace(/\.0$/, "")}万`;
    }

    return safeCount.toLocaleString();
  };

  const formatDate = (dateString: string) => {
    if (!dateString) {
      return "";
    }

    return new Date(dateString).toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const openPostDetail = (postId: string) => {
    navigate(`/post/${postId}`);
  };

  const renderContentWithLinks = (text: string) => {
    if (!text) {
      return null;
    }

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);

    return parts.map((part, index) => {
      if (part.match(urlRegex)) {
        return (
          <a
            key={`link-${index}-${part}`}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-pink-500 transition-colors hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {part}
          </a>
        );
      }

      return part;
    });
  };

  const renderContentWithHashtags = (text: string) => {
    if (!text) {
      return null;
    }

    const parts = text.split(/(#[^\s#　.,!?:;'"()[\]{}<>]+)/g);

    return parts.map((part, index) => {
      if (part.startsWith("#")) {
        return (
          <button
            key={`hashtag-${index}-${part}`}
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              navigate(`/search?q=${encodeURIComponent(part)}`);
            }}
            className="inline-block align-baseline text-pink-500 transition-colors hover:underline"
          >
            {part}
          </button>
        );
      }

      return renderContentWithLinks(part);
    });
  };

  const renderContentWithMentions = (text: string) => {
    if (!text) {
      return null;
    }

    const parts = text.split(/(@[a-zA-Z0-9_]+)/g);

    return parts.map((part, index) => {
      if (part.startsWith("@")) {
        const mentionUsername = part.substring(1);

        return (
          <Link
            key={`mention-${index}-${part}`}
            to={`/u/${mentionUsername}`}
            className="text-pink-500 transition-colors hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {part}
          </Link>
        );
      }

      return renderContentWithHashtags(part);
    });
  };

  if (isInitialLoading) {
    return (
      <div className="fixed inset-x-0 top-16 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[20] flex items-center justify-center bg-black text-white md:bottom-0">
        <div className="flex items-center gap-2 text-sm text-white/70">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>読み込み中...</span>
        </div>
      </div>
    );
  }

  if (isError && mediaItems.length === 0) {
    return (
      <div className="fixed inset-x-0 top-16 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[20] flex items-center justify-center bg-background px-6 text-center md:bottom-0">
        <div>
          <UserCircle className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h1 className="text-lg font-bold">メディア投稿の取得に失敗しました</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            時間をおいてもう一度開いてください。
          </p>
        </div>
      </div>
    );
  }

  if (mediaItems.length === 0 && (hasNextPage || isFetchingNextPage)) {
    return (
      <div className="fixed inset-x-0 top-16 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[20] flex items-center justify-center bg-black text-white md:bottom-0">
        <div className="flex items-center gap-2 text-sm text-white/70">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>メディアを探しています...</span>
        </div>
      </div>
    );
  }

  if (mediaItems.length === 0) {
    return (
      <div className="fixed inset-x-0 top-16 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[20] flex items-center justify-center bg-background px-6 text-center md:bottom-0">
        <div>
          <ImageIcon className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h1 className="text-lg font-bold">メディア投稿がありません</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            画像付きの投稿がまだありません。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 top-16 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[20] bg-transparent text-white md:bottom-0 md:grid md:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
      <main
        ref={scrollRootRef}
        onScroll={handleViewerScroll}
        className="flex h-full min-w-0 snap-y snap-mandatory flex-col gap-6 overflow-y-auto overscroll-contain bg-black pb-40 scroll-py-6 md:gap-3 md:pb-0 md:scroll-py-0"
      >
        {mediaItems.map((item) => (
          <section
            key={item.displayImageKey}
            data-media-key={item.displayImageKey}
            className="relative flex h-[calc(100%-1.5rem)] min-h-[calc(100%-1.5rem)] shrink-0 snap-start items-center justify-center bg-black px-0 py-0 sm:px-3 md:h-full md:min-h-full md:px-5"
          >
            <img
              src={item.displayImageUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-contain"
            />

            {item.imageCount > 1 && (
              <div className="absolute right-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs font-bold text-white backdrop-blur-md md:right-5 md:top-5">
                {item.imageIndex + 1} / {item.imageCount}
              </div>
            )}
          </section>
        ))}

        <div className="flex h-24 shrink-0 items-center justify-center">
          {isFetchingNextPage ? (
            <div className="flex items-center gap-2 text-sm text-white/60">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>さらに読み込み中...</span>
            </div>
          ) : hasNextPage ? (
            <div className="h-10" />
          ) : (
            <p className="text-xs text-white/40">
              すべてのメディアを表示しました
            </p>
          )}
        </div>
      </main>

      <aside className="hidden h-full border-l border-border bg-background text-foreground md:block">
        {activeItem && (
          <div className="flex h-full flex-col">
            <div className="border-b border-border px-5 py-4">
              <div className="flex items-center gap-3">
                {activeItem.author.avatarUrl ? (
                  <Link
                    to={`/u/${activeItem.author.username}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <img
                      src={activeItem.author.avatarUrl}
                      alt={activeItem.author.displayName}
                      className="h-11 w-11 rounded-full object-cover"
                    />
                  </Link>
                ) : (
                  <Link
                    to={`/u/${activeItem.author.username}`}
                    onClick={(event) => event.stopPropagation()}
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-muted"
                  >
                    <UserCircle className="h-7 w-7 text-muted-foreground" />
                  </Link>
                )}

                <div className="min-w-0">
                  <Link
                    to={`/u/${activeItem.author.username}`}
                    className="block truncate font-bold leading-tight hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {activeItem.author.displayName ||
                      activeItem.author.username ||
                      "ユーザー"}
                  </Link>

                  <Link
                    to={`/u/${activeItem.author.username}`}
                    className="block truncate text-sm text-muted-foreground hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    @{activeItem.author.username || "unknown"}
                  </Link>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              {activeItem.displayContent && (
                <p className="whitespace-pre-wrap break-words text-[15px] leading-7">
                  {renderContentWithMentions(activeItem.displayContent)}
                </p>
              )}

              <div className="mt-6 text-sm text-muted-foreground">
                {formatDate(activeItem.createdAt)}
              </div>

              {activeItem.imageCount > 1 && (
                <div className="mt-3 text-sm text-muted-foreground">
                  画像 {activeItem.imageIndex + 1} / {activeItem.imageCount}
                </div>
              )}

              {activeItem.visibility === "following" && (
                <div className="mt-3 inline-flex rounded-full bg-muted px-3 py-1 text-xs font-bold text-muted-foreground">
                  限定公開
                </div>
              )}

              <div className="mt-6 flex items-center gap-5 border-y border-border py-4">
                <LikeButton
                  postId={activeItem.id}
                  liked={activeItem.likedByMe}
                  count={activeItem.likesCount}
                />

                <button
                  type="button"
                  onClick={() => openPostDetail(activeItem.id)}
                  className="inline-flex items-center gap-2 rounded-full px-2 py-1 text-sm transition-colors hover:text-primary"
                >
                  <MessageCircle className="h-5 w-5" />
                  <span className="font-bold tabular-nums">
                    {formatDisplayCount(activeItem.commentsCount)}
                  </span>
                </button>
              </div>

              <div className="mt-5">
                <button
                  type="button"
                  onClick={() => openPostDetail(activeItem.id)}
                  className="rounded-full border border-border px-5 py-2.5 text-sm font-bold transition-colors hover:bg-muted"
                >
                  投稿を開く
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>

      {activeItem && (
        <div className="fixed left-0 right-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[25] border-t border-white/10 bg-black/85 px-4 pb-3 pt-3 text-white backdrop-blur-md md:hidden">
          <div className="flex items-start gap-3">
            {activeItem.author.avatarUrl ? (
              <Link
                to={`/u/${activeItem.author.username}`}
                onClick={(event) => event.stopPropagation()}
                className="shrink-0"
              >
                <img
                  src={activeItem.author.avatarUrl}
                  alt={activeItem.author.displayName}
                  className="h-10 w-10 rounded-full object-cover"
                />
              </Link>
            ) : (
              <Link
                to={`/u/${activeItem.author.username}`}
                onClick={(event) => event.stopPropagation()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10"
              >
                <UserCircle className="h-6 w-6 text-white/70" />
              </Link>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 overflow-hidden">
                <Link
                  to={`/u/${activeItem.author.username}`}
                  className="truncate text-sm font-bold hover:underline"
                  onClick={(event) => event.stopPropagation()}
                >
                  {activeItem.author.displayName ||
                    activeItem.author.username ||
                    "ユーザー"}
                </Link>

                <span className="truncate text-xs text-white/50">
                  @{activeItem.author.username || "unknown"}
                </span>

                {activeItem.visibility === "following" && (
                  <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-white/70">
                    限定
                  </span>
                )}
              </div>

              {activeItem.displayContent && (
                <div className="mt-1 line-clamp-2 break-words text-xs leading-5 text-white/75">
                  {renderContentWithMentions(activeItem.displayContent)}
                </div>
              )}

              <div className="mt-2 flex items-center gap-4">
                <LikeButton
                  postId={activeItem.id}
                  liked={activeItem.likedByMe}
                  count={activeItem.likesCount}
                />

                <button
                  type="button"
                  onClick={() => openPostDetail(activeItem.id)}
                  className="inline-flex items-center gap-1.5 rounded-full text-xs text-white/85"
                >
                  <MessageCircle className="h-5 w-5" />
                  <span className="font-bold tabular-nums">
                    {formatDisplayCount(activeItem.commentsCount)}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => openPostDetail(activeItem.id)}
                  className="ml-auto rounded-full bg-white px-3 py-1.5 text-xs font-bold text-black"
                >
                  開く
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}