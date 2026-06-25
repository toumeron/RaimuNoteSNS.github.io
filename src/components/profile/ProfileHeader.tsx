import { CalendarDays } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { FollowButton } from './FollowButton';
import { useFollowStats } from '@/hooks/useProfile';
import { useAuth } from '@/hooks/useAuth';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import type { User } from '@/types';

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

export function ProfileHeader({ user }: { user: User }) {
  const { user: me } = useAuth();
  const { data: stats } = useFollowStats(user.id);
  const isMe = me?.id === user.id;
  const navigate = useNavigate();
  const location = useLocation();
  const liftCoverToMobileTop = isGithubPagesProfilePath(location.pathname);

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
    const parts = text.split(/(@\w+)/g);

    return parts.map((part, index) => {
      if (part.startsWith('@')) {
        const username = part.substring(1);

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
            -webkit-mask-image: radial-gradient(circle 44px at 60px 150px, transparent 43.5px, #000 44px);
            mask-image: radial-gradient(circle 44px at 60px 150px, transparent 43.5px, #000 44px);
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
        data-lime-mobile-profile-cover-top={liftCoverToMobileTop ? 'true' : undefined}
        className={`relative left-1/2 ${liftCoverToMobileTop ? 'profile-header-mobile-cover-to-top -mt-6' : '-mt-5'} w-screen -translate-x-1/2 overflow-hidden bg-transparent text-foreground sm:left-auto sm:mt-0 sm:w-auto sm:translate-x-0 sm:rounded-3xl sm:border sm:border-border/60 sm:bg-card sm:shadow-soft`}
      >
      <div className="profile-header-cover-avatar-gap relative h-[150px] w-full overflow-hidden bg-gradient-cream sm:h-48">
        {user.coverUrl ? (
          <img
            src={user.coverUrl}
            alt=""
            className="block h-full w-full object-cover object-center"
          />
        ) : (
          <div className="h-full w-full bg-gradient-cream" />
        )}

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/20 to-transparent sm:from-card/40" />
      </div>

      <div className="relative px-4 pb-4 sm:px-6 sm:pb-5">
        <div className="relative flex min-h-[52px] items-start justify-between gap-3">
          <div className="-mt-[44px] box-border h-[88px] w-[88px] shrink-0 rounded-full border-4 border-solid border-transparent bg-transparent sm:-mt-14 sm:h-28 sm:w-28">
            <Avatar className="h-full w-full overflow-hidden rounded-full bg-background">
              <AvatarImage
                src={user.avatarUrl}
                alt={user.displayName}
                className="h-full w-full object-cover"
              />
              <AvatarFallback className="h-full w-full text-2xl font-black">
                {user.displayName.slice(0, 1)}
              </AvatarFallback>
            </Avatar>
          </div>

          <div className="mt-3 flex shrink-0 items-center">
            {isMe ? (
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

        <div className="mt-3 flex items-center gap-1.5 text-[13px] leading-5 text-muted-foreground">
          <CalendarDays className="h-4 w-4 shrink-0" />
          <span>{dayjs(user.createdAt).format('YYYY年M月')} から参加</span>
        </div>

        <div className="mt-4 flex items-center gap-5 text-sm">
          {/* items-baseline に変更して数字とテキストの文字底を統一 */}
          <Link
            to={`/u/${user.username}/followers_following?tab=following`}
            className="group flex items-baseline gap-1 hover:no-underline"
          >
            <span className="font-display text-base font-bold tabular-nums text-foreground group-hover:underline">
              {stats ? formatDisplayCount(stats.following) : 0}
            </span>
            <span className="text-muted-foreground">フォロー中</span>
          </Link>

          <Link
            to={`/u/${user.username}/followers_following?tab=followers`}
            className="group flex items-baseline gap-1 hover:no-underline"
          >
            <span className="font-display text-base font-bold tabular-nums text-foreground group-hover:underline">
              {stats ? formatDisplayCount(stats.followers) : 0}
            </span>
            <span className="text-muted-foreground">フォロワー</span>
          </Link>
        </div>
      </div>
      </section>
    </>
  );
}
