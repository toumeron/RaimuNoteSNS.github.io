import {splitMentionText,mentionProfileHandle} from '@/lib/utils';
import {configuredMisskeyHandles,changeMisskeySetting,MISSKEY_HANDLES_KEY} from '@/lib/misskey';
import { ArrowLeft, CalendarDays, MapPin, Link2, MoreHorizontal, Radio, Search, Share2, UserCheck, UserPlus, X } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FollowButton } from './FollowButton';
import { useQuery } from '@tanstack/react-query';
import { getProfileActivityCount } from '@/api/profile-activity';
import { useFollowStats } from '@/hooks/useProfile';
import { useAuth } from '@/hooks/useAuth';
import { useJoinMembership, useLeaveMembership, useMembershipStatus } from '@/hooks/useMembership';
import { usePostNotificationSubscription } from '@/hooks/usePostNotifications';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import type { User } from '@/types';
import { getConfiguredBlueskyHandles, normalizeBlueskyHandle, saveConfiguredBlueskyHandles } from '@/lib/bluesky';

// --- 通知ボタン用アイコン（X/Twitter の「ポストの通知」アイコンと同じ24x24パス） ---
// currentColor なのでライト/ダーク両テーマで text-foreground に追従。背景は透明。
// ※ shadcn の Button は子 svg を [&_svg]:size-4 で縮めるため、サイズは inline style で指定する。
const BELL_ICON_SIZE = 20;
const bellIconStyle = { width: BELL_ICON_SIZE, height: BELL_ICON_SIZE, flexShrink: 0 } as const;

// ベル本体（右上を開けた形）。プラス/チェック共通。
const BELL_BODY_PATH =
  'M21.14 18h-4.241c-.464 2.281-2.482 4-4.899 4s-4.435-1.719-4.899-4H2.87L4 9.05C4.51 5.02 7.93 2 12 2v2C8.94 4 6.36 6.27 5.98 9.3L5.13 16h13.73l-.38-3h2.02l.64 5zm-6.323 0H9.183c.412 1.164 1.51 2 2.817 2s2.405-.836 2.817-2z';

function BellPlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={bellIconStyle}>
      {/* ベル＋プラス（Xの公式アイコンのパスそのまま） */}
      <path d="M22 5v2h-3v3h-2V7h-3V5h3V2h2v3h3zm-.86 13h-4.241c-.464 2.281-2.482 4-4.899 4s-4.435-1.719-4.899-4H2.87L4 9.05C4.51 5.02 7.93 2 12 2v2C8.94 4 6.36 6.27 5.98 9.3L5.13 16h13.73l-.38-3h2.02l.64 5zm-6.323 0H9.183c.412 1.164 1.51 2 2.817 2s2.405-.836 2.817-2z" />
    </svg>
  );
}

function BellCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={bellIconStyle}>
      <path d={BELL_BODY_PATH} />
      {/* チェック（プラスと同じ太さ 2 の線） */}
      <path d="M15.2 5.6l2.4 2.4 4.2-4.6" fill="none" stroke="currentColor" strokeWidth={2} />
    </svg>
  );
}

