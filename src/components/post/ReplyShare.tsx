import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Send, Link as LinkIcon, Upload, X } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { supabase } from '@/lib/supabase';
import { commentThreadUrl } from '@/lib/commentThread';

interface SharedReply { id: string; postId: string; content: string; author: { id: string; username: string; displayName: string } }
interface LimeDropTarget { id: string; username: string; displayName: string; avatarUrl: string }

// Keep the PostCard sharing choices and recipient rules for a reply's own URL.
export function ReplyShare({ comment, currentUserId, className = '' }: { comment: SharedReply; currentUserId: string | null; className?: string }) {
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
  const getPostShareUrl = () => new URL(commentThreadUrl(comment.postId, comment.id).slice(1), new URL(import.meta.env.BASE_URL, window.location.origin)).href;
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
        .eq('follower_id', currentUserId);

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

      const { error } = await supabase
        .from('lime_drops')
        .insert({
          sender_id: currentUserId,
          recipient_id: target.id,
          post_id: null,
          post_url: url,
          post_author_id: comment.author.id,
          post_author_username: comment.author.username,
          post_author_display_name: comment.author.displayName,
          post_text: text,
          status: 'pending',
        });

      if (error) throw error;

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
    <button type="button" onClick={handleShareButtonClick} aria-label="返信を共有" className={`ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-accent ${className}`}><Upload className="h-5 w-5" /></button>
                {showShareMenu && typeof document !== 'undefined' && createPortal(
                  <>
                    <div
                      className="fixed inset-0 bg-transparent"
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
                      className="fixed w-[min(calc(100vw-16px),16rem)] rounded-xl border border-border bg-card p-1 shadow-lg overflow-hidden animate-in fade-in zoom-in duration-100"
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
                          @{target.username}
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
