import { useState, useEffect } from 'react';
import { CalendarDays } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { FollowButton } from './FollowButton';
import { useFollowStats } from '@/hooks/useProfile';
import { useAuth } from '@/hooks/useAuth';
import { Link, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import type { User } from '@/types';

export function ProfileHeader({ user }: { user: User }) {
  const { user: me } = useAuth();
  const { data: stats } = useFollowStats(user.id);
  const isMe = me?.id === user.id;
  const navigate = useNavigate();

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
            className="text-pink-500 hover:underline transition-colors"
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
            className="text-pink-500 hover:underline transition-colors"
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
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // 検索ページに「#タグ名」で遷移。
              navigate(`/search?q=${encodeURIComponent(part)}`);
            }}
            className="text-pink-500 hover:underline transition-colors inline-block align-baseline"
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
    <div className="overflow-hidden rounded-3xl border border-border/60 bg-card shadow-soft">
      <div className="relative h-40 bg-gradient-cream sm:h-48">
        {user.coverUrl && (
          <img src={user.coverUrl} alt="" className="h-full w-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-card/40 to-transparent" />
      </div>

      <div className="relative px-5 pb-5 sm:px-6">
        <div className="-mt-12 flex items-end justify-between gap-3 sm:-mt-14">
          <Avatar className="h-24 w-24 border-4 border-card sm:h-28 sm:w-28">
            <AvatarImage src={user.avatarUrl} alt={user.displayName} />
            <AvatarFallback>{user.displayName.slice(0, 1)}</AvatarFallback>
          </Avatar>
          {isMe ? (
            <Button asChild variant="outline" className="rounded-full border-primary/40 font-bold text-primary hover:bg-primary-soft">
              <Link to="/settings">プロフィールを編集</Link>
            </Button>
          ) : (
            <FollowButton userId={user.id} />
          )}
        </div>

        <div className="mt-3">
          <div className="flex flex-col">
            {/* 名前が長すぎてもバッジを押し出さないよう min-w-0 を追加 */}
            <div className="flex items-center gap-0.1 min-w-0">
              <h1 className="font-display text-2xl font-black text-foreground truncate min-w-0">
                {user.displayName}
              </h1>
              
              {user.isOfficial && (
                <img 
                  src={`${import.meta.env.BASE_URL}verified.png`} 
                  alt="Official" 
                  className="h-[1.4em] w-[1.4em] shrink-0 transform translate-y-[2px]"
                  loading="eager"
                />
              )}
            </div>

            <p className="text-[15px] text-muted-foreground truncate">@{user.username}</p>
          </div>
        </div>

        {user.bio && (
          <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed">
            {renderContentWithMentions(user.bio)}
          </p>
        )}

        <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" />
          {dayjs(user.createdAt).format('YYYY年M月')} から参加
        </div>

        <div className="mt-4 flex items-center gap-5 border-t border-border/60 pt-4 text-sm">
          {/* items-baseline に変更して数字とテキストの文字底を統一 */}
          <Link 
            to={`/u/${user.username}/followers_following?tab=following`}
            className="group flex items-baseline gap-1 hover:no-underline"
          >
            <span className="font-display text-base font-bold tabular-nums group-hover:underline">
              {stats ? formatDisplayCount(stats.following) : 0}
            </span>
            <span className="text-muted-foreground">フォロー中</span>
          </Link>
          <Link 
            to={`/u/${user.username}/followers_following?tab=followers`}
            className="group flex items-baseline gap-1 hover:no-underline"
          >
            <span className="font-display text-base font-bold tabular-nums group-hover:underline">
              {stats ? formatDisplayCount(stats.followers) : 0}
            </span>
            <span className="text-muted-foreground">フォロワー</span>
          </Link>
        </div>
      </div>
    </div>
  );
}