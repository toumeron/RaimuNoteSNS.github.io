import { initialImageFrame, initialMediaSize, openMediaViewer } from "@/lib/mediaThumbnail";
import { ContentLink, HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/button";
import { useMinuteTick, useViewportWidth } from "@/hooks/useViewportWidth";
import { twitterReplyText, canShowPostLinkPreview, hasAttachedPostVideo, commentThreadUrl, getAuthorReplyConversations, displayUsername, splitMentionText, mentionProfileHandle, hasStickers, formatDate, formatRelative, getYouTubeId } from "@/lib/utils";
import { PostSourceLabel, ExternalPostDetails, LinkPreviewCard, useLinkPreview, PostImages, OfflineBookmarkContext, renderStickerText } from "@/components/feed/QuotedPost";
import { PrivateMediaImage, ProviderVerificationBadge, PrivateAccountBadge, Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { twitterReplyUrl } from "@/lib/fxTwitter";
import { PostVideoPlayer } from "@/components/video/PostVideoPlayer";
import { mobilePostMenuOS, ExternalLikeButton, RepostButton, BookmarkButton, Commentlikebutton } from "@/components/feed/RepostButton";
import { useState, useContext, useEffect, useRef, useMemo, useLayoutEffect, type ReactNode, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { MoreHorizontal, Download, Link as LinkIcon, ChartBarBig, Trash2, CalendarDays, X, Plus, MessageCircle, Send, Upload } from "lucide-react";
import { PostCardSkeleton, RepostIcon } from "@/components/feed/PostPoll";
import { type PostWithAuthor, type CommentWithAuthor } from "@/types/index";
import { replyToPost } from "@/api/external-posts";
import { FollowButton } from "@/components/profile/ProfileHeader";
import { useFollowStats, useComments } from "@/hooks/useFeed";
import { getCurrentUserId } from "@/lib/currentUser";
import { supabase, sendLimeDrop } from "@/lib/supabase";
import { YouTubeEmbed, SpotifyEmbed, PostCard } from "@/components/feed/PostCard";
import dayjs from "dayjs";
import { useAuth } from "@/hooks/useAuth";
import { type BlueskyMappedPost } from "@/lib/bluesky";

// CommentList
// ReplyShare
interface SharedReply { id: string; postId: string; content: string; author: { id: string; username: string; displayName: string } }
interface LimeDropTarget { id: string; username: string; displayName: string; avatarUrl: string }

// Keep the PostCard sharing choices and recipient rules for a reply's own URL.
function ReplyShare({ comment, currentUserId, externalPost, className = '' }: { comment: SharedReply; currentUserId: string | null; className?: string; externalPost?: PostWithAuthor }) {
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [shareMenuPosition, setShareMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [showLimeDropPanel, setShowLimeDropPanel] = useState(false);
  const [limeDropTargets, setLimeDropTargets] = useState<LimeDropTarget[]>([]);
  const [limeDropLoading, setLimeDropLoading] = useState(false);
  const [limeDropSendingUserId, setLimeDropSendingUserId] = useState<string | null>(null);
  const [limeDropFeedback, setLimeDropFeedback] = useState<string | null>(null);
  const shareMenuRef = useRef<HTMLDivElement>(null);
  const limeDropPanelRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!showShareMenu || !shareMenuRef.current) return;
    const height = shareMenuRef.current.getBoundingClientRect().height;
    setShareMenuPosition(position => position && { ...position, top: Math.max(8, Math.min(position.top, window.innerHeight - height - 8)) });
  }, [showShareMenu]);
  const getPostShareUrl = () => new URL((externalPost ? `/post/${encodeURIComponent(externalPost.id)}` : commentThreadUrl(comment.postId, comment.id)).slice(1), new URL(import.meta.env.BASE_URL, window.location.origin)).href;
  const getPostShareText = () => {
    const raw = comment.content.replace(/\s+/g, ' ').trim();
    return raw ? `${comment.author.displayName}さんの返信: ${raw.length > 120 ? `${raw.slice(0, 120)}...` : raw}` : `${comment.author.displayName}さんの返信`;
  };
  useEffect(() => {
    if (!showShareMenu && !showLimeDropPanel) return;
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') { setShowShareMenu(false); setShowLimeDropPanel(false); } };
    const reposition = () => setShowShareMenu(false);
    window.addEventListener('keydown', dismiss);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => { window.removeEventListener('keydown', dismiss); window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true); };
  }, [showShareMenu, showLimeDropPanel]);
  const copyTextToClipboard = async (text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      document.execCommand('copy');
    } finally {
      document.body.removeChild(textarea);
    }
  };

  const closeShareMenu = () => {
    setShowShareMenu(false);
    setShareMenuPosition(null);
  };

  const handleShareButtonClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (showShareMenu) {
      closeShareMenu();
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    setShareMenuPosition({
      top: rect.bottom + 4,
      right: Math.max(8, window.innerWidth - rect.right),
    });
    setShowShareMenu(true);
  };

  const handleCopyPostLink = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      await copyTextToClipboard(getPostShareUrl());
      setShareFeedback('リンクをコピーしました');
      window.setTimeout(() => {
        setShareFeedback(null);
      }, 1400);
      closeShareMenu();
    } catch (err) {
      console.error('Copy post link failed:', err);
      setShareFeedback('コピーに失敗しました');
      window.setTimeout(() => {
        setShareFeedback(null);
      }, 1400);
    }
  };

  const handleNativePostShare = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const url = getPostShareUrl();
    const title = `${comment.author.displayName}さんの返信`;
    const text = getPostShareText();

    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title, text, url });
        closeShareMenu();
        return;
      }

      await copyTextToClipboard(url);
      setShareFeedback('共有非対応のためリンクをコピーしました');
      window.setTimeout(() => {
        setShareFeedback(null);
      }, 1800);
      closeShareMenu();
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') {
        closeShareMenu();
        return;
      }

      console.error('Native post share failed:', err);
      setShareFeedback('共有に失敗しました');
      window.setTimeout(() => {
        setShareFeedback(null);
      }, 1400);
    }
  };

  const fetchLimeDropTargets = async () => {
    if (!currentUserId) {
      setLimeDropTargets([]);
      setLimeDropFeedback('ログイン状態を確認できません');
      return;
    }

    setLimeDropLoading(true);
    setLimeDropFeedback(null);

    try {
      const { data: currentProfile, error: currentProfileError } = await supabase
        .from('profiles')
        .select('is_official')
        .eq('id', currentUserId)
        .maybeSingle();

      if (currentProfileError) throw currentProfileError;

      if (currentProfile?.is_official === true) {
        const { data: allProfileRows, error: allProfileError } = await supabase
          .from('profiles')
          .select('id, username, display_name, avatar_url')
          .neq('id', currentUserId)
          .order('display_name', { ascending: true });

        if (allProfileError) throw allProfileError;

        const targets: LimeDropTarget[] = (allProfileRows || []).map((profile: { id: string; username: string | null; display_name: string | null; avatar_url: string | null }) => ({
          id: profile.id,
          username: profile.username || 'unknown',
          displayName: profile.display_name || profile.username || 'ユーザー',
          avatarUrl: profile.avatar_url || '',
        }));

        setLimeDropTargets(targets);
        return;
      }

      const { data: followingRows, error: followingError } = await supabase
        .from('follows')
        .select('followee_id')
        .eq('follower_id', currentUserId)
        .eq('approved', true);

      if (followingError) throw followingError;

      const followingIds = Array.from(
        new Set(
          (followingRows || [])
            .map((row: { followee_id: string }) => row.followee_id)
            .filter(Boolean)
        )
      );

      const { data: followerRows, error: followerError } = followingIds.length > 0
        ? await supabase
            .from('follows')
            .select('follower_id')
            .eq('followee_id', currentUserId)
            .in('follower_id', followingIds)
            .eq('approved', true)
        : { data: [], error: null };

      if (followerError) throw followerError;

      const mutualIds = Array.from(
        new Set(
          (followerRows || [])
            .map((row: { follower_id: string }) => row.follower_id)
            .filter(Boolean)
        )
      );

      const { data: mutualProfileRows, error: mutualProfileError } = mutualIds.length > 0
        ? await supabase
            .from('profiles')
            .select('id, username, display_name, avatar_url')
            .in('id', mutualIds)
        : { data: [], error: null };

      if (mutualProfileError) throw mutualProfileError;

      const targetMap = new Map<string, LimeDropTarget>();
      (mutualProfileRows || []).forEach((profile: { id: string; username: string | null; display_name: string | null; avatar_url: string | null }) => {
        targetMap.set(profile.id, {
          id: profile.id,
          username: profile.username || 'unknown',
          displayName: profile.display_name || profile.username || 'ユーザー',
          avatarUrl: profile.avatar_url || '',
        });
      });

      const targets = Array.from(targetMap.values()).sort((a, b) => (
        a.displayName.localeCompare(b.displayName, 'ja')
      ));

      setLimeDropTargets(targets);
    } catch (err) {
      console.error('Fetch LimeDrop targets failed:', err);
      setLimeDropTargets([]);
      setLimeDropFeedback('送信先の取得に失敗しました');
    } finally {
      setLimeDropLoading(false);
    }
  };

  const handleOpenLimeDropPanel = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    closeShareMenu();
    setLimeDropFeedback(null);
    setShowLimeDropPanel(true);
    await fetchLimeDropTargets();
  };

  const handleCloseLimeDropPanel = () => {
    setShowLimeDropPanel(false);
    setLimeDropSendingUserId(null);
  };

  const handleSendLimeDrop = async (target: LimeDropTarget) => {
    if (!currentUserId) {
      setLimeDropFeedback('ログイン状態を確認できません');
      return;
    }

    setLimeDropSendingUserId(target.id);
    setLimeDropFeedback(null);

    try {
      const url = getPostShareUrl();
      const text = getPostShareText();

      await sendLimeDrop({
          sender_id: currentUserId,
          recipient_id: target.id,
          post_id: null,
          post_url: url,
          post_author_id: comment.author.id,
          post_author_username: comment.author.username,
          post_author_display_name: comment.author.displayName,
          post_text: text,
          status: 'pending',
        }, supabase);

      setLimeDropFeedback(`${target.displayName}さんに送信しました`);
      window.setTimeout(() => {
        handleCloseLimeDropPanel();
        setLimeDropFeedback(null);
      }, 900);
    } catch (err) {
      const supabaseError = err as { message?: string; details?: string | null; hint?: string | null; code?: string } | null;
      console.error('Send LimeDrop failed:', {
        message: supabaseError?.message,
        details: supabaseError?.details,
        hint: supabaseError?.hint,
        code: supabaseError?.code,
        raw: err,
      });
      setLimeDropFeedback('LimeDropの送信に失敗しました');
    } finally {
      setLimeDropSendingUserId(null);
    }
  };

  return <>
    <div className="ml-auto inline-flex shrink-0 items-center"><BookmarkButton post={externalPost ?? {id:`reply:${comment.id}`}} className={className} /><button type="button" onClick={handleShareButtonClick} aria-label="返信を共有" className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-accent ${className}`}><Upload className="h-5 w-5" /></button></div>
                {showShareMenu && typeof document !== 'undefined' && createPortal(
                  <>
                    <div
                      className="lime-post-action-sheet-backdrop-mobile fixed inset-0 bg-transparent"
                      style={{ zIndex: 2147483646 }}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        closeShareMenu();
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                    />
                    <div
                      ref={shareMenuRef}
                      className="lime-post-share-menu fixed w-[min(calc(100vw-16px),16rem)] rounded-xl border border-border bg-card p-1 shadow-lg overflow-hidden animate-in fade-in zoom-in duration-100"
                      style={{
                        top: shareMenuPosition?.top ?? 0,
                        right: shareMenuPosition?.right ?? 8,
                        zIndex: 2147483647,
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={handleOpenLimeDropPanel}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground hover:bg-muted transition-colors"
                      >
                        <Send className="h-4 w-4 shrink-0" />
                        <span>LimeDropで送信</span>
                      </button>

                      <button
                        onClick={handleCopyPostLink}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground hover:bg-muted transition-colors"
                      >
                        <LinkIcon className="h-4 w-4 shrink-0" />
                        <span>{shareFeedback ?? 'リンクをコピー'}</span>
                      </button>

                      <button
                        onClick={handleNativePostShare}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground hover:bg-muted transition-colors"
                      >
                        <Upload className="h-4 w-4 shrink-0" />
                        <span>その他の方法でポストを送信</span>
                      </button>
                    </div>
                  </>,
                  document.body
                )}
      {showLimeDropPanel && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          style={{ zIndex: 2147483647 }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) {
              handleCloseLimeDropPanel();
            }
          }}
        >
          <div
            ref={limeDropPanelRef}
            className="w-full max-w-[520px] overflow-hidden rounded-t-[28px] border border-border bg-card shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200 sm:rounded-[28px]"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-border/70 px-5 py-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Send className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-muted-foreground">LimeDrop</p>
                <h2 className="truncate text-lg font-black text-foreground">ポストを共有</h2>
              </div>
              <button
                type="button"
                onClick={handleCloseLimeDropPanel}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-muted/80"
                aria-label="LimeDropを閉じる"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-5 py-4">
              <div className="mb-4 rounded-2xl border border-border/70 bg-muted/35 px-4 py-3">
                <p className="line-clamp-2 text-sm font-medium leading-relaxed text-foreground">
                  {getPostShareText()}
                </p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {getPostShareUrl()}
                </p>
              </div>

              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-black text-foreground">人</h3>
                {limeDropLoading && (
                  <span className="text-xs font-bold text-muted-foreground">読み込み中...</span>
                )}
              </div>

              {limeDropFeedback && (
                <div className="mb-3 rounded-xl bg-primary/10 px-3 py-2 text-sm font-bold text-primary">
                  {limeDropFeedback}
                </div>
              )}

              {!limeDropLoading && limeDropTargets.length === 0 && (
                <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center">
                  <p className="text-sm font-bold text-foreground">送信できる相互フォロー中のユーザーがいません</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    LimeDropは相互フォロー中のユーザーにだけ送信できます。
                  </p>
                </div>
              )}

              {limeDropTargets.length > 0 && (
                <div className="grid max-h-[320px] grid-cols-3 gap-3 overflow-y-auto pb-1 sm:grid-cols-4">
                  {limeDropTargets.map((target) => {
                    const isSending = limeDropSendingUserId === target.id;

                    return (
                      <button
                        key={target.id}
                        type="button"
                        disabled={Boolean(limeDropSendingUserId)}
                        onClick={() => handleSendLimeDrop(target)}
                        className="flex min-w-0 flex-col items-center rounded-2xl px-2 py-3 text-center transition-colors hover:bg-muted disabled:cursor-wait disabled:opacity-70"
                      >
                        <Avatar className="h-14 w-14 border border-border">
                          <AvatarImage src={target.avatarUrl} alt={target.displayName} />
                          <AvatarFallback>{target.displayName.slice(0, 1)}</AvatarFallback>
                        </Avatar>
                        <span className="mt-2 w-full truncate text-xs font-black text-foreground">
                          {isSending ? '送信中...' : target.displayName}
                        </span>
                        <span className="mt-0.5 w-full truncate text-[11px] text-muted-foreground">
                          @{displayUsername(target.username)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

  </>;
}

// ReplyChain
type Segment = { x: number; top: number; bottom: number; dashed?: boolean };

function ReplyChain({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    let active = true;
    const measure = () => {
      if (!active) return;
      const origin = host.getBoundingClientRect();
      const belongs=(element:Element)=>element.closest('[data-lime-reply-chain]')===host&&!element.closest('[data-lime-embedded]');
      const avatars = [...host.querySelectorAll<HTMLElement>('[data-lime-thread-avatar]')].filter(belongs).map(el => ({
        rect: el.getBoundingClientRect(),
        owner: el.closest<HTMLElement>('[data-lime-conversation-comment]'),
      }));
      const next: Segment[] = [];
      const add = (avatar: DOMRect, top: number, bottom: number, dashed = false) => {
        if (bottom > top) next.push({ x: avatar.left + avatar.width / 2 - origin.left, top: top - origin.top, bottom: bottom - origin.top, dashed });
      };
      avatars.forEach(({ rect, owner }, index) => {
        // Only a real child continues this line. Consecutive siblings must not
        // appear to be replies to each other, even when flattened for display.
        const following = avatars[index + 1];
        const connected = following && (!owner || following.owner?.dataset.limeConversationParent === owner.dataset.limeConversationComment);
        if (connected) add(rect, rect.bottom + 8, following.rect.top - 8);
      });
      host.querySelectorAll<HTMLElement>('[data-lime-thread-more]').forEach(more => {
        if(!belongs(more))return;
        const parentId = more.dataset.limeThreadMore;
        const parent = avatars.some(avatar => avatar.owner)
          ? avatars.find(avatar => avatar.owner?.dataset.limeConversationComment === parentId)
          : avatars.at(-1);
        if (!parent) return;
        const button = more.getBoundingClientRect();
        const preceding = avatars.filter(avatar => avatar.rect.top < button.top).at(-1);
        // A footer for siblings is not a continuation of the preceding leaf.
        if (preceding === parent && !avatars.some(avatar => avatar.rect.top > button.top && avatar.owner?.dataset.limeConversationParent === parentId)) {
          add(parent.rect, parent.rect.bottom + 8, button.top - 8);
        }
        add(parent.rect, button.top + 8, button.bottom - 8, true);
      });
      setSegments(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const resize = new ResizeObserver(measure);
    resize.observe(host);
    host.querySelectorAll('[data-lime-thread-item]').forEach(el => resize.observe(el));
    const changes = new MutationObserver(measure);
    changes.observe(host, { childList: true, subtree: true, characterData: true });
    host.addEventListener('load', measure, true);
    window.addEventListener('resize', measure);
    document.fonts?.ready.then(measure);
    measure();
    return () => {
      active = false;
      resize.disconnect(); changes.disconnect();
      host.removeEventListener('load', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, []);
  return (
    <div ref={ref} data-lime-reply-chain className="relative">
      <style>{`
        [data-lime-reply-chain] [data-lime-thread-item]:not([data-lime-embedded]) {
          padding: 12px 0 !important;
          margin: 0 !important;
          border: 0 !important;
          border-radius: 0 !important;
          box-shadow: none !important;
          background: transparent !important;
          max-width: none !important;
        }
      `}</style>
      {children}
      <svg aria-hidden="true" data-lime-thread-lines className="pointer-events-none absolute inset-0 z-[1] h-full w-full" style={{ overflow: 'visible' }}>
        {segments.map((segment, i) => <line key={i} x1={segment.x} x2={segment.x} y1={segment.top} y2={segment.bottom} stroke="hsl(var(--border))" strokeWidth="2" strokeDasharray={segment.dashed ? '2 6' : undefined} strokeLinecap="round" />)}
      </svg>
    </div>
  );
}

// CommentList
// ─── 型 ───────────────────────────────────────────────────────────────────────
interface CommentAuthor {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  isOfficial?: boolean;
  isPrivate?: boolean;
  bio?: string;
  createdAt: string;
}

interface Comment {
  clientName?: string;
  id: string;
  postId: string;
  userId: string;
  content: string;
  createdAt: string;
  likesCount: number;
  likedByMe: boolean;
  imageUrls?: string[];
  parentCommentId?: string | null;
  commentsCount?: number;
  author: CommentAuthor;
}

interface CustomEmoji {
  id: string;
  name: string;
  public_id: string;
  format: string;
  uploaded_by: string;
}

interface ReactionUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
}

interface ReactionGroup {
  emoji: string;
  count: number;
  user_ids: string[];
  users: ReactionUser[];
}

interface ReplicatedRing {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ReplicatedDot {
  id: string;
  x: number;
  y: number;
  angle: number;
  distance: number;
  color: string;
  size: number;
  delay: number;
}

// ─── ユーティリティ ─────────────────────────────────────
const formatDisplayCount = (count: number) => {
  const safeCount = Number(count) || 0;
  if (safeCount >= 10000) {
    return (safeCount / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  }
  return safeCount.toLocaleString();
};

const imageRegex = /https?:\/\/[^\s]+?\.(?:png|jpg|jpeg|gif|webp|svg)(?:\?[^\s]*)?|https?:\/\/pbs\.twimg\.com\/media\/[^\s?]+(?:\?[^\s]*)?/gi;

const spotifyRegex = /https:\/\/open\.spotify\.com\/(?:[\w-]+\/)?(track|album|playlist)\/[a-zA-Z0-9._?=&/%-]+/gi;

const getChannelSuffix = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2);
};

// ─── CommentCard ──────────────────────────────────────────────────────────────
function CommentCard({
  comment,
  currentUserId,
  mobileFlat,
  thread = false,
  detail = false,
  embedded = false,
  repostedByLabel,
  replyToUsername,
  flat = false,
  mediaPresentation,
  onMediaReply,
  onMediaLikeChange,
  mediaDownload,
  externalPost,
}: {
  comment: Comment;
  currentUserId: string | null;
  mobileFlat: boolean;
  thread?: boolean;
  detail?: boolean;
  embedded?: boolean;
  repostedByLabel?: string;
  replyToUsername?: string;
  flat?: boolean;
  mediaPresentation?: 'actions' | 'menu';
  onMediaReply?:()=>void;
  onMediaLikeChange?:(state:{liked:boolean;count:number})=>void;
  mediaDownload?:()=>void;
  externalPost?: PostWithAuthor;
}) {
  const navigate = useNavigate();
  const replyUrl = externalPost ? `/post/${encodeURIComponent(externalPost.id)}` : commentThreadUrl(comment.postId, comment.id);
  const mediaPost = externalPost ?? replyToPost({...comment, replyToUsername});

  const [showMenu, setShowMenu] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const imageGeometry=useRef<{url:string;size:{width:number;height:number}}>();
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  useMinuteTick();

  // カスタム絵文字・リアクション用
  const [showPicker, setShowPicker] = useState(false);
  const offlineBookmark=useContext(OfflineBookmarkContext);
  const [customEmojis, setCustomEmojis] = useState<CustomEmoji[]>([]);
  const [reactions, setReactions] = useState<ReactionGroup[]>([]);
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isEmojisOpen, setIsEmojisOpen] = useState(true);
  const [activePopupEmoji, setActivePopupEmoji] = useState<string | null>(null);

  // エフェクト用
  const [activeRings, setActiveRings] = useState<ReplicatedRing[]>([]);
  const [activeDots, setActiveDots] = useState<ReplicatedDot[]>([]);

  // スマホ判定
  const isMobile=useViewportWidth(640);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isMyComment = currentUserId === comment.userId;

  const defaultEmojis = ['👍', '❤️', '😆', '🤔', '😮', '🎉', '💢', '😢', '😇', '🍮'];

  useEffect(() => {
    if (currentUserId) {
      const saved = localStorage.getItem(`recent_emojis_${currentUserId}`);
      if (saved) {
        try {
          setRecentEmojis(JSON.parse(saved));
        } catch (e) {
          console.error(e);
        }
      }
    }
  }, [currentUserId]);

  useEffect(() => {
    if (!externalPost) { fetchReactions(); fetchCustomEmojis(); }

    const channel = externalPost ? null : supabase
      .channel(`comment-reactions-${comment.id}-${getChannelSuffix()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'comment_reactions',
          filter: `comment_id=eq.${comment.id}`,
        },
        () => {
          fetchReactions();
        }
      )
      .subscribe();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [comment.id, !!externalPost]);

  useEffect(() => {
    if (!showPicker) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [showPicker]);

  const fetchReactions = async () => {
    try {
      const { data: reactionData, error: reactionError } = await supabase
        .from('comment_reactions')
        .select('emoji, user_id')
        .eq('comment_id', comment.id);

      if (reactionError) throw reactionError;

      if (reactionData && reactionData.length > 0) {
        const userIds = Array.from(new Set(reactionData.map((r: any) => r.user_id)));

        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('id, username, display_name, avatar_url')
          .in('id', userIds);

        if (profileError) throw profileError;

        const profileMap: { [key: string]: any } = {};

        if (profileData) {
          profileData.forEach((p: any) => {
            profileMap[p.id] = p;
          });
        }

        const groups: { [key: string]: { userIds: string[]; users: ReactionUser[] } } = {};

        reactionData.forEach((row: any) => {
          if (!groups[row.emoji]) {
            groups[row.emoji] = { userIds: [], users: [] };
          }

          groups[row.emoji].userIds.push(row.user_id);

          const profile = profileMap[row.user_id];

          if (profile) {
            groups[row.emoji].users.push({
              id: profile.id,
              username: profile.username || 'unknown',
              displayName: profile.display_name || profile.username || 'ユーザー',
              avatarUrl: profile.avatar_url || '',
            });
          }
        });

        const formattedGroups: ReactionGroup[] = Object.keys(groups).map((emoji) => ({
          emoji,
          count: groups[emoji].userIds.length,
          user_ids: groups[emoji].userIds,
          users: groups[emoji].users,
        }));

        setReactions(formattedGroups);
      } else {
        setReactions([]);
      }
    } catch (err) {
      console.error('Fetch Comment Reactions Error:', err);
    }
  };

  const fetchCustomEmojis = async () => {
    if(offlineBookmark){setCustomEmojis(offlineBookmark.emojis.map(emoji=>({...emoji,uploaded_by:''})));return;}
    try {
      const { data, error } = await supabase
        .from('custom_emojis')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (data) {
        setCustomEmojis(data);
      }
    } catch (err) {
      console.error('Fetch Emojis Error:', err);
    }
  };

  const triggerImageReplicatedEffect = (targetElement: HTMLElement) => {
    const rect = targetElement.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    targetElement.classList.remove('misskey-elastic-active');
    void targetElement.offsetWidth;
    targetElement.classList.add('misskey-elastic-active');

    const batchId = Math.random().toString(36).substring(2, 9);

    const newRing: ReplicatedRing = {
      id: `ring-${batchId}`,
      x: centerX,
      y: centerY,
      width: rect.width + 4,
      height: rect.height + 4,
    };

    const colors = ['#d4f022', '#e6007e', '#22f0d8', '#d4f022', '#e6007e'];
    const dotCount = 16;
    const newDots: ReplicatedDot[] = [];

    for (let i = 0; i < dotCount; i++) {
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

    setActiveRings((prev) => [...prev, newRing]);
    setActiveDots((prev) => [...prev, ...newDots]);

    setTimeout(() => {
      setActiveRings((prev) => prev.filter((r) => r.id !== `ring-${batchId}`));
      setActiveDots((prev) => prev.filter((d) => !d.id.startsWith(`dot-${batchId}-`)));
    }, 550);
  };

  const handleAddReaction = async (emoji: string, event?: React.MouseEvent) => {
    if (!currentUserId) return;

    if (event && event.currentTarget) {
      triggerImageReplicatedEffect(event.currentTarget as HTMLElement);
    }

    const updatedRecents = [emoji, ...recentEmojis.filter((e) => e !== emoji)].slice(0, 10);
    setRecentEmojis(updatedRecents);
    localStorage.setItem(`recent_emojis_${currentUserId}`, JSON.stringify(updatedRecents));

    try {
      const { data: existing, error: checkError } = await supabase
        .from('comment_reactions')
        .select('id')
        .eq('comment_id', comment.id)
        .eq('user_id', currentUserId)
        .eq('emoji', emoji)
        .maybeSingle();

      if (checkError) throw checkError;

      if (existing) {
        const { error } = await supabase
          .from('comment_reactions')
          .delete()
          .eq('id', existing.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('comment_reactions')
          .insert({
            comment_id: comment.id,
            user_id: currentUserId,
            emoji,
          });

        if (error) throw error;
      }

      fetchReactions();
      setShowPicker(false);
    } catch (err) {
      console.error('Toggle Comment Reaction Error:', err);
    }
  };

  const normalizeEmojiName = (name: string) => {
    return String(name || '')
      .trim()
      .replace(/^:+/, '')
      .replace(/:+$/, '');
  };

  const toEmojiToken = (name: string) => {
    const cleanName = normalizeEmojiName(name);
    return `::${cleanName}::`;
  };

  const getCustomEmojiObj = (emojiStr: string) => {
    const cleanName = normalizeEmojiName(emojiStr);

    if (!cleanName) {
      return null;
    }

    return customEmojis.find((emoji) => {
      const storedName = normalizeEmojiName(emoji.name);
      return storedName === cleanName;
    }) ?? null;
  };

  const renderEmojiElement = (emojiStr: string, className = 'h-5 w-5 object-contain inline-block') => {
    const customEmoji = getCustomEmojiObj(emojiStr);

    if (customEmoji) {
      const cleanPublicId = customEmoji.public_id.startsWith('custom_emojis/')
        ? customEmoji.public_id
        : `custom_emojis/${customEmoji.public_id}`;

      const imageUrl = `https://res.cloudinary.com/dveiikhhw/image/upload/${cleanPublicId}.${customEmoji.format}`;

      return (
        <PrivateMediaImage
          src={imageUrl}
          alt={customEmoji.name}
          className={className}
          loading="lazy"
          onError={() => {
            console.error('Failed to load custom emoji image:', {
              emojiStr,
              customEmoji,
              imageUrl,
            });
          }}
        />
      );
    }

    return <span className="text-lg leading-none select-none">{emojiStr}</span>;
  };

  const handleTouchStart = (emoji: string) => {
    longPressTimerRef.current = setTimeout(() => {
      setActivePopupEmoji(emoji);
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }
  };

  const filteredCustomEmojis = customEmojis.filter((emoji) => {
    const name = normalizeEmojiName(emoji.name).toLowerCase();
    return name.includes(searchQuery.toLowerCase());
  });

  const youtubeId = hasAttachedPostVideo(externalPost)?null:getYouTubeId(comment.content);
  const linkPreview=useLinkPreview(comment.content,canShowPostLinkPreview({...comment,linkPreview:externalPost?.linkPreview,video:externalPost?.video,externalVideo:externalPost?.externalVideo},embedded),externalPost?.linkPreview,!externalPost);

  const spotifyUrls = comment.content.match(spotifyRegex) || [];
  const extractedImageUrls = comment.content.match(imageRegex) || [];
  const allImageUrls = [...new Set([...(comment.imageUrls ?? []).filter(url=>url!==externalPost?.linkPreview?.image), ...extractedImageUrls])].slice(0, 4);

  let displayContent = twitterReplyText(comment.content,externalPost?.source==='x'&&!!(externalPost.externalReplyToId||externalPost.externalReplyToUsername||replyToUsername));
  displayContent = displayContent.replace(/(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/(watch\?v=|embed\/|shorts\/)?([a-zA-Z0-9_-]{11})([^?\s\n]*)?(\S+)?/g, youtubeId?'':'$&');
  displayContent = displayContent.replace(imageRegex, '');
  displayContent = displayContent.replace(spotifyRegex, '');
  displayContent = linkPreview.text(displayContent.trim());

  const useMobilePresentation = mobileFlat || isMobile;
  if(imageGeometry.current?.url!==allImageUrls[0]){
    const index=externalPost?.imageUrls.indexOf(allImageUrls[0])??-1;
    imageGeometry.current={url:allImageUrls[0],size:initialMediaSize(externalPost?.imageDimensions?.[index],allImageUrls[0])};
  }
  const singleImageFrameStyle=initialImageFrame(imageGeometry.current?.size??initialMediaSize(),useMobilePresentation);

  const renderContentWithLinks = (text: string) => {
    if (!text) return null;

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);

    return parts.map((part, index) => {
      if (part.match(urlRegex)) {
        return (
          <ContentLink
            key={`link-${index}`}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </ContentLink>
        );
      }

      return part;
    });
  };

  const renderContentWithHashtags = (text: string) => {
    if (!text) return null;

    const parts = text.split(/(#[^\s#　.,!?:;'"()\[\]{}<>]+)/g);

    return parts.map((part, index) => {
      if (part.startsWith('#')) {
        return (
          <button
            key={`hashtag-${index}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              navigate(`/search?q=${encodeURIComponent(part)}`);
            }}
            className="text-primary hover:underline transition-colors inline-block align-baseline"
          >
            {part}
          </button>
        );
      }

      return renderContentWithLinks(part);
    });
  };

  const renderContentWithMentions = (text: string): React.ReactNode => {
    if (hasStickers(text)) return renderStickerText(text, renderContentWithMentions);
    if (!text) return null;

    const parts = externalPost?splitMentionText(text):text.split(/(https?:\/\/[^\s]+|@\w+)/g);

    return parts.map((part, index) => {
      if (/^https?:\/\//.test(part)) return renderContentWithLinks(part);
      if (part.startsWith('@')) {
        const username = externalPost?mentionProfileHandle(part,externalPost.author):part.substring(1);

        return (
          <Link
            key={`mention-${index}`}
            to={`/u/${username}`}
            className="text-primary hover:underline transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </Link>
        );
      }

      return renderContentWithHashtags(part);
    });
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!confirm('コメントを削除しますか？')) return;

    try {
      const { error } = await supabase.from('comments').delete().eq('id', comment.id);
      if (error) throw error;
      setDeleted(true);
    } catch {
      alert('削除に失敗しました');
    }
  };

  const handleImageClick = (e: React.MouseEvent, url: string) => {
    e.preventDefault();
    e.stopPropagation();
    openMediaViewer({ url, post: mediaPost, offline: offlineBookmark, media: (comment.imageUrls ?? [url]).map(src => ({ src })) });
  };

  const handleCardClick = () => {
    navigate(replyUrl);
  };

  const HoverStats = ({ userId }: { userId: string }) => {
    const { data: stats } = useFollowStats(userId);

  return (
      <div className="mt-3 flex items-center gap-4 text-[14px]">
        <div className="flex items-center gap-1">
          <span className="font-bold text-foreground">
            {stats ? formatDisplayCount(stats.following) : 0}
          </span>
          <span className="text-muted-foreground">フォロー中</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="font-bold text-foreground">
            {stats ? formatDisplayCount(stats.followers) : 0}
          </span>
          <span className="text-muted-foreground">フォロワー</span>
        </div>
      </div>
    );
  };

  const ProfileHoverContent = () => (
    <HoverCardContent
      side="bottom"
      align="start"
      className="w-[280px] rounded-[20px] border border-border/60 bg-card p-4 shadow-xl animate-in fade-in zoom-in duration-200 overflow-hidden"
    >
      <div className="flex justify-between items-start mb-3">
        <Avatar userId={comment.author.id} className="h-14 w-14 border border-primary/5">
          <AvatarImage src={comment.author.avatarUrl} alt={comment.author.displayName} />
          <AvatarFallback>{comment.author.displayName.slice(0, 1)}</AvatarFallback>
        </Avatar>

        {currentUserId !== comment.author.id && (
          <div className="shrink-0 w-[85px] h-[36px]" onClick={(e) => e.stopPropagation()}>
            <div className="w-full h-full [&>*]:!w-full [&>*]:!h-full [&>*]:!min-w-0 [&>*]:!p-0 [&>*]:!flex [&>*]:!items-center [&>*]:!justify-center [&>*]:!bg-foreground [&>*]:!text-background [&>*]:!rounded-full [&>*]:!text-[14px] [&>*]:!font-bold [&>*]:!border-none [&_svg]:!hidden">
              <FollowButton userId={comment.author.id} />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-0.5">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-base font-black text-foreground truncate leading-tight shrink">
            {comment.author.displayName}
          </span>

          {comment.author.isPrivate && <PrivateAccountBadge/>}
          <ProviderVerificationBadge verification={externalPost?.author.providerVerification} className="h-[1.1em] w-[1.1em] shrink-0 transform translate-y-[1px]"/>{comment.author.isOfficial && (
            <PrivateMediaImage
              src={`${import.meta.env.BASE_URL}verified.png`}
              alt="Official"
              className="h-[1.1em] w-[1.1em] shrink-0 transform translate-y-[1px]"
            />
          )}
        </div>

        <p className="text-[15px] text-muted-foreground leading-none">
          @{displayUsername(comment.author.username)}
        </p>
      </div>

      {comment.author.bio && (
        <p className="mt-3 text-[15px] leading-normal text-foreground whitespace-pre-wrap line-clamp-3">
          {comment.author.bio}
        </p>
      )}

      <div className="mt-3 flex items-center gap-1.5 text-[14px] text-muted-foreground">
        <CalendarDays className="h-4 w-4" />
        <span>{dayjs(comment.author.createdAt).format('YYYY年M月')} から参加</span>
      </div>

      <HoverStats userId={comment.author.id} />
    </HoverCardContent>
  );

  if (deleted) return null;

  const replyMenu = (                <div className="relative ml-2 shrink-0">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowMenu(!showMenu);
                    }}
                    className="p-1 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    aria-label="コメントのメニュー"
                  >
                    <MoreHorizontal className="h-5 w-5" />
                  </button>

                  {showMenu && (
                    <>
                      <div
                        data-lime-media-sheet-backdrop={mediaPresentation || undefined}
                        className="lime-post-options-backdrop fixed inset-0 z-10"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowMenu(false);
                        }}
                      />

                      <div
                        data-lime-media-sheet={mediaPresentation ? 'menu' : undefined}
                        data-post-menu-os={mobilePostMenuOS()}
                        className="absolute right-0 mt-1 lime-post-options rounded-xl bg-card shadow-lg z-20 overflow-hidden animate-in fade-in zoom-in duration-100"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {mediaPresentation && <button onClick={() => navigate(replyUrl)} className="flex w-full items-center rounded-lg px-3 py-2 text-sm font-bold hover:bg-muted"><LinkIcon className="h-4 w-4" />ポストに移動</button>}
                        {mediaDownload && <button onClick={() => {setShowMenu(false);mediaDownload();}} className="flex w-full items-center rounded-lg px-3 py-2 text-sm font-bold hover:bg-muted"><Download className="h-4 w-4" />画像を保存</button>}
                        {(!externalPost || externalPost.id.startsWith('bsky:') || /^x:\d+$/.test(externalPost.id)) && <button onClick={(event) => { event.stopPropagation(); navigate(externalPost?`/post/${encodeURIComponent(externalPost.id)}/activity`:`/post/${comment.postId}/activity?reply=${encodeURIComponent(comment.id)}`); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground hover:bg-muted transition-colors"><ChartBarBig className="h-4 w-4" />ポストアクティビティ</button>}
                        {isMyComment && !externalPost && (
                        <button
                          onClick={handleDelete}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-destructive hover:bg-destructive/10 transition-colors border-t border-border/50 mt-1"
                        >
                          <Trash2 className="h-4 w-4" />
                          削除
                        </button>
                        )}
                      </div>
                    </>
                  )}
                </div>);
  const replyReactions = (<>            {!embedded && reactions.length > 0 && (
              <div className={`${detail ? "col-span-2 " : ""}mt-3 flex flex-wrap gap-1.5 relative`} onClick={(e) => e.stopPropagation()}>
                {reactions.map((g) => {
                  const hasMyReaction = currentUserId ? g.user_ids.includes(currentUserId) : false;
                  const isPopupOpen = activePopupEmoji === g.emoji;

                  return (
                    <div
                      key={g.emoji}
                      className="relative inline-block"
                      onMouseEnter={() => setActivePopupEmoji(g.emoji)}
                      onMouseLeave={() => setActivePopupEmoji(null)}
                    >
                      <button
                        onClick={(e) => handleAddReaction(g.emoji, e)}
                        onTouchStart={() => handleTouchStart(g.emoji)}
                        onTouchEnd={handleTouchEnd}
                        className={`inline-flex items-center gap-1.5 h-[45px] px-2.5 rounded-xl text-[15px] font-bold transition-all select-none outline-none border-none origin-center ${
                          hasMyReaction
                            ? 'bg-sky-500/15 dark:bg-sky-500/15 text-sky-500 dark:text-sky-400'
                            : 'bg-black/[0.05] dark:bg-muted/50 text-muted-foreground hover:bg-black/[0.08] dark:hover:bg-muted/80 hover:text-foreground'
                        }`}
                      >
                        {renderEmojiElement(g.emoji, 'h-5 w-5 object-contain')}
                        <span className="tabular-nums text-sm font-black">{g.count}</span>
                      </button>

                      {isPopupOpen && g.users.length > 0 && (
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-[260px] bg-white dark:bg-[#252932] border border-black/[0.08] dark:border-white/5 rounded-2xl shadow-2xl z-[60] flex p-3 pointer-events-none">
                          <div className="w-[64px] h-[64px] shrink-0 flex items-center justify-center border-r border-black/[0.08] dark:border-white/10 pr-2.5 mr-2.5">
                            {renderEmojiElement(g.emoji, 'h-12 w-12 object-contain')}
                          </div>

                          <div className="flex-1 min-w-0 flex flex-col gap-1.5 max-h-[160px] overflow-y-auto scrollbar-none">
                            {g.users.map((u) => (
                              <div key={u.id} className="flex items-center gap-2 min-w-0">
                                <Avatar className="h-5 w-5 shrink-0 border border-black/[0.08] dark:border-white/10">
                                  <AvatarImage src={u.avatarUrl} />
                                  <AvatarFallback className="text-[9px]">{u.displayName.slice(0, 1)}</AvatarFallback>
                                </Avatar>

                                <div className="min-w-0 flex-1 flex flex-col">
                                  <span className="text-[12px] font-black text-foreground dark:text-white truncate leading-none mb-0.5">
                                    {u.displayName}
                                  </span>

                                  <span className="text-[10px] text-muted-foreground/70 truncate leading-none">
                                    @{displayUsername(u.username)}
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
            )}</>);
  const replyActions = (<>{mediaPresentation && replyReactions}            {!embedded && <div data-lime-comment-actions className={detail ? `col-span-2 mt-3 flex items-center gap-1 text-muted-foreground relative h-9 ${mobileFlat ? 'post-detail-mobile-action-row' : 'border-t border-border/60 pt-3'}` : isMobile ? 'mt-2 flex items-center gap-1 text-muted-foreground relative h-8' : 'mt-3 flex items-center gap-1 text-muted-foreground relative h-9'}>
              <div onClick={(e) => e.stopPropagation()} className={detail && mobileFlat ? "flex items-center h-full post-detail-mobile-action-hit" : "flex items-center h-full"}>
                <div className="inline-flex">{externalPost ? <ExternalLikeButton post={externalPost} onChange={onMediaLikeChange}/> : <Commentlikebutton syncState={!!onMediaLikeChange} onChange={onMediaLikeChange}
                  commentId={comment.id}
                  liked={comment.likedByMe}
                  count={comment.likesCount}
                />}</div>
              </div>

                <RepostButton post={mediaPost} mobilePresentation={useMobilePresentation} />
              <Link
                to={replyUrl}
                aria-label="この返信に返信する"
                onClick={(e) => {e.stopPropagation();const intent=detail&&externalPost&&twitterReplyUrl(externalPost.id);if(intent){e.preventDefault();window.open(intent,'_blank','noopener,noreferrer');return;}if(onMediaReply){e.preventDefault();onMediaReply();}}}
                className={`inline-flex items-center gap-1.5 rounded-full ${useMobilePresentation && !detail ? "px-2 text-[13px]" : "px-2.5 text-sm"} py-1 transition-colors hover:text-accent h-full ${detail && mobileFlat ? 'post-detail-mobile-reply-count' : ''}`}
              >
                <MessageCircle className="h-5 w-5" />
                <span className={`font-bold tabular-nums ${mobileFlat || isMobile ? "text-[15px]" : "text-sm"}`}>{(comment.commentsCount ?? 0) > 0 ? formatDisplayCount(comment.commentsCount ?? 0) : ''}</span>
              </Link>

              {!externalPost && <div className="relative inline-flex items-center h-full" onClick={(e) => e.stopPropagation()}>
                <button
                  ref={buttonRef}
                  onClick={() => setShowPicker(!showPicker)}
                  className={
                    !(detail && mobileFlat) && useMobilePresentation
                      ? `inline-flex items-center justify-center gap-1.5 rounded-full px-2 py-1 text-[13px] transition-colors hover:text-accent h-full origin-center ${
                          showPicker ? 'text-accent bg-accent/10' : 'text-muted-foreground'
                        }`
                      : `inline-flex items-center justify-center p-1.5 rounded-full transition-colors hover:text-accent h-8 w-8 origin-center ${detail && mobileFlat ? 'post-detail-mobile-plus-button' : ''} ${
                          showPicker ? 'text-accent bg-accent/10' : 'text-muted-foreground'
                        }`
                  }
                >
                  <Plus className="h-5 w-5" />
                </button>

                {showPicker && (
                  <>
                    <div className="fixed inset-0 bg-transparent z-[9998]" onClick={() => setShowPicker(false)} />

                    {isMobile ? (
                      <div
                        className="fixed bottom-[76px] left-1/2 transform -translate-x-1/2 w-[92vw] max-w-[340px] h-[430px] rounded-[24px] border border-border/80 bg-white dark:bg-[#1e222b] shadow-2xl z-[9999] p-4 animate-slide-up-mobile overflow-y-auto overflow-x-hidden touch-pan-y"
                        onTouchStart={(e) => e.stopPropagation()}
                        onScroll={(e) => e.stopPropagation()}
                      >
                        <div className="grid grid-cols-5 gap-2.5 mb-3.5 shrink-0">
                          {defaultEmojis.map((emoji) => (
                            <button
                              key={emoji}
                              onClick={(e) => handleAddReaction(emoji, e)}
                              className="flex items-center justify-center h-11 w-11 text-2xl rounded-2xl hover:bg-black/[0.05] dark:hover:bg-white/10 transition-all origin-center"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>

                        {recentEmojis.length > 0 && (
                          <div className="mb-3.5 shrink-0">
                            <div className="text-[11px] font-bold text-muted-foreground/60 mb-1.5 px-0.5">最近使用</div>
                            <div className="flex flex-wrap gap-2.5">
                              {recentEmojis.map((emoji) => (
                                <button
                                  key={`recent-${emoji}`}
                                  onClick={(e) => handleAddReaction(emoji, e)}
                                  className="flex items-center justify-center h-9 w-9 rounded-xl hover:bg-black/[0.05] dark:hover:bg-white/10 transition-all origin-center"
                                >
                                  {renderEmojiElement(emoji, 'h-6 w-6 object-contain')}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="flex flex-col border-t border-black/[0.08] dark:border-white/5 pt-2">
                          <button
                            onClick={() => setIsEmojisOpen(!isEmojisOpen)}
                            className="flex items-center justify-between w-full px-0.5 py-1 text-[11px] font-black text-muted-foreground/80 hover:text-foreground transition-colors shrink-0"
                          >
                            <span className="truncate">カスタム絵文字</span>
                            <span className="text-[10px] opacity-60">{isEmojisOpen ? '▲' : '▼'}</span>
                          </button>

                          {isEmojisOpen && (
                            <div className="p-0.5 block mt-1">
                              {filteredCustomEmojis.length > 0 ? (
                                <div className="grid grid-cols-4 gap-2.5">
                                  {filteredCustomEmojis.map((emoji) => {
                                    const token = toEmojiToken(emoji.name);

                                    return (
                                      <button
                                        key={emoji.id}
                                        onClick={(e) => handleAddReaction(token, e)}
                                        title={token}
                                        className="flex items-center justify-center h-12 w-12 rounded-2xl hover:bg-black/[0.05] dark:hover:bg-white/10 transition-all p-1.5 origin-center"
                                      >
                                        {renderEmojiElement(token, 'h-9 w-9 object-contain')}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="text-center text-[11px] text-muted-foreground/50 py-6">
                                  絵文字が見つかりません
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div
                        className="absolute bottom-full left-0 mb-2 w-[260px] h-[280px] rounded-[20px] border border-border/80 bg-white dark:bg-[#1e222b] shadow-2xl z-[9999] p-2.5 animate-zoom-in-pc overflow-y-auto overflow-x-hidden"
                        onWheel={(e) => e.stopPropagation()}
                      >
                        <div className="grid grid-cols-7 gap-1 mb-2 shrink-0">
                          {defaultEmojis.map((emoji) => (
                            <button
                              key={emoji}
                              onClick={(e) => handleAddReaction(emoji, e)}
                              className="flex items-center justify-center h-8 w-8 text-xl rounded-lg hover:bg-black/[0.05] dark:hover:bg-white/10 transition-all origin-center"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>

                        {recentEmojis.length > 0 && (
                          <div className="mb-2 shrink-0">
                            <div className="text-[11px] font-bold text-muted-foreground/60 mb-1 px-0.5">最近使用</div>
                            <div className="flex flex-wrap gap-1">
                              {recentEmojis.map((emoji) => (
                                <button
                                  key={`recent-${emoji}`}
                                  onClick={(e) => handleAddReaction(emoji, e)}
                                  className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-black/[0.05] dark:hover:bg-white/10 transition-all origin-center"
                                >
                                  {renderEmojiElement(emoji, 'h-[18px] w-[18px] object-contain')}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="flex flex-col border-t border-black/[0.08] dark:border-white/5 pt-1.5">
                          <button
                            onClick={() => setIsEmojisOpen(!isEmojisOpen)}
                            className="flex items-center justify-between w-full px-0.5 py-1 text-[11px] font-black text-muted-foreground/80 hover:text-foreground transition-colors shrink-0"
                          >
                            <span className="truncate">カスタム絵文字</span>
                            <span className="text-[10px] opacity-60">{isEmojisOpen ? '▲' : '▼'}</span>
                          </button>

                          {isEmojisOpen && (
                            <div className="p-0.5 mt-1">
                              {filteredCustomEmojis.length > 0 ? (
                                <div className="grid grid-cols-6 gap-1">
                                  {filteredCustomEmojis.map((emoji) => {
                                    const token = toEmojiToken(emoji.name);

                                    return (
                                      <button
                                        key={emoji.id}
                                        onClick={(e) => handleAddReaction(token, e)}
                                        title={token}
                                        className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-black/[0.05] dark:hover:bg-white/10 transition-all p-0.5 origin-center"
                                      >
                                        {renderEmojiElement(token, 'h-6 w-6 object-contain')}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="text-center text-[11px] text-muted-foreground/50 py-4">
                                  絵文字が見つかりません
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="mt-2 pt-1.5 border-t border-black/[0.08] dark:border-white/5 shrink-0">
                          <input
                            type="text"
                            placeholder="検索"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full h-8 bg-black/[0.03] dark:bg-black/30 border border-black/[0.08] dark:border-white/10 rounded-lg px-2.5 text-xs font-medium text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 transition-colors"
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>}
              <ReplyShare externalPost={externalPost} comment={comment} currentUserId={currentUserId} className={detail && mobileFlat ? 'post-detail-mobile-share-button' : ''} />
            </div>}</>);

  return (
    <>
      <style>{`
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
          0% { transform: scale(1); }
          20% { transform: scale(0.84); }
          50% { transform: scale(1.16); }
          75% { transform: scale(0.94); }
          100% { transform: scale(1); }
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

        @media (max-width: 639px) {
          .comment-list-mobile-item {
            max-width: none !important;
            padding: 12px 16px !important;
            border: 0 !important;
            border-bottom: 1px solid hsl(var(--border) / 0.62) !important;
            border-radius: 0 !important;
            background: transparent !important;
            box-shadow: none !important;
          }

          .comment-list-mobile-stack {
            margin: 0 !important;
          }

          .comment-list-mobile-stack > li {
            margin-top: 0 !important;
          }

          .comment-list-mobile-state {
            border: 0 !important;
            border-bottom: 1px solid hsl(var(--border) / 0.62) !important;
            border-radius: 0 !important;
            background: transparent !important;
            box-shadow: none !important;
          }

          .comment-list-mobile-empty {
            border: 0 !important;
            border-radius: 0 !important;
            background: transparent !important;
            box-shadow: none !important;
          }
        }
      `}</style>

      {(activeRings.length > 0 || activeDots.length > 0) && (
        <div className="fixed inset-0 pointer-events-none z-[9999] overflow-hidden">
          {activeRings.map((r) => (
            <div
              key={r.id}
              style={{
                position: 'fixed',
                left: r.x,
                top: r.y,
                width: `${r.width}px`,
                height: `${r.height}px`,
                borderRadius: '9999px',
                border: '4px solid #d4f022',
                backgroundColor: 'transparent',
                transformOrigin: 'center center',
                animation: 'misskeyRingExpand 460ms cubic-bezier(0.1, 0.8, 0.3, 1) forwards',
              }}
            />
          ))}

          {activeDots.map((d) => (
            <div
              key={d.id}
              style={{
                position: 'fixed',
                left: d.x,
                top: d.y,
                width: `${d.size}px`,
                height: `${d.size}px`,
                backgroundColor: d.color,
                borderRadius: '50%',
                transformOrigin: 'center center',
                ['--mk-angle' as any]: `${d.angle}deg`,
                ['--mk-dist' as any]: `${d.distance}px`,
                animation: 'misskeyDotBurst 480ms cubic-bezier(0.12, 0.85, 0.3, 1) forwards',
                animationDelay: `${d.delay}ms`,
              }}
            />
          ))}
        </div>
      )}

      {mediaPresentation ? <article data-lime-media-post-actions={mediaPresentation} className="relative w-full">{mediaPresentation==='menu'?replyMenu:replyActions}</article> : <article
        data-lime-comment-card={comment.id}
        data-lime-embedded={embedded || undefined}
        data-lime-reply-detail={detail || undefined}
        data-lime-thread-item={thread && !embedded || undefined}
        onClick={handleCardClick}
        className={
          embedded ? 'relative w-full cursor-pointer' : flat
            ? 'relative w-full py-3 cursor-pointer' : mobileFlat
            ? 'comment-list-mobile-item relative mx-auto w-full max-w-[600px] px-0 py-3 cursor-pointer'
            : isMobile
              ? 'relative mx-auto w-full max-w-[600px] px-0 py-3 cursor-pointer'
            : 'rounded-3xl border border-border/60 bg-card p-5 shadow-soft transition hover:shadow-card-soft relative cursor-pointer'
        }
      >
        {isMobile && !thread && !flat && (
          <div data-lime-post-divider className="pointer-events-none absolute bottom-0 left-1/2 w-screen -translate-x-1/2 border-b border-border/60" />
        )}

        {repostedByLabel && !embedded && <div data-lime-repost-label className="mb-1 flex items-center gap-3 text-sm font-semibold text-muted-foreground"><span className="inline-flex w-11 shrink-0 justify-end"><RepostIcon className="h-4 w-4" /></span><span>{repostedByLabel}がリポストしました</span></div>}
        <div data-lime-post-layout className={detail ? "grid grid-cols-[48px_minmax(0,1fr)] gap-x-3" : "flex items-start gap-3"}>
          <HoverCard openDelay={300}>
            <HoverCardTrigger asChild>
              <Link
                to={`/u/${comment.author.username}`}
                className="shrink-0"
                data-lime-thread-avatar={thread && !embedded || undefined}
                data-lime-post-avatar
                onClick={(e) => e.stopPropagation()}
              >
                <Avatar userId={comment.author.id} className={detail ? 'h-12 w-12 border border-border/60 post-detail-mobile-avatar' : 'h-11 w-11 border-2 border-primary/30'}>
                  <AvatarImage src={comment.author.avatarUrl} alt={comment.author.displayName} />
                  <AvatarFallback>{comment.author.displayName.slice(0, 1)}</AvatarFallback>
                </Avatar>
              </Link>
            </HoverCardTrigger>

            {!externalPost && <ProfileHoverContent />}
          </HoverCard>

          <div data-lime-post-content className={detail ? "contents" : "min-w-0 flex-1"}>
            <div data-lime-post-header className={detail ? "flex items-start justify-between mb-1" : "flex items-center justify-between mb-1"}>
              <div className={detail ? "flex flex-wrap items-center w-full min-w-0" : "flex items-center overflow-hidden w-full min-w-0"}>
                <HoverCard openDelay={300}>
                  <HoverCardTrigger asChild>
                    <Link
                      to={`/u/${comment.author.username}`}
                      className="flex items-center min-w-0 shrink font-display font-bold text-foreground hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-0.5 min-w-0">
                        <span className={detail && mobileFlat ? 'truncate post-detail-mobile-name' : 'truncate text-base'}>
                          {comment.author.displayName}
                        </span>

                        {comment.author.isPrivate && <PrivateAccountBadge/>}
          <ProviderVerificationBadge verification={externalPost?.author.providerVerification} className="h-4 w-4 shrink-0 transform translate-y-[0.5px]"/>{comment.author.isOfficial && (
                          <PrivateMediaImage
                            src={`${import.meta.env.BASE_URL}verified.png`}
                            alt="Official"
                            className="h-4 w-4 shrink-0 transform translate-y-[0.5px]"
                            loading="eager"
                          />
                        )}
                      </div>
                    </Link>
                  </HoverCardTrigger>

                  {!externalPost && <ProfileHoverContent />}
                </HoverCard>

                <span className={detail ? `w-full truncate text-xs text-muted-foreground ${mobileFlat ? 'post-detail-mobile-username' : ''}` : 'truncate text-base text-muted-foreground ml-1 opacity-80 shrink'}>
                  @{displayUsername(comment.author.username)}
                </span>

                {!detail && <span className="text-muted-foreground mx-1 shrink-0">·</span>}

                {!detail && <span className={isMobile ? 'text-[16px] text-muted-foreground whitespace-nowrap shrink-0' : 'text-sm text-muted-foreground whitespace-nowrap shrink-0'}>
                  {formatRelative(comment.createdAt)}
                </span>}
              </div>

              {!embedded && (!externalPost || externalPost.id.startsWith('bsky:') || /^x:\d+$/.test(externalPost.id)) && replyMenu}
            </div>

            <div data-lime-post-body data-lime-post-has-images={allImageUrls.length > 0 || undefined} className={detail ? "col-span-2 min-w-0" : undefined}>
              <div>
                {replyToUsername && <p className="mb-1 text-sm text-muted-foreground">返信先: <Link className="text-primary hover:underline" to={`/u/${replyToUsername}`} onClick={event => event.stopPropagation()}>@{displayUsername(replyToUsername)}</Link>さん</p>}
                {displayContent && (
                  <p className={detail ? `mt-4 whitespace-pre-wrap break-words text-lg leading-relaxed text-foreground ${mobileFlat ? 'post-detail-mobile-content' : ''}` : isMobile ? 'whitespace-pre-wrap break-words text-[16px] leading-normal text-foreground mt-1' : 'whitespace-pre-wrap break-words text-base leading-relaxed text-foreground mt-1'}>
                    {renderContentWithMentions(displayContent)}
                  </p>
                )}

                {failedUrls.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {failedUrls.map((url, idx) => (
                      <div key={`failed-${idx}`}>
                        {renderContentWithLinks(url)}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <LinkPreviewCard {...linkPreview} />
              {externalPost?.externalVideo&&<PostVideoPlayer embedded={embedded} postId={externalPost.id} post={externalPost} video={externalPost.externalVideo} externalVideo={externalPost.externalVideo}/>}
              {externalPost&&<ExternalPostDetails post={externalPost}/>}
              {youtubeId && (
                <div onClick={(e) => e.stopPropagation()} className="mt-3">
                  <YouTubeEmbed videoId={youtubeId} />
                </div>
              )}

              {spotifyUrls.length > 0 && (
                <div onClick={(e) => e.stopPropagation()} className="space-y-2 mt-3">
                  {spotifyUrls.map((url, idx) => (
                    <SpotifyEmbed key={`spotify-${idx}`} url={url} />
                  ))}
                </div>
              )}

              {allImageUrls.length === 1 && !failedUrls.includes(allImageUrls[0]) ? (
                <div data-lime-post-images={allImageUrls.length>0||undefined} className="mt-3 flex max-w-full justify-start" onClick={(e) => e.stopPropagation()}>
                  <button key={allImageUrls[0]} type="button" data-lime-single-post-image data-lime-media-fallback={imageGeometry.current?.size.width===16&&imageGeometry.current?.size.height===9||undefined} aria-label="画像を拡大表示" className="relative block max-w-full cursor-zoom-in overflow-hidden rounded-2xl border border-border/60 bg-background text-left shadow-none" style={singleImageFrameStyle} onClick={(e) => handleImageClick(e, allImageUrls[0])}>
                    <PrivateMediaImage data-lime-media-loading-frame src={allImageUrls[0]} alt={externalPost?.imageAltTexts?.[0]||"返信画像"} referrerPolicy={externalPost?.source==='x'?'no-referrer':undefined} className="block select-none" style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'contain'}} draggable={false} loading="lazy" decoding="async" onError={event=>{event.currentTarget.style.opacity='0';}} />
                  </button>
                </div>
              ) : allImageUrls.length > 1 && (
                <div
                  data-lime-post-images={allImageUrls.length>0||undefined}
                  className="cursor-zoom-in"
                  onClick={(e) => {
                    const target = e.target as HTMLElement;

                    if (target.tagName === 'IMG' && (target as HTMLImageElement).src) {
                      handleImageClick(e, (target as HTMLImageElement).src);
                    } else {
                      handleCardClick();
                    }
                  }}
                >
                  <PostImages
                    altTexts={externalPost?.imageAltTexts}
                    urls={allImageUrls}
                    embedded={embedded}
                    onImageError={(url) => {
                      if (!failedUrls.includes(url)) {
                        setFailedUrls((prev) => [...prev, url]);
                      }
                    }}
                  />
                </div>
              )}
            </div>

            {replyReactions}

            {detail && <p className={`col-span-2 mt-4 text-xs text-muted-foreground ${mobileFlat ? 'post-detail-mobile-meta' : ''}`} title={formatDate(comment.createdAt)}>{formatDate(comment.createdAt)} · {formatRelative(comment.createdAt)}{comment.clientName && <><span className="mx-1">·</span><span className="text-primary/80 font-medium">{comment.clientName}</span></>}</p>}
            {!embedded&&externalPost&&<PostSourceLabel post={externalPost} small={useMobilePresentation}/>}
            {replyActions}
          </div>
        </div>
      </article>}

    </>
  );
}

// ─── CommentList ──────────────────────────────────────────────────────────────
function CommentList({
  postId,
  mobileFlat = false,
  parentCommentId = null,
  threadAuthorId,
}: {
  postId: string;
  mobileFlat?: boolean;
  parentCommentId?: string | null;
  threadAuthorId?: string;
}) {
  const { data, isLoading, isError } = useComments(postId);
  const [expandedReplies, setExpandedReplies] = useState<ReadonlySet<string>>(new Set());
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  useMinuteTick();

  useEffect(() => { setExpandedReplies(new Set()); }, [postId, parentCommentId]);

  useEffect(() => {
    getCurrentUserId().then(setCurrentUserId);

  }, []);

  if (isLoading) {
    return <div><PostCardSkeleton /><PostCardSkeleton /></div>;
  }

  if (isError) {
    return (
      <div className={`${mobileFlat ? 'comment-list-mobile-state ' : ''}rounded-3xl border border-destructive/40 bg-destructive/5 p-6 text-center`}>
        <p className="text-sm text-destructive">コメントの読み込みに失敗しました。</p>
      </div>
    );
  }

  const directReplies = data?.filter(comment => (comment.parentCommentId ?? null) === parentCommentId) ?? [];
  if (directReplies.length === 0) {
    return (
      <div className={mobileFlat
        ? 'comment-list-mobile-empty p-8 text-center text-muted-foreground'
        : 'rounded-3xl border border-border/60 bg-card p-8 text-center text-muted-foreground'
      }>
        まだコメントはありません。
      </div>
    );
  }

  return <CommentConversations comments={data ?? []} currentUserId={currentUserId} mobileFlat={mobileFlat}
    threadAuthorId={threadAuthorId} parentCommentId={parentCommentId} expandedReplies={expandedReplies}
    onExpand={id => setExpandedReplies(previous => new Set([...previous, id]))} />;
}

/** Shared conversation layout for native and external replies. */
function CommentConversations({ comments, currentUserId, mobileFlat, threadAuthorId, parentCommentId = null, expandedReplies, onExpand }: {
  comments: (CommentWithAuthor & { externalPost?: PostWithAuthor })[];
  currentUserId: string | null;
  mobileFlat: boolean;
  threadAuthorId?: string;
  parentCommentId?: string | null;
  expandedReplies: ReadonlySet<string>;
  onExpand: (id: string) => void;
}) {
  const conversations = getAuthorReplyConversations(comments, threadAuthorId, parentCommentId, expandedReplies);
  const externalPosts = new Map(comments.filter(comment => comment.externalPost).map(comment => [comment.id, comment.externalPost]));
  return (
    <ul className="m-0 space-y-0" data-lime-detail-conversations>
      {conversations.flatMap(({ root, branches, threadIds }) => branches.map(({ items, moreFor }) => (
        <li key={`${root.id}:${items.at(-1)?.id}:${moreFor?.id ?? 'shown'}`} className="animate-float-up">
          <div className="border-b border-border/60 px-4 sm:px-6">
            <ReplyChain>
              {items.map(c => <div key={c.id} data-lime-conversation-comment={c.id} data-lime-conversation-parent={c.parentCommentId ?? ''}>
                <CommentCard flat comment={{ ...c, likesCount: Number(c.likesCount ?? c.likes_count ?? 0), likedByMe: !!c.likedByMe } as Comment} externalPost={externalPosts.get(c.id)} currentUserId={currentUserId} mobileFlat={mobileFlat} thread={threadIds.has(c.id)} />
              </div>)}
              {moreFor && <button type="button" data-lime-thread-more={moreFor.id} onClick={() => onExpand(moreFor.id)} className="ml-14 flex min-h-12 items-center py-3 text-base text-primary hover:underline">返信を表示</button>}
            </ReplyChain>
          </div>
        </li>
      )))}
    </ul>
  );
}

function ExternalReplyCard({ post, parentId, replyToUsername, mobileFlat = true, detail = false, thread = false, embedded = false, repostedByLabel }: {
  post: PostWithAuthor; parentId?: string; replyToUsername?: string; mobileFlat?: boolean;
  detail?: boolean; thread?: boolean; embedded?: boolean; repostedByLabel?: string;
}) {
  const { user } = useAuth();
  return <CommentCard comment={{ ...post, postId: parentId ?? post.externalReplyToId ?? post.id }} externalPost={post}
    currentUserId={user?.id ?? null} mobileFlat={mobileFlat} detail={detail} thread={thread} embedded={embedded}
    repostedByLabel={repostedByLabel} replyToUsername={replyToUsername ?? post.externalReplyToUsername} />;
}

function RepostedReplyCard({post,repostedByLabel,embedded=false}:{post:PostWithAuthor;repostedByLabel?:string;embedded?:boolean}) {
  const {user}=useAuth();
  return <CommentCard currentUserId={user?.id ?? null} mobileFlat thread={embedded} embedded={embedded} repostedByLabel={repostedByLabel} replyToUsername={post.replyToUsername}
    comment={{id:post.replyId!,postId:post.replyPostId!,userId:post.userId,content:post.content,imageUrls:post.imageUrls,
      createdAt:post.createdAt,likesCount:post.likesCount,likedByMe:post.likedByMe,commentsCount:post.commentsCount,author:post.author}} />;
}

export { CommentCard };
export { CommentList };
export { CommentConversations };
export { ExternalReplyCard };
export { RepostedReplyCard };
export { ReplyShare };
export { ReplyChain };


// ExternalReplyList
/** External replies use the same presentation as LimeNote comments, with external IDs intact. */
function ExternalReplyList({ parent, replies, isLoading, isError, mobileFlat }: {
  parent: PostWithAuthor;
  replies: BlueskyMappedPost[];
  isLoading: boolean;
  isError: boolean;
  mobileFlat: boolean;
}) {
  const { user } = useAuth();
  const [expandedReplies, setExpandedReplies] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => { setExpandedReplies(new Set()); }, [parent.id]);
  if (isLoading) return <PostCardSkeleton />;
  if (isError) return <div className="rounded-3xl border border-destructive/40 bg-destructive/5 p-6 text-center"><p className="text-sm text-destructive">返信の読み込みに失敗しました。</p></div>;
  if (!replies.length) return <div className={mobileFlat ? 'p-8 text-center text-muted-foreground' : 'rounded-3xl border border-border/60 bg-card p-8 text-center text-muted-foreground'}>まだ返信はありません。</div>;
  const replyIds = new Set(replies.map(reply => reply.id));
  const comments = replies.map(reply => {
    const post: PostWithAuthor = { repostsCount: 0, repostedByMe: false, ...reply, author: { coverUrl: '', ...reply.author } };
    // External pages can omit a deleted/hidden parent or return a child before
    // its parent. Keep that reply visible until the parent arrives on a later page.
    return { ...post, postId: parent.id, parentCommentId: post.externalReplyToId && post.externalReplyToId !== parent.id && replyIds.has(post.externalReplyToId) ? post.externalReplyToId : null, externalPost: post } as CommentWithAuthor & { externalPost: PostWithAuthor };
  });
  return <CommentConversations comments={comments} currentUserId={user?.id ?? null} mobileFlat={mobileFlat}
    threadAuthorId={parent.userId ?? parent.author.id} expandedReplies={expandedReplies}
    onExpand={id => setExpandedReplies(previous => new Set([...previous, id]))} />;
}

// ExternalReplyDetail
function ExternalReplyDetail({ post, mobileFlat }: { post: PostWithAuthor; mobileFlat: boolean }) {
  const selected = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!selected.current) return;
    const host = selected.current.closest('[data-lime-reply-chain]') ?? selected.current;
    let anchoring = true;
    const align = () => { if (anchoring) selected.current?.scrollIntoView({ block: 'center', behavior: 'auto' }); };
    const resize = new ResizeObserver(align);
    resize.observe(host);
    const stop = () => { anchoring = false; resize.disconnect(); };
    const interactions = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
    interactions.forEach(event => window.addEventListener(event, stop, { passive: true }));
    host.addEventListener('load', align, true);
    align();
    return () => {
      stop();
      host.removeEventListener('load', align, true);
      interactions.forEach(event => window.removeEventListener(event, stop));
    };
  }, [post.id]);
  const parents:PostWithAuthor[]=[],seen=new Set([post.id]);let parent=post.externalReplyParent;
  while(parent&&!seen.has(parent.id)&&parents.length<20){seen.add(parent.id);parents.unshift(parent);parent=parent.externalReplyParent;}
  return <div style={{ '--reply-frame-padding': mobileFlat ? '16px' : '24px' } as CSSProperties}
    className={mobileFlat ? 'post-detail-mobile-article' : 'rounded-3xl border border-border/60 bg-card p-6 shadow-soft'}>
    <style>{`[data-lime-reply-chain] [data-lime-reply-detail] { padding-bottom: 0 !important; }`}</style>
    <ReplyChain>
      {parents.map(parent=><PostCard key={parent.id} post={parent} thread />)}
      <div ref={selected} data-lime-selected-reply>
        <ExternalReplyCard post={post} detail thread mobileFlat={mobileFlat} />
      </div>
    </ReplyChain>
  </div>;
}

export { ExternalReplyList };
export { ExternalReplyDetail };
