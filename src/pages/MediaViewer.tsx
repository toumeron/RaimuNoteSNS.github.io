import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type UIEvent,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  Plus,
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

type CustomEmoji = {
  id: string;
  name: string;
  public_id: string;
  format: string;
  uploaded_by: string | null;
};

type ReactionUser = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
};

type ReactionGroup = {
  emoji: string;
  count: number;
  user_ids: string[];
  users: ReactionUser[];
};

type ReplicatedRing = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type ReplicatedDot = {
  id: string;
  x: number;
  y: number;
  angle: number;
  distance: number;
  color: string;
  size: number;
  delay: number;
};

const PAGE_SIZE = 30;

const defaultEmojis = [
  "👍",
  "❤️",
  "😆",
  "🤔",
  "😮",
  "🎉",
  "💢",
  "😢",
  "😇",
  "🍮",
];

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
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [posts, setPosts] = useState<NormalizedPost[]>([]);
  const [activeItemKey, setActiveItemKey] = useState<string | null>(null);

  const [page, setPage] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(true);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);
  const [isError, setIsError] = useState(false);

  const [showPicker, setShowPicker] = useState(false);
  const [customEmojis, setCustomEmojis] = useState<CustomEmoji[]>([]);
  const [reactions, setReactions] = useState<ReactionGroup[]>([]);
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isEmojisOpen, setIsEmojisOpen] = useState(true);
  const [activePopupEmoji, setActivePopupEmoji] = useState<string | null>(null);

  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [activeRings, setActiveRings] = useState<ReplicatedRing[]>([]);
  const [activeDots, setActiveDots] = useState<ReplicatedDot[]>([]);

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
        let authorIdsWhoFollowMe = new Set<string>();

        if (user?.id) {
          const { data: followsData, error: followsError } = await supabase
            .from("follows")
            .select("follower_id")
            .eq("followee_id", user.id);

          if (followsError) {
            console.warn("MediaViewer follows fetch failed:", followsError);
          }

          authorIdsWhoFollowMe = new Set(
            (followsData ?? []).map(
              (follow: { follower_id: string }) => follow.follower_id
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
            (likesData ?? []).map((like: { post_id: string }) => like.post_id)
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
              authorIdsWhoFollowMe.has(post.userId)
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

  const fetchCustomEmojis = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("custom_emojis")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        throw error;
      }

      setCustomEmojis((data ?? []) as CustomEmoji[]);
    } catch (error) {
      console.error("MediaViewer custom emojis fetch error:", error);
    }
  }, []);

  const fetchReactions = useCallback(async (postId: string) => {
    try {
      const { data: reactionData, error: reactionError } = await supabase
        .from("post_reactions")
        .select("emoji, user_id")
        .eq("post_id", postId);

      if (reactionError) {
        throw reactionError;
      }

      if (!reactionData || reactionData.length === 0) {
        setReactions([]);
        return;
      }

      const userIds = Array.from(
        new Set(reactionData.map((reaction: any) => reaction.user_id))
      );

      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url")
        .in("id", userIds);

      if (profileError) {
        throw profileError;
      }

      const profileMap: Record<string, any> = {};

      (profileData ?? []).forEach((profile: any) => {
        profileMap[profile.id] = profile;
      });

      const groups: Record<
        string,
        {
          userIds: string[];
          users: ReactionUser[];
        }
      > = {};

      reactionData.forEach((row: any) => {
        if (!groups[row.emoji]) {
          groups[row.emoji] = {
            userIds: [],
            users: [],
          };
        }

        groups[row.emoji].userIds.push(row.user_id);

        const profile = profileMap[row.user_id];

        if (profile) {
          groups[row.emoji].users.push({
            id: profile.id,
            username: profile.username || "unknown",
            displayName:
              profile.display_name || profile.username || "ユーザー",
            avatarUrl: profile.avatar_url || "",
          });
        }
      });

      const formattedGroups: ReactionGroup[] = Object.keys(groups).map(
        (emoji) => ({
          emoji,
          count: groups[emoji].userIds.length,
          user_ids: groups[emoji].userIds,
          users: groups[emoji].users,
        })
      );

      setReactions(formattedGroups);
    } catch (error) {
      console.error("MediaViewer reactions fetch error:", error);
    }
  }, []);

  useEffect(() => {
    fetchCustomEmojis();
  }, [fetchCustomEmojis]);

  useEffect(() => {
    if (!user?.id) {
      setRecentEmojis([]);
      return;
    }

    const saved = localStorage.getItem(`recent_emojis_${user.id}`);

    if (!saved) {
      setRecentEmojis([]);
      return;
    }

    try {
      setRecentEmojis(JSON.parse(saved));
    } catch (error) {
      console.error("MediaViewer recent emoji parse error:", error);
      setRecentEmojis([]);
    }
  }, [user?.id]);

  useEffect(() => {
    const updateViewportState = () => {
      setIsMobileViewport(window.innerWidth < 640);
    };

    updateViewportState();
    window.addEventListener("resize", updateViewportState);

    return () => {
      window.removeEventListener("resize", updateViewportState);
    };
  }, []);

  useEffect(() => {
    if (showPicker) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }

    return () => {
      document.body.style.overflow = "unset";
    };
  }, [showPicker]);

  useEffect(() => {
    if (!activeItem?.id) {
      setReactions([]);
      setShowPicker(false);
      setActivePopupEmoji(null);
      return;
    }

    setShowPicker(false);
    setActivePopupEmoji(null);
    fetchReactions(activeItem.id);

    const channel = supabase
      .channel(`media-viewer-post-reactions-${activeItem.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "post_reactions",
          filter: `post_id=eq.${activeItem.id}`,
        },
        () => {
          fetchReactions(activeItem.id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeItem?.id, fetchReactions]);

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

  const getCustomEmojiObj = (emojiString: string) => {
    const cleanName =
      emojiString.startsWith(":") && emojiString.endsWith(":")
        ? emojiString.slice(1, -1)
        : emojiString;

    return (
      customEmojis.find((emoji) => emoji.name === emojiString) ??
      customEmojis.find((emoji) => emoji.name === cleanName) ??
      customEmojis.find((emoji) => emoji.name === `:${cleanName}:`) ??
      null
    );
  };

  const renderEmojiElement = (
    emojiString: string,
    className = "h-5 w-5 object-contain inline-block"
  ) => {
    const customEmoji = getCustomEmojiObj(emojiString);

    if (customEmoji) {
      const cleanPublicId = customEmoji.public_id.startsWith("custom_emojis/")
        ? customEmoji.public_id
        : `custom_emojis/${customEmoji.public_id}`;

      const imageUrl = `https://res.cloudinary.com/dveiikhhw/image/upload/${cleanPublicId}.${customEmoji.format}`;

      return (
        <img
          src={imageUrl}
          alt={customEmoji.name}
          className={className}
          loading="lazy"
        />
      );
    }

    return <span className="select-none text-lg leading-none">{emojiString}</span>;
  };

  const triggerImageReplicatedEffect = (targetElement: HTMLElement) => {
    const rect = targetElement.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    targetElement.classList.remove("misskey-elastic-active");
    void targetElement.offsetWidth;
    targetElement.classList.add("misskey-elastic-active");

    const batchId = Math.random().toString(36).substring(2, 9);

    const newRing: ReplicatedRing = {
      id: `ring-${batchId}`,
      x: centerX,
      y: centerY,
      width: rect.width + 4,
      height: rect.height + 4,
    };

    const colors = ["#d4f022", "#e6007e", "#22f0d8", "#d4f022", "#e6007e"];
    const dotCount = 16;
    const newDots: ReplicatedDot[] = [];

    for (let i = 0; i < dotCount; i += 1) {
      const angle = (i / dotCount) * 360 + (Math.random() * 20 - 10);
      const maxDistance = rect.width / 2 + (Math.random() * 16 - 4);

      newDots.push({
        id: `dot-${batchId}-${i}`,
        x: centerX,
        y: centerY,
        angle,
        distance: maxDistance,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: Math.random() * 5 + 5,
        delay: Math.random() * 40,
      });
    }

    setActiveRings((currentRings) => [...currentRings, newRing]);
    setActiveDots((currentDots) => [...currentDots, ...newDots]);

    window.setTimeout(() => {
      setActiveRings((currentRings) =>
        currentRings.filter((ring) => ring.id !== `ring-${batchId}`)
      );
      setActiveDots((currentDots) =>
        currentDots.filter((dot) => !dot.id.startsWith(`dot-${batchId}-`))
      );
    }, 550);
  };

  const handleAddReaction = async (
    emoji: string,
    event?: ReactMouseEvent<HTMLElement>
  ) => {
    event?.preventDefault();
    event?.stopPropagation();

    if (!user?.id || !activeItem?.id) {
      return;
    }

    if (event?.currentTarget) {
      triggerImageReplicatedEffect(event.currentTarget);
    }

    const updatedRecents = [
      emoji,
      ...recentEmojis.filter((recentEmoji) => recentEmoji !== emoji),
    ].slice(0, 10);

    setRecentEmojis(updatedRecents);
    localStorage.setItem(
      `recent_emojis_${user.id}`,
      JSON.stringify(updatedRecents)
    );

    try {
      const { data: existing, error: checkError } = await supabase
        .from("post_reactions")
        .select("id")
        .eq("post_id", activeItem.id)
        .eq("user_id", user.id)
        .eq("emoji", emoji)
        .maybeSingle();

      if (checkError) {
        throw checkError;
      }

      if (existing) {
        const { error } = await supabase
          .from("post_reactions")
          .delete()
          .eq("id", existing.id);

        if (error) {
          throw error;
        }
      } else {
        const { error } = await supabase.from("post_reactions").insert({
          post_id: activeItem.id,
          user_id: user.id,
          emoji,
        });

        if (error) {
          throw error;
        }
      }

      await fetchReactions(activeItem.id);
      setShowPicker(false);
    } catch (error) {
      console.error("MediaViewer toggle reaction error:", error);
    }
  };

  const handleTouchStart = (emoji: string) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }

    longPressTimerRef.current = setTimeout(() => {
      setActivePopupEmoji(emoji);
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }
  };

  const filteredCustomEmojis = customEmojis.filter((emoji) =>
    emoji.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderReactionBadges = () => {
    if (reactions.length === 0) {
      return null;
    }

    return (
      <div className="mt-4 flex flex-wrap gap-1.5">
        {reactions.map((reactionGroup) => {
          const hasMyReaction = user?.id
            ? reactionGroup.user_ids.includes(user.id)
            : false;

          const isPopupOpen = activePopupEmoji === reactionGroup.emoji;

          return (
            <div
              key={reactionGroup.emoji}
              className="relative inline-block"
              onMouseEnter={() => setActivePopupEmoji(reactionGroup.emoji)}
              onMouseLeave={() => setActivePopupEmoji(null)}
            >
              <button
                type="button"
                onClick={(event) =>
                  handleAddReaction(reactionGroup.emoji, event)
                }
                onTouchStart={() => handleTouchStart(reactionGroup.emoji)}
                onTouchEnd={handleTouchEnd}
                className={`inline-flex h-[45px] origin-center select-none items-center gap-1.5 rounded-xl border-none px-2.5 text-[15px] font-bold outline-none transition-all ${
                  hasMyReaction
                    ? "bg-sky-500/15 text-sky-500 dark:text-sky-400"
                    : "bg-black/[0.05] text-muted-foreground hover:bg-black/[0.08] hover:text-foreground dark:bg-muted/50 dark:hover:bg-muted/80"
                }`}
              >
                {renderEmojiElement(
                  reactionGroup.emoji,
                  "h-5 w-5 object-contain"
                )}
                <span className="tabular-nums text-sm font-black">
                  {formatDisplayCount(reactionGroup.count)}
                </span>
              </button>

              {isPopupOpen && reactionGroup.users.length > 0 && (
                <div className="pointer-events-none absolute bottom-full left-1/2 z-[60] mb-2 flex w-[260px] -translate-x-1/2 rounded-2xl border border-black/[0.08] bg-white p-3 shadow-2xl dark:border-white/5 dark:bg-[#252932]">
                  <div className="mr-2.5 flex h-16 w-16 shrink-0 items-center justify-center border-r border-black/[0.08] pr-2.5 dark:border-white/10">
                    {renderEmojiElement(
                      reactionGroup.emoji,
                      "h-12 w-12 object-contain"
                    )}
                  </div>

                  <div className="flex max-h-[160px] min-w-0 flex-1 flex-col gap-1.5 overflow-y-auto">
                    {reactionGroup.users.map((reactionUser) => (
                      <div
                        key={reactionUser.id}
                        className="flex min-w-0 items-center gap-2"
                      >
                        {reactionUser.avatarUrl ? (
                          <img
                            src={reactionUser.avatarUrl}
                            alt={reactionUser.displayName}
                            className="h-5 w-5 shrink-0 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted">
                            <UserCircle className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                        )}

                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="mb-0.5 truncate text-[12px] font-black leading-none text-foreground dark:text-white">
                            {reactionUser.displayName}
                          </span>
                          <span className="truncate text-[10px] leading-none text-muted-foreground/70">
                            @{reactionUser.username}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderReactionPicker = () => {
    if (!user?.id) {
      return null;
    }

    const defaultEmojiButtons = isMobileViewport ? (
      <div className="mb-3.5 grid shrink-0 grid-cols-5 gap-2.5">
        {defaultEmojis.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={(event) => handleAddReaction(emoji, event)}
            className="flex h-11 w-11 origin-center items-center justify-center rounded-2xl text-2xl transition-all hover:bg-black/[0.05] dark:hover:bg-white/10"
          >
            {emoji}
          </button>
        ))}
      </div>
    ) : (
      <div className="mb-2 grid shrink-0 grid-cols-7 gap-1">
        {defaultEmojis.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={(event) => handleAddReaction(emoji, event)}
            className="flex h-8 w-8 origin-center items-center justify-center rounded-lg text-xl transition-all hover:bg-black/[0.05] dark:hover:bg-white/10"
          >
            {emoji}
          </button>
        ))}
      </div>
    );

    const recentEmojiButtons =
      recentEmojis.length > 0 ? (
        <div className={isMobileViewport ? "mb-3.5 shrink-0" : "mb-2 shrink-0"}>
          <div
            className={
              isMobileViewport
                ? "mb-1.5 px-0.5 text-[11px] font-bold text-muted-foreground/60"
                : "mb-1 px-0.5 text-[11px] font-bold text-muted-foreground/60"
            }
          >
            最近使用
          </div>

          <div
            className={
              isMobileViewport
                ? "flex flex-wrap gap-2.5"
                : "flex flex-wrap gap-1"
            }
          >
            {recentEmojis.map((emoji) => (
              <button
                key={`recent-${emoji}`}
                type="button"
                onClick={(event) => handleAddReaction(emoji, event)}
                className={
                  isMobileViewport
                    ? "flex h-9 w-9 origin-center items-center justify-center rounded-xl transition-all hover:bg-black/[0.05] dark:hover:bg-white/10"
                    : "flex h-7 w-7 origin-center items-center justify-center rounded-md transition-all hover:bg-black/[0.05] dark:hover:bg-white/10"
                }
              >
                {renderEmojiElement(
                  emoji,
                  isMobileViewport
                    ? "h-6 w-6 object-contain"
                    : "h-[18px] w-[18px] object-contain"
                )}
              </button>
            ))}
          </div>
        </div>
      ) : null;

    const customEmojiButtons = (
      <div
        className={
          isMobileViewport
            ? "flex flex-col border-t border-black/[0.08] pt-2 dark:border-white/5"
            : "flex flex-col border-t border-black/[0.08] pt-1.5 dark:border-white/5"
        }
      >
        <button
          type="button"
          onClick={() => setIsEmojisOpen((current) => !current)}
          className="flex w-full shrink-0 items-center justify-between px-0.5 py-1 text-[11px] font-black text-muted-foreground/80 transition-colors hover:text-foreground"
        >
          <span className="truncate">カスタム絵文字</span>
          <span className="text-[10px] opacity-60">
            {isEmojisOpen ? "▲" : "▼"}
          </span>
        </button>

        {isEmojisOpen && (
          <div className={isMobileViewport ? "mt-1 block p-0.5" : "mt-1 p-0.5"}>
            {filteredCustomEmojis.length > 0 ? (
              <div
                className={
                  isMobileViewport
                    ? "grid grid-cols-4 gap-2.5"
                    : "grid grid-cols-6 gap-1"
                }
              >
                {filteredCustomEmojis.map((emoji) => {
                  const emojiValue = emoji.name.startsWith(":")
                    ? emoji.name
                    : `:${emoji.name}:`;

                  return (
                    <button
                      key={emoji.id}
                      type="button"
                      title={emojiValue}
                      onClick={(event) => handleAddReaction(emojiValue, event)}
                      className={
                        isMobileViewport
                          ? "flex h-12 w-12 origin-center items-center justify-center rounded-2xl p-1.5 transition-all hover:bg-black/[0.05] dark:hover:bg-white/10"
                          : "flex h-8 w-8 origin-center items-center justify-center rounded-lg p-0.5 transition-all hover:bg-black/[0.05] dark:hover:bg-white/10"
                      }
                    >
                      {renderEmojiElement(
                        emojiValue,
                        isMobileViewport
                          ? "h-9 w-9 object-contain"
                          : "h-6 w-6 object-contain"
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div
                className={
                  isMobileViewport
                    ? "py-6 text-center text-[11px] text-muted-foreground/50"
                    : "py-4 text-center text-[11px] text-muted-foreground/50"
                }
              >
                絵文字が見つかりません
              </div>
            )}
          </div>
        )}
      </div>
    );

    const searchBox = (
      <div className="mt-2 shrink-0 border-t border-black/[0.08] pt-1.5 dark:border-white/5">
        <input
          type="text"
          placeholder="検索"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="h-8 w-full rounded-lg border border-black/[0.08] bg-black/[0.03] px-2.5 text-xs font-medium text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-pink-500/50 dark:border-white/10 dark:bg-black/30"
        />
      </div>
    );

    return (
      <div
        className="relative inline-flex h-full items-center"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => setShowPicker((current) => !current)}
          className={`inline-flex origin-center items-center justify-center rounded-full transition-colors hover:text-primary ${
            isMobileViewport ? "h-full px-2 py-1" : "h-9 w-9"
          } ${
            showPicker
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground"
          }`}
          aria-label="リアクションを追加"
        >
          <Plus className="h-5 w-5" />
        </button>

        {showPicker && (
          <>
            <div
              className="fixed inset-0 z-[9998] bg-transparent"
              onClick={() => setShowPicker(false)}
            />

            {isMobileViewport ? (
              <div
                className="fixed bottom-[76px] left-1/2 z-[9999] h-[430px] w-[92vw] max-w-[340px] -translate-x-1/2 overflow-y-auto overflow-x-hidden rounded-[24px] border border-border/80 bg-white p-4 shadow-2xl animate-slide-up-mobile touch-pan-y dark:bg-[#1e222b]"
                onTouchStart={(event) => event.stopPropagation()}
                onScroll={(event) => event.stopPropagation()}
              >
                {defaultEmojiButtons}
                {recentEmojiButtons}
                {customEmojiButtons}
              </div>
            ) : (
              <div
                className="absolute bottom-full left-0 z-[9999] mb-2 h-[280px] w-[260px] overflow-y-auto overflow-x-hidden rounded-[20px] border border-border/80 bg-white p-2.5 shadow-2xl animate-zoom-in-pc dark:bg-[#1e222b]"
                onWheel={(event) => event.stopPropagation()}
              >
                {defaultEmojiButtons}
                {recentEmojiButtons}
                {customEmojiButtons}
                {searchBox}
              </div>
            )}
          </>
        )}
      </div>
    );
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
            className="text-pink-500 transition-colors hover:underline dark:text-pink-400"
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
            className="inline-block align-baseline text-pink-500 transition-colors hover:underline dark:text-pink-400"
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
            className="text-pink-500 transition-colors hover:underline dark:text-pink-400"
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
      <div className="fixed inset-x-0 top-16 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[20] flex items-center justify-center bg-background text-foreground md:bottom-0 dark:bg-black dark:text-white">
        <div className="flex items-center gap-2 text-sm text-muted-foreground dark:text-white/70">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>読み込み中...</span>
        </div>
      </div>
    );
  }

  if (isError && mediaItems.length === 0) {
    return (
      <div className="fixed inset-x-0 top-16 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[20] flex items-center justify-center bg-background px-6 text-center text-foreground md:bottom-0">
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
      <div className="fixed inset-x-0 top-16 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[20] flex items-center justify-center bg-background text-foreground md:bottom-0 dark:bg-black dark:text-white">
        <div className="flex items-center gap-2 text-sm text-muted-foreground dark:text-white/70">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>メディアを探しています...</span>
        </div>
      </div>
    );
  }

  if (mediaItems.length === 0) {
    return (
      <div className="fixed inset-x-0 top-16 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[20] flex items-center justify-center bg-background px-6 text-center text-foreground md:bottom-0">
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
    <>
      <style>
        {`
          @keyframes misskeyRingExpand {
            0% {
              transform: translate(-50%, -50%) scale(0.6);
              opacity: 1;
              border-width: 5px;
            }
            40% {
              opacity: 1;
              border-width: 4px;
            }
            100% {
              transform: translate(-50%, -50%) scale(1.15);
              opacity: 0;
              border-width: 1px;
            }
          }

          @keyframes misskeyDotBurst {
            0% {
              transform: translate(-50%, -50%) rotate(var(--mk-angle)) translateY(0px) scale(0.2);
              opacity: 0;
            }
            15% {
              opacity: 1;
              transform: translate(-50%, -50%) rotate(var(--mk-angle)) translateY(calc(var(--mk-dist) * 0.4)) scale(1.1);
            }
            60% {
              opacity: 1;
            }
            100% {
              transform: translate(-50%, -50%) rotate(var(--mk-angle)) translateY(var(--mk-dist)) scale(0);
              opacity: 0;
            }
          }

          @keyframes misskeyButtonElastic {
            0% {
              transform: scale(1);
            }
            20% {
              transform: scale(0.84);
            }
            50% {
              transform: scale(1.16);
            }
            75% {
              transform: scale(0.94);
            }
            100% {
              transform: scale(1);
            }
          }

          .misskey-elastic-active {
            animation: misskeyButtonElastic 420ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards !important;
          }

          @keyframes slideUpMobile {
            0% {
              transform: translate(-50%, 24px);
              opacity: 0;
            }
            100% {
              transform: translate(-50%, 0);
              opacity: 1;
            }
          }

          .animate-slide-up-mobile {
            animation: slideUpMobile 240ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
          }

          @keyframes zoomInPc {
            0% {
              transform: scale(0.9) translateY(8px);
              opacity: 0;
            }
            100% {
              transform: scale(1) translateY(0);
              opacity: 1;
            }
          }

          .animate-zoom-in-pc {
            animation: zoomInPc 160ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
          }
        `}
      </style>

      {(activeRings.length > 0 || activeDots.length > 0) && (
        <div className="pointer-events-none fixed inset-0 z-[9999] overflow-hidden">
          {activeRings.map((ring) => (
            <div
              key={ring.id}
              style={{
                position: "fixed",
                left: ring.x,
                top: ring.y,
                width: `${ring.width}px`,
                height: `${ring.height}px`,
                borderRadius: "9999px",
                border: "4px solid #d4f022",
                backgroundColor: "transparent",
                transformOrigin: "center center",
                animation:
                  "misskeyRingExpand 460ms cubic-bezier(0.1, 0.8, 0.3, 1) forwards",
              }}
            />
          ))}

          {activeDots.map((dot) => (
            <div
              key={dot.id}
              style={{
                position: "fixed",
                left: dot.x,
                top: dot.y,
                width: `${dot.size}px`,
                height: `${dot.size}px`,
                backgroundColor: dot.color,
                borderRadius: "50%",
                transformOrigin: "center center",
                ["--mk-angle" as any]: `${dot.angle}deg`,
                ["--mk-dist" as any]: `${dot.distance}px`,
                animation:
                  "misskeyDotBurst 480ms cubic-bezier(0.12, 0.85, 0.3, 1) forwards",
                animationDelay: `${dot.delay}ms`,
              }}
            />
          ))}
        </div>
      )}

      <div className="fixed inset-x-0 top-16 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[20] bg-transparent text-foreground md:bottom-0 md:grid md:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px] dark:text-white">
      <main
        ref={scrollRootRef}
        onScroll={handleViewerScroll}
        className="flex h-full min-w-0 snap-y snap-mandatory flex-col gap-6 overflow-y-auto overscroll-contain bg-muted/40 pb-40 scroll-py-6 md:gap-3 md:pb-0 md:scroll-py-0 dark:bg-black"
      >
        {mediaItems.map((item) => (
          <section
            key={item.displayImageKey}
            data-media-key={item.displayImageKey}
            className="relative flex h-[calc(100%-1.5rem)] min-h-[calc(100%-1.5rem)] shrink-0 snap-start items-center justify-center bg-muted/40 px-0 py-0 sm:px-3 md:h-full md:min-h-full md:px-5 dark:bg-black"
          >
            <img
              src={item.displayImageUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-contain"
            />

            {item.imageCount > 1 && (
              <div className="absolute right-3 top-3 rounded-full border border-border/60 bg-background/85 px-3 py-1 text-xs font-bold text-foreground shadow-sm backdrop-blur-md md:right-5 md:top-5 dark:border-white/10 dark:bg-black/60 dark:text-white">
                {item.imageIndex + 1} / {item.imageCount}
              </div>
            )}
          </section>
        ))}

        <div className="flex h-24 shrink-0 items-center justify-center">
          {isFetchingNextPage ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground dark:text-white/60">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>さらに読み込み中...</span>
            </div>
          ) : hasNextPage ? (
            <div className="h-10" />
          ) : (
            <p className="text-xs text-muted-foreground dark:text-white/40">
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
                    className="flex min-w-0 items-center gap-1 font-bold leading-tight hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <span className="truncate">
                      {activeItem.author.displayName ||
                        activeItem.author.username ||
                        "ユーザー"}
                    </span>

                    {activeItem.author.isOfficial && (
                      <img
                        src={`${import.meta.env.BASE_URL}verified.png`}
                        alt="Official"
                        className="h-4 w-4 shrink-0 translate-y-[0.5px]"
                        loading="eager"
                      />
                    )}
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

              {renderReactionBadges()}

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

                {renderReactionPicker()}
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
        <div className="fixed left-0 right-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[25] border-t border-border/60 bg-background/95 px-4 pb-3 pt-3 text-foreground backdrop-blur-md md:hidden dark:border-white/10 dark:bg-black/85 dark:text-white">
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
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted dark:bg-white/10"
              >
                <UserCircle className="h-6 w-6 text-muted-foreground dark:text-white/70" />
              </Link>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 overflow-hidden">
                <Link
                  to={`/u/${activeItem.author.username}`}
                  className="flex min-w-0 items-center gap-1 text-sm font-bold hover:underline"
                  onClick={(event) => event.stopPropagation()}
                >
                  <span className="truncate">
                    {activeItem.author.displayName ||
                      activeItem.author.username ||
                      "ユーザー"}
                  </span>

                  {activeItem.author.isOfficial && (
                    <img
                      src={`${import.meta.env.BASE_URL}verified.png`}
                      alt="Official"
                      className="h-3.5 w-3.5 shrink-0 translate-y-[0.5px]"
                      loading="eager"
                    />
                  )}
                </Link>

                <span className="truncate text-xs text-muted-foreground dark:text-white/50">
                  @{activeItem.author.username || "unknown"}
                </span>

                {activeItem.visibility === "following" && (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground dark:bg-white/10 dark:text-white/70">
                    限定
                  </span>
                )}
              </div>

              {activeItem.displayContent && (
                <div className="mt-1 line-clamp-2 break-words text-xs leading-5 text-muted-foreground dark:text-white/75">
                  {renderContentWithMentions(activeItem.displayContent)}
                </div>
              )}

              {renderReactionBadges()}

              <div className="mt-2 flex items-center gap-4">
                <LikeButton
                  postId={activeItem.id}
                  liked={activeItem.likedByMe}
                  count={activeItem.likesCount}
                />

                <button
                  type="button"
                  onClick={() => openPostDetail(activeItem.id)}
                  className="inline-flex items-center gap-1.5 rounded-full text-xs text-muted-foreground dark:text-white/85"
                >
                  <MessageCircle className="h-5 w-5" />
                  <span className="font-bold tabular-nums">
                    {formatDisplayCount(activeItem.commentsCount)}
                  </span>
                </button>

                {renderReactionPicker()}

                <button
                  type="button"
                  onClick={() => openPostDetail(activeItem.id)}
                  className="ml-auto rounded-full bg-foreground px-3 py-1.5 text-xs font-bold text-background dark:bg-white dark:text-black"
                >
                  開く
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </>
  );
}