function normalizeAppPath(pathname: string) {
  const normalized = pathname.replace(/^\/RaimuNoteSNS\.github\.io(?=\/|$)/, '') || '/';
  return normalized === '' ? '/' : normalized;
}
function hasGithubPagesBasePath(pathname: string) {
  return /^\/RaimuNoteSNS\.github\.io(?=\/|$)/.test(pathname);
}
function isProfilePath(pathname: string) {
  return /^\/u\/[^/]+\/?$/.test(normalizeAppPath(pathname));
}
function getBrowserPathname() {
  if (typeof window === 'undefined') {
    return '';
  }
  return window.location.pathname;
}
function isGithubPagesProfilePath(pathname: string) {
  const browserPathname = getBrowserPathname();
  const hasBasePath = hasGithubPagesBasePath(pathname) || hasGithubPagesBasePath(browserPathname);
  if (!hasBasePath) {
    return false;
  }
  return isProfilePath(pathname) || isProfilePath(browserPathname);
}
export function ProfileHeader({
  user,
  blueskyStats,
  isBlueskyProfile = false,
}: {
  user: User;
  blueskyStats?: { following: number; followers: number; posts?: number };
  isBlueskyProfile?: boolean;
}) {
  const { user: me } = useAuth();
  const { data: stats } = useFollowStats(user.id);
  const { data: activityCount } = useQuery({
    queryKey: ['posts', 'user', user.id, 'activity-count', me?.id ?? null],
    queryFn: () => getProfileActivityCount(user.id),
    enabled: !isBlueskyProfile,
    staleTime: 0,
  });
  const isMe = me?.id === user.id;
  // 自分がこのユーザーをフォローしているか（通知ベルボタンの表示条件に使用）
  // FollowButton と同じく useFollowStats の followedByMe を参照する。
  const isFollowing = stats?.followedByMe ?? false;
  const navigate = useNavigate();
  const location = useLocation();
  const liftCoverToMobileTop = isGithubPagesProfilePath(location.pathname);
  const normalizedUsername = user.username.trim().replace(/^@+/, '').toLowerCase();
  const showSubscriptionButton = !isMe && (normalizedUsername === 'cat' || normalizedUsername === 'limenote');
  const { data: isMember } = useMembershipStatus(showSubscriptionButton ? user.id : undefined);
  const joinMembership = useJoinMembership(user.id);
  const leaveMembership = useLeaveMembership(user.id);
  // 「新しい投稿を通知する」ベルボタン（自分自身・Blueskyプロフィールでは表示しない。フォロー中のときのみ表示）
  const showPostNotificationButton = !isMe && !isBlueskyProfile && isFollowing;
  const {
    enabled: isPostNotificationEnabled,
    isPending: isPostNotificationPending,
    toggle: togglePostNotification,
  } = usePostNotificationSubscription(showPostNotificationButton ? user.id : undefined);
  const [isSubscriptionOpen, setIsSubscriptionOpen] = useState(false);
  const [isAvatarOpen, setIsAvatarOpen] = useState(false);
  const [isCoverOpen, setIsCoverOpen] = useState(false);
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [isLinkCopied, setIsLinkCopied] = useState(false);
  const [isBlueskyAdded, setIsBlueskyAdded] = useState(() =>
    (user.id.startsWith('misskey-user:') ? configuredMisskeyHandles(false) : getConfiguredBlueskyHandles()).includes(normalizeBlueskyHandle(user.username)),
  );
  useEffect(() => {
    setIsBlueskyAdded((user.id.startsWith('misskey-user:') ? configuredMisskeyHandles(false) : getConfiguredBlueskyHandles()).includes(normalizeBlueskyHandle(user.username)));
  }, [user.username]);
  useEffect(() => {
    if (!isSubscriptionOpen && !isAvatarOpen && !isCoverOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (isAvatarOpen) {
        setIsAvatarOpen(false);
        return;
      }
      if (isCoverOpen) {
        setIsCoverOpen(false);
        return;
      }
      setIsSubscriptionOpen(false);
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSubscriptionOpen, isAvatarOpen, isCoverOpen]);
  useEffect(() => {
    if (isSubscriptionOpen) setMembershipError(null);
  }, [isSubscriptionOpen]);
  // --- 「もっと見る」メニュー: リンクをコピーする関数 ---
  const handleCopyLink = async () => {
    if (typeof window === 'undefined') return;
    try {
      await navigator.clipboard.writeText(window.location.href);
      setIsLinkCopied(true);
      window.setTimeout(() => setIsLinkCopied(false), 2200);
    } catch (error) {
      console.error('リンクのコピーに失敗しました', error);
    }
  };
  // --- 「もっと見る」メニュー: リンクを共有する関数 ---
  const handleShareLink = async () => {
    if (typeof window === 'undefined') return;
    const shareUrl = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: user.displayName,
          url: shareUrl,
        });
      } catch (error) {
        // ユーザーが共有をキャンセルした場合は何もしない
        if ((error as Error)?.name !== 'AbortError') {
          console.error('リンクの共有に失敗しました', error);
        }
      }
    } else {
      await handleCopyLink();
    }
  };
  // --- メンバーシップ: 加入する ---
  const handleJoinMembership = () => {
    setMembershipError(null);
    joinMembership.mutate(undefined, {
      onSuccess: () => setIsSubscriptionOpen(false),
      onError: (error) => {
        setMembershipError(error instanceof Error ? error.message : '加入に失敗しました。もう一度お試しください。');
      },
    });
  };
  // --- メンバーシップ: 解除する ---
  const handleLeaveMembership = () => {
    setMembershipError(null);
    leaveMembership.mutate(undefined, {
      onSuccess: () => setIsSubscriptionOpen(false),
      onError: (error) => {
        setMembershipError(error instanceof Error ? error.message : '解除に失敗しました。もう一度お試しください。');
      },
    });
  };
  const handleToggleBlueskyUser = () => {
    const handle = normalizeBlueskyHandle(user.username);
    if (!handle) return;
    if (user.id.startsWith('misskey-user:')) {
      const current=configuredMisskeyHandles(false).filter(handle=>handle!=='misskey.io');
      const next=isBlueskyAdded ? current.filter(item=>item!==handle) : [...current,handle];
      changeMisskeySetting(MISSKEY_HANDLES_KEY,next);setIsBlueskyAdded(!isBlueskyAdded);return;
    }
    const configured = getConfiguredBlueskyHandles();
    const saved = saveConfiguredBlueskyHandles(
      isBlueskyAdded
        ? configured.filter((item) => item !== handle)
        : [...configured, handle],
    );
    setIsBlueskyAdded(saved.includes(handle));
  };
  // --- ベルボタン: 新しい投稿の通知をON/OFFする ---
  // iOSでは通知許可のダイアログをタップ直後に出す必要があるため、onClickから直接呼ぶ。
  const handleTogglePostNotification = async () => {
    const result = await togglePostNotification();

    // tsconfig の strict 設定に関係なく型が絞り込まれるよう、ok の真偽ではなく 'reason' の有無で判定する
    if (!('reason' in result)) {
      toast(
        result.enabled
          ? `${user.displayName}さんの新しい投稿を通知します`
          : `${user.displayName}さんの投稿通知をオフにしました`,
      );
      return;
    }

    switch (result.reason) {
      case 'login':
        toast('ログインが必要です');
        break;
      case 'unsupported':
        toast('この端末・ブラウザでは通知を利用できません。Safariの共有メニューからホーム画面に追加し、LimeNoteアプリをインストールしてください！');
        break;
      case 'denied':
        toast('通知がブロックされています。端末設定でLimeNoteの通知を許可してください。');
        break;
      case 'push-failed':
        toast('通知の設定に失敗しました。もう一度お試しください。');
        break;
      default:
        toast('投稿通知の切り替えに失敗しました。もう一度お試しください。');
        break;
    }
  };
  // 数値をフォーマットする関数
  const formatDisplayCount = (count: number) => {
    if (count >= 10000) {
      return (count / 10000).toFixed(1).replace(/\.0$/, '') + '万';
    }
    return count.toLocaleString();
  };
  // --- URLをリンク化する関数 ---
  const renderContentWithLinks = (text: string) => {
    if (!text) return null;
    // URLを検知する正規表現
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    return parts.map((part, index) => {
      if (part.match(urlRegex)) {
        return (
          <a
            key={`link-${index}`}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-pink-500 transition-colors hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        );
      }
      return part;
    });
  };
  // --- メンションをリンク化する関数 ---
  const renderContentWithMentions = (text: string) => {
    if (!text) return null;
    // @username 形式にマッチさせる正規表現
    const parts = splitMentionText(text);
    return parts.map((part, index) => {
      if (part.startsWith('@')) {
        const username = mentionProfileHandle(part,user);
        return (
          <Link
            key={`mention-${index}`}
            to={`/u/${username}`}
            className="text-pink-500 transition-colors hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </Link>
        );
      }
      // メンション以外のテキストに対してハッシュタグ処理を適用
      return renderContentWithHashtags(part);
    });
  };
  // --- ハッシュタグをリンク化する関数 ---
  const renderContentWithHashtags = (text: string) => {
    if (!text) return null;
    // #ハッシュタグ 形式にマッチさせる正規表現（日本語含む、文末や区切り文字を考慮）
    const parts = text.split(/(#[^\s#　.,!?:;'"()\[\]{}<>]+)/g);
    return parts.map((part, index) => {
      if (part.startsWith('#')) {
        return (
          <button
            key={`hashtag-${index}`}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // 検索ページに「#タグ名」で遷移。
              navigate(`/search?q=${encodeURIComponent(part)}`);
            }}
            className="inline-block align-baseline text-pink-500 transition-colors hover:underline"
          >
            {part}
          </button>
        );
      }
      // ハッシュタグ以外のテキストに対してURLリンク処理を適用
      return renderContentWithLinks(part);
    });
  };
  return (
    <>
      <style>{`
        @media (max-width: 639px) {
          .profile-header-mobile-cover-to-top {
            margin-top: -1.5rem !important;
          }
          .profile-header-cover-avatar-gap {
            -webkit-mask-image: radial-gradient(circle 48px at 64px 150px, transparent 47.5px, #000 48px);
            mask-image: radial-gradient(circle 48px at 64px 150px, transparent 47.5px, #000 48px);
          }
        }
        @media (min-width: 640px) {
          .profile-header-cover-avatar-gap {
            -webkit-mask-image: radial-gradient(circle 56px at 80px 192px, transparent 55.5px, #000 56px);
            mask-image: radial-gradient(circle 56px at 80px 192px, transparent 55.5px, #000 56px);
          }
        }
      `}</style>
      <section
        data-lime-profile-header
        data-lime-mobile-profile-cover-top={liftCoverToMobileTop ? 'true' : undefined}
        className={`relative left-1/2 ${liftCoverToMobileTop ? 'profile-header-mobile-cover-to-top -mt-0' : '-mt-0'} w-screen -translate-x-1/2 overflow-hidden bg-transparent text-foreground sm:left-auto sm:mt-0 sm:w-auto sm:translate-x-0 sm:rounded-3xl sm:border sm:border-border/60 sm:bg-card sm:shadow-soft`}
      >
      <div className="profile-header-cover-avatar-gap relative h-[150px] w-full overflow-hidden bg-gradient-cream sm:h-48">
        <button
          type="button"
          aria-label={`${user.displayName}のヘッダー画像を拡大表示`}
          onClick={() => setIsCoverOpen(true)}
          className="absolute inset-0 z-0 h-full w-full cursor-pointer border-0 bg-transparent p-0"
        >
          {user.coverUrl ? (
            <img
              src={user.coverUrl}
              alt=""
              className="block h-full w-full object-cover object-center"
            />
          ) : (
            <div className="h-full w-full bg-gradient-cream" />
          )}
        </button>
        {/*
          修正: 以前はカバー画像全体に bg-background/20〜card/40 のグラデーションを
          かけていたため、ダークテーマ時に --background / --card が黒に近い色だと
          ヘッダー全体が不自然に暗く見えるバグがあった。
          モバイルの戻る・検索・もっと見るボタンの視認性確保が目的なので、
          固定の黒(rgba)を使い、上部のみ・薄めに限定して不要な暗さを解消。
        */}
        <div data-lime-profile-cover-shade className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-20 bg-gradient-to-b from-black/35 to-transparent sm:hidden" />
        <div data-lime-profile-cover-controls className="pointer-events-none absolute inset-0 z-10 flex items-start justify-between px-3 pt-8 sm:hidden">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="戻る"
            className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="pointer-events-auto flex items-center gap-2">
            <Link
              to={`/search?q=${encodeURIComponent(`@${user.username}`)}`}
              aria-label="検索"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm"
            >
              <Search className="h-5 w-5" />
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="もっと見る"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm"
                >
                  <MoreHorizontal className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleCopyLink}>
                  <Link2 className="mr-2 h-4 w-4" />
                  リンクをコピー
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleShareLink}>
                  <Share2 className="mr-2 h-4 w-4" />
                  プロフィールを共有
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
      <div className="relative px-4 pb-4 sm:px-6 sm:pb-5">
        <div className="relative flex min-h-[52px] items-start justify-between gap-3">
          <button
            type="button"
            aria-label={`${user.displayName}のプロフィール画像を拡大表示`}
            onClick={() => setIsAvatarOpen(true)}
            className="-mt-[48px] box-border h-[96px] w-[96px] shrink-0 cursor-pointer rounded-full border-4 border-solid border-transparent bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:-mt-14 sm:h-28 sm:w-28"
          >
            <Avatar userId={user.id} className="h-full w-full overflow-hidden rounded-full bg-background shadow-none">
              <AvatarImage
                src={user.avatarUrl}
                alt={user.displayName}
                className="h-full w-full object-cover"
              />
              <AvatarFallback className="h-full w-full text-2xl font-black">
                {user.displayName.slice(0, 1)}
              </AvatarFallback>
            </Avatar>
          </button>
          <div className="mt-3 flex shrink-0 items-center">
            {showSubscriptionButton && (
              <Button
                type="button"
                onClick={() => setIsSubscriptionOpen(true)}
                className={`mr-2 rounded-full px-5 font-bold ${
                  isMember
                    ? 'bg-neutral-500 text-white hover:bg-neutral-600'
                    : 'bg-violet-600 text-white hover:bg-violet-700'
                }`}
              >
                {isMember ? '登録済み' : 'メンバー'}
              </Button>
            )}
            {showPostNotificationButton && (
              // FollowButton と同じ高さ(40px)・枠線色・文字色・フォーカス表現に揃えている。背景は透明。
              // フォロー中のときのみ表示される。
              <Button
                type="button"
                variant="ghost"
                onClick={handleTogglePostNotification}
                disabled={isPostNotificationPending}
                aria-pressed={isPostNotificationEnabled}
                aria-label={isPostNotificationEnabled ? '新しい投稿の通知をオフにする' : '新しい投稿を通知する'}
                className="mr-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-solid border-[#d9d9d9] bg-transparent p-0 text-[#111111] shadow-none transition-all duration-150 hover:bg-black/5 hover:text-[#111111] focus-visible:ring-2 focus-visible:ring-black/20 active:brightness-90 disabled:pointer-events-none disabled:opacity-60 dark:border-[#555555] dark:text-white dark:hover:bg-white/10 dark:hover:text-white dark:focus-visible:ring-white/20"
              >
                {isPostNotificationEnabled ? (
                  <BellCheckIcon />
                ) : (
                  <BellPlusIcon />
                )}
              </Button>
            )}
            {isBlueskyProfile ? (
              <Button
                type="button"
                onClick={handleToggleBlueskyUser}
                className={`rounded-full px-5 font-bold shadow-soft transition ${
                  isBlueskyAdded
                    ? 'bg-secondary text-secondary-foreground hover:bg-destructive/10 hover:text-destructive'
                    : 'bg-gradient-primary text-primary-foreground hover:shadow-pop'
                }`}
              >
                {isBlueskyAdded ? (
                  <><UserCheck className="mr-1.5 h-4 w-4" /> 追加済み</>
                ) : (
                  <><UserPlus className="mr-1.5 h-4 w-4" /> 追加する</>
                )}
              </Button>
            ) : isMe ? (
              <Button
                asChild
                variant="outline"
                className="h-9 rounded-full border-primary/40 px-4 text-sm font-bold text-primary hover:bg-primary-soft sm:h-10"
              >
                <Link to="/settings">プロフィールを編集</Link>
              </Button>
            ) : (
              <FollowButton userId={user.id} />
            )}
          </div>
        </div>
        <div className="mt-2 min-w-0">
          <div className="flex min-w-0 flex-col">
            {/* 名前が長すぎてもバッジを押し出さないよう min-w-0 を追加 */}
            <div className="flex min-w-0 items-center gap-1">
              <h1 className="min-w-0 truncate font-display text-[22px] font-black leading-tight text-foreground sm:text-2xl">
                {user.displayName}
              </h1>
              {user.isOfficial && (
                <img
                  src={`${import.meta.env.BASE_URL}verified.png`}
                  alt="Official"
                  className="h-[1.25em] w-[1.25em] shrink-0 translate-y-[1px]"
                  loading="eager"
                />
              )}
            </div>
            <p className="truncate text-[15px] leading-5 text-muted-foreground">
              @{user.username}
            </p>
          </div>
        </div>
        {user.bio && (
          <p className="mt-3 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-foreground">
            {renderContentWithMentions(user.bio)}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] leading-5 text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="h-4 w-4 shrink-0" />
            <span>{dayjs(user.createdAt).format('YYYY年M月')} から参加</span>
          </span>
          {user.location?.trim() && <span className="inline-flex min-w-0 max-w-full items-center gap-1.5" data-lime-profile-location>
            <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="break-words [overflow-wrap:anywhere]">{user.location}</span>
          </span>}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          {/* items-baseline に変更して数字とテキストの文字底を統一 */}
          <Link
            to={`/u/${user.username}/followers_following?tab=following`}
            className="group flex items-baseline gap-1 hover:no-underline"
          >
            <span className="font-display text-base font-bold tabular-nums text-foreground group-hover:underline">
              {formatDisplayCount(blueskyStats?.following ?? stats?.following ?? 0)}
            </span>
            <span className="text-muted-foreground">フォロー中</span>
          </Link>
          <Link
            to={`/u/${user.username}/followers_following?tab=followers`}
            className="group flex items-baseline gap-1 hover:no-underline"
          >
            <span className="font-display text-base font-bold tabular-nums text-foreground group-hover:underline">
              {formatDisplayCount(blueskyStats?.followers ?? stats?.followers ?? 0)}
            </span>
            <span className="text-muted-foreground">フォロワー</span>
          </Link>
          <div className="flex items-baseline gap-1" data-lime-profile-activity-count>
            <span className="font-display text-base font-bold tabular-nums text-foreground">
              {(isBlueskyProfile ? blueskyStats?.posts : activityCount) == null ? '—' : formatDisplayCount(isBlueskyProfile ? blueskyStats?.posts ?? 0 : activityCount ?? 0)}
            </span>
            <span className="text-muted-foreground">投稿</span>
          </div>
        </div>
      </div>
      </section>
      {isCoverOpen && typeof document !== 'undefined' && createPortal(
        <div
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setIsCoverOpen(false);
          }}
          className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/80 p-4 backdrop-blur-[2px]"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${user.displayName}のヘッダー画像`}
            onClick={(event) => {
              if (event.target === event.currentTarget) setIsCoverOpen(false);
            }}
            className="relative flex h-full w-full items-center justify-center"
          >
            <button
              type="button"
              onClick={() => setIsCoverOpen(false)}
              aria-label="閉じる"
              className="absolute left-2 top-2 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white shadow-soft backdrop-blur-sm transition hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 sm:left-4 sm:top-4"
            >
              <X className="h-6 w-6" />
            </button>
            <div
              className="flex max-h-[82vh] max-w-[92vw] items-center justify-center overflow-hidden rounded-2xl bg-background shadow-[0_24px_90px_rgba(0,0,0,0.6)]"
              onClick={(event) => event.stopPropagation()}
            >
              {user.coverUrl ? (
                <img
                  src={user.coverUrl}
                  alt={user.displayName}
                  className="block max-h-[82vh] max-w-[92vw] object-contain"
                />
              ) : (
                <div className="flex h-[min(48vh,320px)] w-[min(92vw,960px)] items-center justify-center bg-gradient-cream text-lg font-bold text-foreground">
                  ヘッダー画像がありません
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
      {isAvatarOpen && typeof document !== 'undefined' && createPortal(
        <div
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setIsAvatarOpen(false);
          }}
          className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/80 p-4 backdrop-blur-[2px]"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${user.displayName}のプロフィール画像`}
            onClick={(event) => {
              if (event.target === event.currentTarget) setIsAvatarOpen(false);
            }}
            className="relative flex h-full w-full items-center justify-center"
          >
            <button
              type="button"
              onClick={() => setIsAvatarOpen(false)}
              aria-label="閉じる"
              className="absolute left-2 top-2 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white shadow-soft backdrop-blur-sm transition hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 sm:left-4 sm:top-4"
            >
              <X className="h-6 w-6" />
            </button>
            <div
              className="flex h-[min(82vw,82vh)] w-[min(82vw,82vh)] max-h-[680px] max-w-[680px] items-center justify-center overflow-hidden rounded-full bg-background shadow-[0_24px_90px_rgba(0,0,0,0.6)]"
              onClick={(event) => event.stopPropagation()}
            >
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.displayName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-background text-[clamp(5rem,18vw,10rem)] font-black text-foreground">
                  {user.displayName.slice(0, 1)}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
      {isSubscriptionOpen && typeof document !== 'undefined' && createPortal(
        <div
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setIsSubscriptionOpen(false);
          }}
          className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/70 p-0 sm:p-3"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="subscription-dialog-title"
            onClick={(event) => event.stopPropagation()}
            className="relative flex h-[100dvh] w-screen max-h-none max-w-none flex-col overflow-hidden rounded-none text-white shadow-[0_24px_80px_rgba(0,0,0,0.55)] sm:h-[min(82vh,680px)] sm:w-[min(92vw,520px)] sm:max-h-[680px] sm:max-w-[520px] sm:rounded-[22px]"
            style={{ background: 'linear-gradient(180deg, #c92fd0 0%, #c92fd0 34%, #15151b 70%, #050506 100%)', boxSizing: 'border-box' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56, padding: '0 12px', flexShrink: 0 }}>
              <button type="button" onClick={() => setIsSubscriptionOpen(false)} aria-label="閉じる" style={{ width: 40, height: 40, border: 0, background: 'transparent', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X className="h-6 w-6" />
              </button>
              <button type="button" onClick={handleCopyLink} aria-label="リンクをコピー" style={{ width: 40, height: 40, border: 0, background: 'transparent', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Link2 className="h-5 w-5" />
              </button>
            </div>
            {isLinkCopied && (
              <div role="status" aria-live="polite" style={{ position: 'absolute', top: 58, left: '50%', transform: 'translateX(-50%)', zIndex: 2, borderRadius: 999, background: 'rgba(25,25,28,0.96)', padding: '8px 14px', fontSize: 13, fontWeight: 800, color: '#fff', whiteSpace: 'nowrap', boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>リンクをコピーしました</div>
            )}
            <div style={{ minHeight: 0, overflowY: 'auto', padding: '8px 16px 16px', flex: '1 1 auto', boxSizing: 'border-box' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                <Avatar userId={user.id} className="h-20 w-20 border-2 border-white/90 shadow-xl">
                  <AvatarImage src={user.avatarUrl} alt={user.displayName} className="h-full w-full object-cover" />
                  <AvatarFallback className="h-full w-full bg-white/10 text-4xl font-black text-white">{user.displayName.slice(0, 1)}</AvatarFallback>
                </Avatar>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 }}>
                  <h3 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>{user.displayName}</h3>
                </div>
                <p style={{ margin: '6px 0 0', fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.92)' }}>
                  {isMember ? '現在メンバーです' : 'メンバ未加入'}
                </p>
                <div style={{ width: '100%', marginTop: 16, borderRadius: 18, background: '#000', padding: '18px 18px', textAlign: 'left', boxSizing: 'border-box' }}>
                  <h4 style={{ margin: 0, fontSize: 21, fontWeight: 900 }}>メンバーになるメリット</h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 999, background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Radio className="h-5 w-5 text-white/80" /></div>
                    <span style={{ fontSize: 18, fontWeight: 600 }}>独占ポスト</span>
                  </div>
                  <div style={{ height: 1, width: '100%', background: 'rgba(255,255,255,0.18)', margin: '18px 0' }} />
                  <h4 style={{ margin: 0, fontSize: 21, fontWeight: 900 }}>さらに....？</h4>
                  <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.65, fontWeight: 600, color: 'rgba(255,255,255,0.58)' }}>メンバーになると、限定コンテンツを楽しんだり、メンバー限定の特典を受け取れます。</p>
                </div>
              </div>
            </div>
            <div style={{ flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.12)', background: '#000', padding: '10px 16px 14px', boxSizing: 'border-box' }}>
              {membershipError && (
                <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 600, color: '#ff9d9d', textAlign: 'center' }}>{membershipError}</p>
              )}
              {isMember ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full rounded-full border-white/30 bg-transparent px-6 text-base font-black text-white hover:bg-white/10 disabled:opacity-60"
                  onClick={handleLeaveMembership}
                  disabled={leaveMembership.isPending}
                >
                  {leaveMembership.isPending ? '解除中...' : 'メンバーを解除する'}
                </Button>
              ) : (
                <Button
                  type="button"
                  className="h-11 w-full rounded-full bg-fuchsia-500 px-6 text-base font-black text-white shadow-soft transition hover:bg-fuchsia-600 hover:shadow-pop disabled:opacity-60"
                  onClick={handleJoinMembership}
                  disabled={joinMembership.isPending}
                >
                  {joinMembership.isPending ? '加入中...' : '無料で加入する'}
                </Button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}