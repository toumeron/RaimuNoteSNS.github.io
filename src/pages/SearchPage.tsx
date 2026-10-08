import {searchMisskey,misskeyEnabled} from '@/lib/misskey';
import { openMediaViewer } from '@/components/media/openMediaViewer';
import { useAuth } from '@/hooks/useAuth';
import { getRecommendationPreferences } from '@/api/recommendations';
import {useQuery} from '@tanstack/react-query';
import type { RecommendationPreferences } from '@/lib/recommendations';
import { useTrends } from '@/hooks/useTrends';
import { useDesktopLayout } from '@/components/layout/DesktopLayoutContext';
import { SearchExploreContent } from '@/components/search/SearchExploreContent';
import { SearchExploreTabs } from '@/components/search/SearchExploreTabs';
import { SearchTabIndicator } from '@/components/search/SearchTabIndicator';
import { useSearchExploreTab } from '@/hooks/useSearchExploreTab';
import { getNewsSources, latestNewsPerSource, type SearchNewsItem, type NewsSources } from '@/api/search-news';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Search, X, Clock, Loader2, Play, Settings,
  AlertTriangle, ChevronLeft, ChevronRight, Heart,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PostCardSkeleton } from '@/components/feed/PostCardSkeleton';
import { PostCard } from '@/components/feed/PostCard';
import UserCard from '@/components/search/UserCard';
import { supabase } from '@/lib/supabase';
import { searchBluesky, searchExternalUsers } from '@/lib/bluesky';
import type { User, PostWithAuthor } from '@/types';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';


// ===========================================================================
// 検索コマンドのパーサ / マッチ判定 / 詳細検索フォーム変換
// ===========================================================================
// 検索コマンド(Twitter/X風)のパーサと、投稿へのマッチ判定・詳細検索フォームとの相互変換。
//
// 対応コマンド
//   "フレーズ"            完全一致(空白を含む語句)
//   A OR B               どちらかを含む(ORは大文字)
//   -単語 / -"フレーズ"   除外
//   from:ユーザー名       そのアカウントの投稿      (-from: で除外)
//   to:ユーザー名         そのアカウント宛て(@ユーザー名 を含む投稿)
//   since:日付 / after:   その日以降(その日を含む)   例 2025-01-01 / 7d / today / yesterday
//   until:日付 / before:  その日まで(その日を含む)
//   min_faves:N / min_likes:N        いいね N 以上   (max_faves: / max_likes: は以下)
//   min_retweets:N / min_reposts:N   リポスト N 以上
//   filter:media|images|videos|links (has: でも可)   -filter:〜 で除外
//   source:lime | source:bluesky     検索対象の絞り込み

// ---------------------------------------------------------------------------
// タブ
// ---------------------------------------------------------------------------
export type SearchTab = 'top' | 'latest' | 'users' | 'media';

export const SEARCH_TABS: Array<{ value: SearchTab; label: string }> = [
  { value: 'top', label: '話題' },
  { value: 'latest', label: '最新' },
  { value: 'users', label: 'ユーザー' },
  { value: 'media', label: 'メディア' },
];

// 旧バージョンが保存していた 'posts' / 'users' も読み替える。
export function normalizeStoredSearchTab(value: string | null | undefined): SearchTab {
  if (value === 'top' || value === 'latest' || value === 'users' || value === 'media') return value;
  if (value === 'posts') return 'latest';
  return 'top';
}

// ---------------------------------------------------------------------------
// 文字列の正規化(全角半角・大小文字・カタカナ/ひらがなの差を吸収)
// ---------------------------------------------------------------------------
const kataToHira = (s: string) =>
  s.replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

export const normalizeText = (s: string): string => {
  if (!s) return '';
  return kataToHira(s.normalize('NFKC').toLowerCase());
};

// ---------------------------------------------------------------------------
// パース結果
// ---------------------------------------------------------------------------
export type MediaFilter = 'any' | 'image' | 'video';
export type SearchSource = 'all' | 'lime' | 'bluesky' | 'misskey';

export interface SearchChip {
  label: string;
  tokens: string[]; // クエリから取り除くときに使う元のトークン
}

export interface ParsedSearch {
  raw: string;
  terms: string[];
  phrases: string[];
  orGroups: string[][];
  excludes: string[];
  from: string[];
  notFrom: string[];
  bareHandle: string | null; // クエリ全体が "@handle" だけのとき
  since: Date | null;
  until: Date | null;
  minLikes: number | null;
  maxLikes: number | null;
  minReposts: number | null;
  media: MediaFilter | null;
  excludeImage: boolean;
  excludeVideo: boolean;
  hasLink: boolean;
  excludeLink: boolean;
  source: SearchSource;
  chips: SearchChip[];
  warnings: string[];
}

const OPERATOR_KEYS = new Set([
  'from', 'to', 'since', 'after', 'until', 'before',
  'min_faves', 'min_likes', 'min_retweets', 'min_reposts',
  'max_faves', 'max_likes', 'filter', 'has', 'source',
]);

export function tokenizeSearchQuery(raw: string): string[] {
  return raw.match(/-?"[^"]*"?|[^\s\u3000]+/g) ?? [];
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function parseDateValue(value: string): Date | null {
  const s = value.trim().toLowerCase();
  if (!s) return null;
  const today = startOfDay(new Date());

  if (s === 'today') return today;
  if (s === 'yesterday') {
    today.setDate(today.getDate() - 1);
    return today;
  }

  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const date = new Date(y, mo - 1, d);
    if (date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d) return date;
    return null;
  }

  // 7d = 7日前 / 2w = 2週間前 / 3m = 3か月前 / 1y = 1年前
  m = s.match(/^(\d{1,4})([dwmy])$/);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    if (unit === 'd') today.setDate(today.getDate() - n);
    else if (unit === 'w') today.setDate(today.getDate() - n * 7);
    else if (unit === 'm') today.setMonth(today.getMonth() - n);
    else today.setFullYear(today.getFullYear() - n);
    return today;
  }

  return null;
}

const toDateInput = (d: Date) => {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

export const getSinceISO = (p: ParsedSearch): string | null => (p.since ? p.since.toISOString() : null);

// until は「その日を含む」ので、翌日0時(排他)を返す。
export const getUntilExclusiveISO = (p: ParsedSearch): string | null => {
  if (!p.until) return null;
  const next = new Date(p.until.getFullYear(), p.until.getMonth(), p.until.getDate() + 1);
  return next.toISOString();
};

const createEmptyParsed = (raw: string): ParsedSearch => ({
  raw,
  terms: [],
  phrases: [],
  orGroups: [],
  excludes: [],
  from: [],
  notFrom: [],
  bareHandle: null,
  since: null,
  until: null,
  minLikes: null,
  maxLikes: null,
  minReposts: null,
  media: null,
  excludeImage: false,
  excludeVideo: false,
  hasLink: false,
  excludeLink: false,
  source: 'all',
  chips: [],
  warnings: [],
});

const parseCount = (value: string): number | null => {
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function applyOperator(p: ParsedSearch, key: string, value: string, neg: boolean, token: string) {
  if (!value) return; // 入力途中の "from:" などは無視する
  const chip = { label: token, tokens: [token] };
  const warn = (msg: string) => p.warnings.push(`${token} ${msg}`);

  switch (key) {
    case 'from': {
      const name = value.replace(/^@+/, '').toLowerCase();
      if (!name) return;
      (neg ? p.notFrom : p.from).push(name);
      p.chips.push(chip);
      return;
    }
    case 'since':
    case 'after':
    case 'until':
    case 'before': {
      if (neg) return warn('は否定できません');
      const date = parseDateValue(value);
      if (!date) return warn('は日付として認識できません(例: 2025-01-31 / 7d / today)');
      if (key === 'since' || key === 'after') p.since = date;
      else p.until = date;
      p.chips.push(chip);
      return;
    }
    case 'min_faves':
    case 'min_likes':
    case 'max_faves':
    case 'max_likes':
    case 'min_retweets':
    case 'min_reposts': {
      if (neg) return warn('は否定できません');
      const n = parseCount(value);
      if (n === null) return warn('は数値で指定してください');
      if (key === 'min_faves' || key === 'min_likes') p.minLikes = n;
      else if (key === 'max_faves' || key === 'max_likes') p.maxLikes = n;
      else p.minReposts = n;
      p.chips.push(chip);
      return;
    }
    case 'filter':
    case 'has': {
      const v = value.toLowerCase();
      if (v === 'media') {
        if (neg) { p.excludeImage = true; p.excludeVideo = true; } else p.media = 'any';
      } else if (['image', 'images', 'photo', 'photos'].includes(v)) {
        if (neg) p.excludeImage = true; else p.media = 'image';
      } else if (['video', 'videos', 'youtube'].includes(v)) {
        if (neg) p.excludeVideo = true; else p.media = 'video';
      } else if (['link', 'links', 'url'].includes(v)) {
        if (neg) p.excludeLink = true; else p.hasLink = true;
      } else {
        return warn('は未対応です(media / images / videos / links)');
      }
      p.chips.push(chip);
      return;
    }
    case 'source': {
      const v = value.toLowerCase();
      if (neg) return warn('は否定できません');
      if (v === 'lime' || v === 'local' || v === 'limenote') p.source = 'lime';
      else if (v === 'bluesky' || v === 'bsky') p.source = 'bluesky';
      else if (v === 'misskey') p.source = 'misskey';
      else return warn('は未対応です(lime / bluesky / misskey)');
      p.chips.push(chip);
      return;
    }
    default:
      return;
  }
}

export function parseSearchQuery(raw: string): ParsedSearch {
  const p = createEmptyParsed(raw);
  const tokens = tokenizeSearchQuery(raw.trim());

  if (tokens.length === 1 && /^@[^\s:"]+$/.test(tokens[0])) {
    p.bareHandle = tokens[0].slice(1);
    return p;
  }

  type Item = { value: string; phrase: boolean; token: string; orWithPrev: boolean };
  const items: Item[] = [];
  let pendingOr = false;

  for (const token of tokens) {
    if (token === 'OR') {
      if (items.length > 0) pendingOr = true;
      continue;
    }

    const neg = token.length > 1 && token.startsWith('-');
    const body = neg ? token.slice(1) : token;

    if (body.startsWith('"')) {
      const phrase = body.replace(/^"/, '').replace(/"$/, '').trim();
      if (!phrase) continue;
      if (neg) {
        p.excludes.push(phrase);
        p.chips.push({ label: `-"${phrase}"`, tokens: [token] });
      } else {
        items.push({ value: phrase, phrase: true, token, orWithPrev: pendingOr });
        pendingOr = false;
      }
      continue;
    }

    const m = body.match(/^([A-Za-z_]+):(.*)$/);
    if (m && OPERATOR_KEYS.has(m[1].toLowerCase())) {
      const key = m[1].toLowerCase();
      const value = m[2].trim();
      pendingOr = false;

      if (key === 'to') {
        const name = value.replace(/^@+/, '');
        if (!name) continue;
        if (neg) p.excludes.push(`@${name}`);
        else items.push({ value: `@${name}`, phrase: false, token, orWithPrev: false });
        p.chips.push({ label: token, tokens: [token] });
        continue;
      }

      applyOperator(p, key, value, neg, token);
      continue;
    }

    if (neg) {
      p.excludes.push(body);
      p.chips.push({ label: token, tokens: [token] });
      continue;
    }

    items.push({ value: body, phrase: false, token, orWithPrev: pendingOr });
    pendingOr = false;
  }

  // ORで繋がった連続項目を1グループにまとめる
  const groups: Item[][] = [];
  for (const item of items) {
    if (item.orWithPrev && groups.length > 0) groups[groups.length - 1].push(item);
    else groups.push([item]);
  }

  for (const group of groups) {
    if (group.length === 1) {
      (group[0].phrase ? p.phrases : p.terms).push(group[0].value);
    } else {
      p.orGroups.push(group.map((g) => g.value));
      p.chips.push({
        label: group.map((g) => (g.phrase ? `"${g.value}"` : g.value)).join(' OR '),
        tokens: group.flatMap((g, i) => (i === 0 ? [g.token] : ['OR', g.token])),
      });
    }
  }

  // フレーズは検索意図が分かりやすいようチップにも表示する
  for (const item of items) {
    if (item.phrase && !groups.some((g) => g.length > 1 && g.includes(item))) {
      p.chips.push({ label: `"${item.value}"`, tokens: [item.token] });
    }
  }

  return p;
}

// チップ(コマンド1個分)をクエリ文字列から取り除く
// 修正: 以前は各トークンを「最初に見つかった1個」だけ削除していたため、
// "a OR b c OR d" のようにORが複数あるとき、別のグループの "OR" を消してしまっていた。
// チップのトークン列が連続して並んでいる位置を探し、その範囲だけを取り除く。
export function removeChipFromQuery(raw: string, chip: SearchChip): string {
  const tokens = tokenizeSearchQuery(raw);
  const n = chip.tokens.length;

  let start = -1;
  for (let i = 0; i + n <= tokens.length; i += 1) {
    if (chip.tokens.every((t, k) => tokens[i + k] === t)) {
      start = i;
      break;
    }
  }

  if (start >= 0) {
    tokens.splice(start, n);
  } else {
    for (const t of chip.tokens) {
      const i = tokens.indexOf(t);
      if (i >= 0) tokens.splice(i, 1);
    }
  }
  return tokens.join(' ').trim();
}

// サジェストやユーザー検索など「コマンドを除いた検索語」だけが欲しい場面用。
export function getSearchFreeText(raw: string): string {
  const p = parseSearchQuery(raw);
  if (p.bareHandle) return `@${p.bareHandle}`;
  return [...p.terms, ...p.phrases, ...p.from].join(' ').trim();
}

// Bluesky の投稿検索に渡す語(演算子は渡さず、語句だけ)
export function getPostSearchText(p: ParsedSearch): string {
  if (p.bareHandle) return p.bareHandle;
  return [...p.terms, ...p.phrases].join(' ').trim();
}

// ---------------------------------------------------------------------------
// 投稿のメディア判定
// ---------------------------------------------------------------------------
const YOUTUBE_RE =
  /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^\s#]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/gi;

export function extractYouTubeIds(text: string): string[] {
  if (!text) return [];
  const ids: string[] = [];
  const re = new RegExp(YOUTUBE_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

// PostCard.tsx の imageUrlRegex と同一。
// PostCard は post.imageUrls だけでなく、本文中の画像URL(拡張子付きURL / Twitter画像)も
// 画像として表示するため、メディア判定でも同じものを画像として扱う。
const CONTENT_IMAGE_URL_RE =
  /https?:\/\/[^\s]+?\.(?:png|jpg|jpeg|gif|webp|svg)(?:\?[^\s]*)?|https?:\/\/pbs\.twimg\.com\/media\/[^\s?]+(?:\?[^\s]*)?/gi;

// サーバー側(ilike)で本文中の画像URLを大まかに拾うための断片。最終判定は getPostMedia で行う。
const CONTENT_IMAGE_URL_HINTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', 'pbs.twimg.com/media'];

export function getPostMedia(post: {
  id?: string | null;
  content?: string | null;
  imageUrls?: string[] | null;
  imageUrl?: string | null;
}): { images: string[]; youtubeIds: string[] } {
  const content = post.content || '';
  const youtubeIds = extractYouTubeIds(content);

  // Bluesky投稿にYouTubeリンクが含まれると、Bluesky側の外部リンクカードの
  // サムネイルが imageUrls に入ってくる。PostCard と同様に、その場合は画像として数えず
  // YouTube 埋め込みだけを対象にする。
  const isBlueskyPost = /^(bsky:|misskey:)/.test(String(post.id || ''));
  if (isBlueskyPost && youtubeIds.length > 0) {
    return { images: [], youtubeIds };
  }

  const ownImages = post.imageUrls && post.imageUrls.length > 0
    ? post.imageUrls
    : post.imageUrl
      ? [post.imageUrl]
      : [];
  const contentImages = content.match(CONTENT_IMAGE_URL_RE) || [];

  // PostCard と同じく、最大4枚まで
  const images = Array.from(new Set([...ownImages, ...contentImages].filter(Boolean))).slice(0, 4);
  return { images, youtubeIds };
}

// ---------------------------------------------------------------------------
// クライアント側でのマッチ判定(サーバー結果の最終絞り込み + Bluesky投稿の絞り込み)
// ---------------------------------------------------------------------------
export interface MatchOptions {
  trustServerTerms?: boolean; // 検索語自体はサーバー(Bluesky)側でヒット済みとみなす
  skipFrom?: boolean; // from/-from はサーバー側で絞り込み済み
}

export function postMatchesSearch(post: PostWithAuthor, p: ParsedSearch, opts: MatchOptions = {}): boolean {
  const content = normalizeText(post.content || '');
  const username = (post.author?.username || '').replace(/^@+/, '').toLowerCase();

  if (p.bareHandle && !opts.trustServerTerms) {
    const h = p.bareHandle.toLowerCase();
    if (!content.includes(normalizeText(`@${h}`)) && username !== h) return false;
  }

  if (!opts.trustServerTerms) {
    for (const t of p.terms) if (!content.includes(normalizeText(t))) return false;
    for (const t of p.phrases) if (!content.includes(normalizeText(t))) return false;
  }
  for (const group of p.orGroups) {
    if (!group.some((t) => content.includes(normalizeText(t)))) return false;
  }
  for (const ex of p.excludes) {
    if (content.includes(normalizeText(ex))) return false;
  }

  if (!opts.skipFrom) {
    if (p.from.length > 0 && !p.from.includes(username)) return false;
    if (p.notFrom.includes(username)) return false;
  }

  const time = new Date(post.createdAt).getTime();
  if (p.since && time < p.since.getTime()) return false;
  const untilISO = getUntilExclusiveISO(p);
  if (untilISO && time >= new Date(untilISO).getTime()) return false;

  const likes = post.likesCount || 0;
  if (p.minLikes !== null && likes < p.minLikes) return false;
  if (p.maxLikes !== null && likes > p.maxLikes) return false;
  if (p.minReposts !== null && (post.repostsCount || 0) < p.minReposts) return false;

  const { images, youtubeIds } = getPostMedia(post as any);
  const hasImage = images.length > 0;
  const hasVideo = youtubeIds.length > 0;
  if (p.media === 'any' && !hasImage && !hasVideo) return false;
  if (p.media === 'image' && !hasImage) return false;
  if (p.media === 'video' && !hasVideo) return false;
  if (p.excludeImage && hasImage) return false;
  if (p.excludeVideo && hasVideo) return false;

  const hasLink = /https?:\/\//i.test(post.content || '');
  if (p.hasLink && !hasLink) return false;
  if (p.excludeLink && hasLink) return false;

  return true;
}

// ---------------------------------------------------------------------------
// 詳細検索フォーム <-> クエリ文字列
// ---------------------------------------------------------------------------
export interface AdvancedForm {
  all: string;
  phrase: string;
  any: string;
  none: string;
  from: string;
  notFrom: string;
  since: string;
  until: string;
  media: '' | 'any' | 'image' | 'video' | 'none' | 'no-image' | 'no-video';
  link: '' | 'has' | 'none';
  minLikes: string;
  maxLikes: string;
  minReposts: string;
  source: '' | 'lime' | 'bluesky' | 'misskey';
}

export const EMPTY_FORM: AdvancedForm = {
  all: '', phrase: '', any: '', none: '', from: '', notFrom: '',
  since: '', until: '', media: '', link: '', minLikes: '', maxLikes: '',
  minReposts: '', source: '',
};

const quoteIfNeeded = (v: string) => (/\s/.test(v) ? `"${v}"` : v);

export function parseToForm(raw: string): AdvancedForm {
  const p = parseSearchQuery(raw);
  const extraPhrases = p.phrases.slice(1).map((x) => `"${x}"`);
  const extraGroups = p.orGroups.slice(1).map((g) => g.map(quoteIfNeeded).join(' OR '));

  let media: AdvancedForm['media'] = '';
  if (p.media) media = p.media;
  else if (p.excludeImage && p.excludeVideo) media = 'none';
  else if (p.excludeImage) media = 'no-image';
  else if (p.excludeVideo) media = 'no-video';

  return {
    all: [p.bareHandle ? `@${p.bareHandle}` : '', ...p.terms, ...extraPhrases, ...extraGroups]
      .filter(Boolean)
      .join(' '),
    phrase: p.phrases[0] ?? '',
    any: (p.orGroups[0] ?? []).map(quoteIfNeeded).join(' '),
    none: p.excludes.map(quoteIfNeeded).join(' '),
    from: p.from.join(' '),
    notFrom: p.notFrom.join(' '),
    since: p.since ? toDateInput(p.since) : '',
    until: p.until ? toDateInput(p.until) : '',
    media,
    link: p.hasLink ? 'has' : p.excludeLink ? 'none' : '',
    minLikes: p.minLikes !== null ? String(p.minLikes) : '',
    maxLikes: p.maxLikes !== null ? String(p.maxLikes) : '',
    minReposts: p.minReposts !== null ? String(p.minReposts) : '',
    source: p.source === 'all' ? '' : p.source,
  };
}

const cleanNumber = (v: string) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? String(n) : '';
};

export function formToQuery(f: AdvancedForm): string {
  const parts: string[] = [];

  if (f.all.trim()) parts.push(f.all.trim());
  if (f.phrase.trim()) parts.push(`"${f.phrase.trim().replace(/"/g, '')}"`);

  const anyTokens = tokenizeSearchQuery(f.any.trim());
  if (anyTokens.length >= 2) parts.push(anyTokens.join(' OR '));
  else if (anyTokens.length === 1) parts.push(anyTokens[0]);

  for (const w of tokenizeSearchQuery(f.none.trim())) {
    parts.push(`-${w.startsWith('-') ? w.slice(1) : w}`);
  }

  for (const u of f.from.split(/[\s,、]+/).filter(Boolean)) parts.push(`from:${u.replace(/^@+/, '')}`);
  for (const u of f.notFrom.split(/[\s,、]+/).filter(Boolean)) parts.push(`-from:${u.replace(/^@+/, '')}`);

  if (f.since) parts.push(`since:${f.since}`);
  if (f.until) parts.push(`until:${f.until}`);

  const minLikes = cleanNumber(f.minLikes);
  const maxLikes = cleanNumber(f.maxLikes);
  const minReposts = cleanNumber(f.minReposts);
  if (minLikes) parts.push(`min_faves:${minLikes}`);
  if (maxLikes) parts.push(`max_faves:${maxLikes}`);
  if (minReposts) parts.push(`min_retweets:${minReposts}`);

  const mediaMap: Record<string, string> = {
    any: 'filter:media',
    image: 'filter:images',
    video: 'filter:videos',
    none: '-filter:media',
    'no-image': '-filter:images',
    'no-video': '-filter:videos',
  };
  if (f.media) parts.push(mediaMap[f.media]);
  if (f.link === 'has') parts.push('filter:links');
  if (f.link === 'none') parts.push('-filter:links');
  if (f.source) parts.push(`source:${f.source}`);

  return parts.join(' ').trim();
}


// ===========================================================================
// 詳細検索パネル(PCの設定ポップアップ・モバイルHeaderで共通利用)
// ===========================================================================
interface SearchAdvancedPanelProps {
  excludeBluesky: boolean;
  onToggleExcludeBluesky: (value: boolean) => void;
}

export function SearchAdvancedPanel({
  excludeBluesky,
  onToggleExcludeBluesky,
}: SearchAdvancedPanelProps) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-[14px] text-zinc-900 hover:bg-black/[0.03] dark:text-white dark:hover:bg-white/5">
      <input
        type="checkbox"
        checked={excludeBluesky}
        onChange={(e) => onToggleExcludeBluesky(e.target.checked)}
        className="h-4 w-4 accent-primary"
      />
      <span>Blueskyの投稿を含めない</span>
    </label>
  );
}

// ===========================================================================
// メディアタブのグリッド + ライトボックス
// ===========================================================================
type MediaTile = {
  key: string;
  type: 'image' | 'youtube';
  src: string; // 画像URL or サムネイルURL
  youtubeId?: string;
  indexInPost: number;
  totalInPost: number;
  post: PostWithAuthor;
};

interface SearchMediaGridProps {
  posts: PostWithAuthor[];
  /** Bluesky由来の投稿ID(LimeNote内の投稿詳細へ遷移できないため) */
  blueskyIds: Set<string>;
}

const youtubeThumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

function SearchMediaGrid({ posts }: SearchMediaGridProps) {

  const tiles = useMemo<MediaTile[]>(() => {
    const result: MediaTile[] = [];
    const seen = new Set<string>();

    for (const post of posts) {
      const { images, youtubeIds } = getPostMedia(post as any);
      const total = images.length + youtubeIds.length;
      let index = 0;

      for (const src of images) {
        const key = `${post.id}:img:${src}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ key, type: 'image', src, indexInPost: index++, totalInPost: total, post });
      }
      for (const id of youtubeIds) {
        const key = `${post.id}:yt:${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ key, type: 'youtube', src: youtubeThumb(id), youtubeId: id, indexInPost: index++, totalInPost: total, post });
      }
    }
    return result;
  }, [posts]);


  return (
    <>
      <div className="grid grid-cols-3 gap-0.5 px-0.5 sm:gap-1 sm:px-0">
        {tiles.map((tile, index) => (
          <button
            key={tile.key}
            type="button"
            onClick={() => openMediaViewer({ url: tiles[index].src, post: tiles[index].post, media: tiles.filter(tile => tile.post.id === tiles[index].post.id).map(tile => ({ src: tile.src, type: tile.type, youtubeId: tile.youtubeId })) })}
            className="group relative aspect-square overflow-hidden bg-black/5 dark:bg-white/10"
            aria-label={tile.type === 'youtube' ? '動画を開く' : '画像を開く'}
          >
            <img
              src={tile.src}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
            />
            {tile.type === 'youtube' && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/20">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/65 text-white">
                  <Play className="h-5 w-5" fill="currentColor" />
                </span>
              </span>
            )}
            {tile.totalInPost > 1 && (
              <span className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {tile.indexInPost + 1}/{tile.totalInPost}
              </span>
            )}
          </button>
        ))}
      </div>

    </>
  );
}

// ===========================================================================
// 検索結果(話題 / 最新 / ユーザー / メディア)
// ===========================================================================
// ---------------------------------------------------------------------------
// PostgREST フィルタ文字列のヘルパー
// ---------------------------------------------------------------------------
// "," "(" ")" は or()/and() 内で構文上の意味を持つため、値はダブルクォートで囲む。
const quotePostgrestValue = (value: string) =>
  `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// ILIKE のワイルドカード(% と _)をエスケープして、入力文字そのものを検索する。
const escapeLikeWildcards = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);
const likePattern = (value: string) => `%${escapeLikeWildcards(value)}%`;
const orIlike = (value: string) => `content.ilike.${quotePostgrestValue(likePattern(value))}`;

// ---------------------------------------------------------------------------
// フィード状態
// ---------------------------------------------------------------------------
type FeedMode = 'top' | 'latest' | 'media';
type MediaKind = 'all' | 'image' | 'video';

interface FeedState {
  items: PostWithAuthor[];
  remaining:PostWithAuthor[];
  localHasMore:boolean;
  page: number;
  hasMore: boolean;
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

const EMPTY_FEED: FeedState = { items: [], remaining:[], localHasMore:true,page: 0, hasMore: true, loading: false, loaded: false, error: null };
const createFeeds = (): Record<FeedMode, FeedState> => ({
  top: EMPTY_FEED,
  latest: EMPTY_FEED,
  media: EMPTY_FEED,
});

const PAGE_SIZE = 20;
const MEDIA_PAGE_SIZE = 30;
// 修正: サーバー側の絞り込みだけでは条件に合う投稿を取り切れず(例: image_urls が空配列の
// テキスト投稿が「画像あり」として返ってくる)、クライアント側の最終絞り込みで0件になった
// ページが続くことがある。0件のページが続く場合は、この回数までまとめて次のページを読む。
const MAX_EMPTY_PAGE_SCAN = 8;

const timeOf = (p: PostWithAuthor) => new Date(p.createdAt).getTime();

function sortPosts(posts: PostWithAuthor[], mode: FeedMode): PostWithAuthor[] {
  const seen = new Set<string>();
  const unique = posts.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  return unique.sort(
    mode === 'top'
      ? (a, b) => (b.likesCount || 0) - (a.likesCount || 0) || timeOf(b) - timeOf(a)
      : (a, b) => timeOf(b) - timeOf(a),
  );
}

const withMediaKind = (p: ParsedSearch, kind: MediaKind): ParsedSearch => {
  if (kind === 'image') return { ...p, media: 'image' };
  if (kind === 'video') return { ...p, media: 'video' };
  return { ...p, media: p.media ?? 'any' };
};

const toUser = (u: any): User => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  avatarUrl: u.avatarUrl,
  coverUrl: u.coverUrl,
  createdAt: u.createdAt,
  bio: u.bio,
  isOfficial: false,
});

type BlueskyResult = { posts: any[]; users: any[] };

// ---------------------------------------------------------------------------
// 小さなUI部品
// ---------------------------------------------------------------------------
const RowSkeleton = () => (
  <div className="flex animate-pulse gap-3 border-b border-black/[0.03] bg-transparent px-4 py-3 dark:border-white/[0.05]">
    <div className="h-10 w-10 shrink-0 rounded-full bg-black/5 dark:bg-white/10" />
    <div className="flex-1 space-y-2 pt-1">
      <div className="h-3 w-1/3 rounded bg-black/5 dark:bg-white/10" />
      <div className="h-3 w-5/6 rounded bg-black/5 dark:bg-white/10" />
    </div>
  </div>
);

function EmptyHint({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mx-auto max-w-[450px] bg-transparent px-8 pb-8 pt-16 text-center">
      <h2 className="mb-2 break-words text-[26px] font-extrabold leading-tight text-[rgb(15,20,25)] dark:text-white">{title}</h2>
      <p className="text-[15px] text-[rgb(83,100,113)] dark:text-gray-400">{desc}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------
interface SearchResultsProps {
  searchQuery: string;
  activeTab: SearchTab;
  excludeBlueskyPosts: boolean;
  allUsers: User[];
  isUsersLoading: boolean;
  /** 同じ検索語でも再検索したいときに増やす */
  refreshKey: number;
  /** 条件チップの×で検索語が変わったときに呼ぶ */
  onChangeQuery: (query: string) => void;
}

function SearchResults({
  searchQuery,
  activeTab,
  excludeBlueskyPosts,
  allUsers,
  isUsersLoading,
  refreshKey,
  onChangeQuery,
}: SearchResultsProps) {
  const parsed = useMemo(() => parseSearchQuery(searchQuery), [searchQuery]);
  const keyBase = `${searchQuery}\u0000${excludeBlueskyPosts}\u0000${refreshKey}`;

  const [feeds, setFeeds] = useState<Record<FeedMode, FeedState>>(createFeeds);
  const feedsRef=useRef(feeds);
  feedsRef.current=feeds;
  const [feedsKey, setFeedsKey] = useState('');
  const [mediaKind, setMediaKind] = useState<MediaKind>('all');
  const [blueskyUsers, setBlueskyUsers] = useState<User[]>([]);

  const tokenRef = useRef<Record<FeedMode, number>>({ top: 0, latest: 0, media: 0 });
  const searchControllerRef=useRef(new AbortController());
  const blueskyCacheRef = useRef<Map<string, Promise<BlueskyResult>>>(new Map());
  const blueskyIdsRef = useRef<Set<string>>(new Set());
  const visibilityRef = useRef<Promise<{ conditions: string[]; currentUserId: string | null }> | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(()=>{
    searchControllerRef.current.abort();
    searchControllerRef.current=new AbortController();
    (Object.keys(tokenRef.current) as FeedMode[]).forEach(mode=>{tokenRef.current[mode]+=1;});
    blueskyCacheRef.current.clear();
    setFeeds(prev=>Object.fromEntries(Object.entries(prev).map(([mode,feed])=>[mode,{...feed,loading:false}])) as Record<FeedMode,FeedState>);
    return ()=>searchControllerRef.current.abort();
  },[keyBase,activeTab]);

  const usersById = useMemo(() => new Map(allUsers.map((u) => [u.id, u])), [allUsers]);
  const usersByUsername = useMemo(() => new Map(allUsers.map((u) => [u.username.toLowerCase(), u])), [allUsers]);

  // Bluesky検索は同じ検索語なら結果を使い回す(タブ切り替えで再リクエストしない)
  const getBluesky = useCallback((text: string, includePosts: boolean): Promise<BlueskyResult> => {
    const key = `${text}\u0000${includePosts}\u0000${parsed.source}\u0000${excludeBlueskyPosts}`;
    const cached = blueskyCacheRef.current.get(key);
    if (cached) return cached;

    const query=text.trim().replace(/^@+/, '');
    const jobs:Promise<BlueskyResult>[]=[];
    if (parsed.source!=='misskey' && !(includePosts && excludeBlueskyPosts)) jobs.push(searchBluesky(query,{includePosts,signal:searchControllerRef.current.signal}) as unknown as Promise<BlueskyResult>);
    if (parsed.source!=='bluesky' && misskeyEnabled()) jobs.push(searchMisskey(query,includePosts,searchControllerRef.current.signal) as unknown as Promise<BlueskyResult>);
    const signal=searchControllerRef.current.signal;
    const promise=Promise.allSettled(jobs).then(results=>{
      if(signal.aborted){blueskyCacheRef.current.delete(key);throw signal.reason;}
      return results.reduce<BlueskyResult>((merged,result)=>{
      if (result.status==='fulfilled') { merged.posts.push(...result.value.posts);merged.users.push(...result.value.users); }
      else {blueskyCacheRef.current.delete(key);console.warn('External search failed',result.reason);}
      return merged;
    },{posts:[],users:[]});});
    blueskyCacheRef.current.set(key, promise);
    return promise;
  }, [parsed.source,excludeBlueskyPosts]);

  // 公開範囲の条件(自分の投稿・自分をフォローしている人の限定公開投稿)。同じ検索の間は使い回す。
  const getVisibility = useCallback(() => {
    if (!visibilityRef.current) {
      visibilityRef.current = (async () => {
        // 修正: visibility が null の古い投稿も「全体公開」として扱う(PostCard と同じ扱い)
        const conditions = ['visibility.eq.public', 'visibility.is.null'];
        const {
          data: { user: currentUser },
        } = await supabase.auth.getUser();
        if (currentUser) {
          conditions.push(`user_id.eq.${currentUser.id}`);
          const { data: followedByData } = await supabase
            .from('follows')
            .select('follower_id')
            .eq('followee_id', currentUser.id);
          const ids = followedByData?.map((f: any) => f.follower_id) || [];
          // 修正: 以前は投稿の公開範囲を確認せずに user_id だけで判定していたため、
          // フォロー関係にある相手の「メンバー限定」投稿まで検索結果に混ざっていた。
          // 限定公開(following)の投稿だけを対象にする。
          if (ids.length > 0) conditions.push(`and(user_id.in.(${ids.join(',')}),visibility.eq.following)`);
        }
        return { conditions, currentUserId: currentUser?.id ?? null };
      })().catch((error) => {
        // 失敗した結果をキャッシュし続けると、以降の検索がすべて失敗してしまう
        visibilityRef.current = null;
        throw error;
      });
    }
    return visibilityRef.current;
  }, []);

  // ---- LimeNote(Supabase)の投稿取得 ----------------------------------------
  const fetchLocalPosts = useCallback(
    async (p: ParsedSearch, page: number, mode: FeedMode): Promise<{ items: PostWithAuthor[]; hasMore: boolean }> => {
      const empty = { items: [] as PostWithAuthor[], hasMore: false };
      if (p.source === 'bluesky' || p.source === 'misskey') return empty;

      const resolveIds = (names: string[]) =>
        names.map((n) => usersByUsername.get(n.toLowerCase())?.id).filter((id): id is string => !!id);

      let fromIds: string[] | null = null;
      if (p.from.length > 0) {
        fromIds = resolveIds(p.from);
        if (fromIds.length === 0) return empty; // 該当アカウントなし
      }
      const notFromIds = resolveIds(p.notFrom);
      const bareUser = p.bareHandle ? usersByUsername.get(p.bareHandle.toLowerCase()) : undefined;

      const { conditions, currentUserId } = await getVisibility();
      const pageSize = mode === 'media' ? MEDIA_PAGE_SIZE : PAGE_SIZE;
      const rangeFrom = page * pageSize;
      const rangeTo = rangeFrom + pageSize - 1;

      let q: any = supabase
        .from('posts')
        .select('id, content, image_urls, created_at, user_id, likes_count, reposts_count, visibility');

      const clauses: string[][] = [];

      for (const t of [...p.terms, ...p.phrases]) q = q.ilike('content', likePattern(t));
      for (const ex of p.excludes) q = q.not('content', 'ilike', likePattern(ex));
      for (const group of p.orGroups) clauses.push(group.map(orIlike));

      // "@handle" だけの検索は、メンション(本文一致) + そのユーザー本人の投稿
      if (p.bareHandle) {
        const cond = [orIlike(`@${p.bareHandle}`)];
        if (bareUser) cond.push(`user_id.eq.${bareUser.id}`);
        clauses.push(cond);
      }

      if (fromIds) q = q.in('user_id', fromIds);
      if (notFromIds.length > 0) q = q.not('user_id', 'in', `(${notFromIds.join(',')})`);

      const sinceISO = getSinceISO(p);
      const untilISO = getUntilExclusiveISO(p);
      if (sinceISO) q = q.gte('created_at', sinceISO);
      if (untilISO) q = q.lt('created_at', untilISO);

      if (p.minLikes !== null) q = q.gte('likes_count', p.minLikes);
      if (p.maxLikes !== null) q = q.lte('likes_count', p.maxLikes);
      if (p.minReposts !== null) q = q.gte('reposts_count', p.minReposts);

      // メディア(画像は image_urls、動画はYouTubeリンクの埋め込み)
      // ※ image_urls が空配列の投稿も "not null" に該当してしまうため、
      //   最終的な判定は下の postMatchesSearch(クライアント側)で行う。
      // 画像は image_urls のほか、本文中の画像URL(PostCard が表示するもの)も対象にする。
      const imageConds = ['image_urls.not.is.null', ...CONTENT_IMAGE_URL_HINTS.map(orIlike)];
      const videoConds = [orIlike('youtube.com'), orIlike('youtu.be')];
      if (p.media === 'any') {
        clauses.push([...imageConds, ...videoConds]);
      } else if (p.media === 'image') {
        clauses.push(imageConds);
      } else if (p.media === 'video') {
        clauses.push(videoConds);
      }
      if (p.excludeVideo) {
        q = q.not('content', 'ilike', likePattern('youtube.com')).not('content', 'ilike', likePattern('youtu.be'));
      }
      if (p.hasLink) q = q.ilike('content', likePattern('http'));
      if (p.excludeLink) q = q.not('content', 'ilike', likePattern('http'));

      // supabase-js の or() は呼ぶたびに別条件として AND で結合される。
      // (以前は全条件の直積を1つの or() に展開しており、条件が増えると上限エラーになっていた)
      q = q.or(conditions.join(','));
      for (const clause of clauses) q = q.or(clause.join(','));

      q =
        mode === 'top'
          ? q.order('likes_count', { ascending: false }).order('created_at', { ascending: false })
          : q.order('created_at', { ascending: false });

      const { data, error } = await q.range(rangeFrom, rangeTo).abortSignal(searchControllerRef.current.signal);
      if (error) throw error;
      const rows: any[] = data || [];

      // 自分のいいね/リポスト状態
      let myLikes: string[] = [];
      let myReposts: string[] = [];
      if (currentUserId && rows.length > 0) {
        const postIds = rows.map((r) => r.id);
        const [likesResult, repostsResult] = await Promise.all([
          supabase.from('likes').select('post_id').eq('user_id', currentUserId).in('post_id', postIds),
          supabase.from('reposts').select('post_id').eq('user_id', currentUserId).in('post_id', postIds),
        ]);
        if (likesResult.data) myLikes = likesResult.data.map((l: any) => l.post_id);
        if (repostsResult.data) myReposts = repostsResult.data.map((r: any) => r.post_id);
      }

      const formatted: PostWithAuthor[] = rows.map((row: any) => {
        const user = usersById.get(row.user_id);
        return {
          id: row.id,
          userId: row.user_id,
          authorId: row.user_id,
          // 修正: 画像のみの投稿は content が null のことがあり、PostCard 側で
          // content.match(...) が TypeError になって画面全体が落ちていた。
          content: row.content ?? '',
          imageUrl: row.image_urls?.[0] || null,
          imageUrls: row.image_urls || [],
          createdAt: row.created_at,
          likesCount: row.likes_count || 0,
          repostsCount: row.reposts_count || 0,
          commentsCount: 0,
          likedByMe: myLikes.includes(row.id),
          repostedByMe: myReposts.includes(row.id),
          visibility: row.visibility,
          author: {
            id: user?.id || row.user_id,
            username: user?.username || 'unknown',
            displayName: user?.displayName || 'User',
            avatarUrl: user?.avatarUrl || '',
            coverUrl: user?.coverUrl || '',
            createdAt: user?.createdAt || row.created_at,
            bio: user?.bio || '',
            isOfficial: user?.isOfficial || false,
          },
        } as PostWithAuthor;
      });

      return {
        items: formatted.filter((post) => postMatchesSearch(post, p, { skipFrom: true })),
        hasMore: rows.length === pageSize,
      };
    },
    [getVisibility, usersById, usersByUsername],
  );

  // ---- Bluesky の投稿取得(1ページ目だけ) ------------------------------------
  const fetchBlueskyPosts = useCallback(
    async (p: ParsedSearch): Promise<PostWithAuthor[]> => {
      if (p.source === 'lime') return [];
      const text = getPostSearchText(p);
      if (!text) return []; // 語句のない検索(演算子のみ)はLimeNoteだけを検索する

      const normalize=(result:BlueskyResult)=>{
        const posts=result.posts.map((post)=>({...post,repostsCount:0,repostedByMe:false,author:{...post.author,coverUrl:''}})) as PostWithAuthor[];
        posts.forEach(post=>blueskyIdsRef.current.add(post.id));
        return posts.filter(post=>postMatchesSearch(post,p,{trustServerTerms:post.source!=='misskey'}));
      };
      const result=await getBluesky(text,true);
      return normalize(result);
    },
    [excludeBlueskyPosts, getBluesky],
  );

  const loadFeed = useCallback(
    async (mode: FeedMode, page: number) => {
      const token = ++tokenRef.current[mode];
      setFeeds((prev) => ({ ...prev, [mode]: { ...prev[mode], loading: true, error: null } }));

      try {
        const effective = mode === 'media' ? withMediaKind(parsed, mediaKind) : parsed;

        // 修正: 取得したページがクライアント側の絞り込みで0件になっても、まだ続きがある場合は
        // 次のページを読み進める。以前は0件のまま「見つかりません」を表示し、
        // 無限スクロール用の要素も出なくなるため、続きが永久に読み込まれなかった
        // (メディアタブでBlueskyを除外すると、LimeNoteの画像投稿があっても何も出ない原因)。
        const extraRequest=(page===0 ? fetchBlueskyPosts(effective):Promise.resolve([] as PostWithAuthor[])).catch(error=>{if(!searchControllerRef.current.signal.aborted)console.warn('External search failed',error);return [] as PostWithAuthor[];});
        let currentPage = page;
        let local = page===0 || feedsRef.current[mode].localHasMore ? await fetchLocalPosts(effective,currentPage,mode):{items:[] as PostWithAuthor[],hasMore:false};
        let scanned = 0;
        while (local.items.length === 0 && local.hasMore && scanned < MAX_EMPTY_PAGE_SCAN) {
          if (token !== tokenRef.current[mode]) return;
          currentPage += 1;
          scanned += 1;
          local = await fetchLocalPosts(effective, currentPage, mode);
        }

        const extra = await extraRequest;
        if (token !== tokenRef.current[mode]) return;

        setFeeds(prev=>{
          const previous=prev[mode];
          const shown=new Set(page===0 ? []:previous.items.map(post=>post.id));
          const candidates=sortPosts([...(page===0 ? []:previous.remaining),...local.items,...extra],mode).filter(post=>!shown.has(post.id));
          const batch=candidates.slice(0,PAGE_SIZE),remaining=candidates.slice(PAGE_SIZE);
          return {...prev,[mode]:{
            items:page===0 ? batch:[...previous.items,...batch],
            remaining,localHasMore:local.hasMore,
            page:currentPage,hasMore:local.hasMore || remaining.length>0,
            loading:false,loaded:true,error:null,
          }};
        });
      } catch (err: any) {
        if (token !== tokenRef.current[mode] || searchControllerRef.current.signal.aborted) return;
        console.error('Search query failed:', err);
        setFeeds((prev) => ({
          ...prev,
          [mode]: { ...prev[mode], loading: false, loaded: page > 0 ? prev[mode].loaded : false, error: err?.message || '検索に失敗しました' },
        }));
      }
    },
    [parsed, mediaKind, fetchLocalPosts, fetchBlueskyPosts],
  );

  // 検索語・Bluesky設定・再検索で全タブの結果をリセットする
  useEffect(() => {
    (Object.keys(tokenRef.current) as FeedMode[]).forEach((m) => {
      tokenRef.current[m] += 1;
    });
    blueskyCacheRef.current.clear();
    blueskyIdsRef.current = new Set();
    // ログイン状態や相互フォロー関係が変わっていても反映されるよう、検索のたびに取り直す
    visibilityRef.current = null;
    setFeeds(createFeeds());
    setFeedsKey(keyBase);
  }, [keyBase]);

  // 開いたタブの1ページ目だけ読み込む(未表示のタブは読み込まない)
  const mode: FeedMode | null = activeTab === 'users' ? null : activeTab;
  useEffect(() => {
    if (!mode || isUsersLoading || feedsKey !== keyBase) return;
    const f = feeds[mode];
    if (!f.loaded && !f.loading && !f.error) void loadFeed(mode, 0);
  }, [mode, isUsersLoading, feedsKey, keyBase, feeds, loadFeed]);

  // 無限スクロール
  useEffect(() => {
    if (!mode || feedsKey !== keyBase) return;
    const f = feeds[mode];
    const el = sentinelRef.current;
    if (!el || !f.loaded || !f.hasMore || f.loading || f.error) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadFeed(mode, f.page + 1);
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [mode, feeds, feedsKey, keyBase, loadFeed]);

  const changeMediaKind = (kind: MediaKind) => {
    if (kind === mediaKind) return;
    tokenRef.current.media += 1;
    setFeeds((prev) => ({ ...prev, media: EMPTY_FEED }));
    setMediaKind(kind);
  };

  const retry = (m: FeedMode) => {
    setFeeds((prev) => ({ ...prev, [m]: { ...prev[m], error: null } }));
  };

  // ---- ユーザータブ ---------------------------------------------------------
  const userText = useMemo(() => getSearchFreeText(searchQuery), [searchQuery]);

  useEffect(() => {
    let cancelled = false;
    if(activeTab!=='users')return;
    if (!userText || parsed.source === 'lime') {
      setBlueskyUsers([]);
      return;
    }
    getBluesky(userText, false).then((result) => {
      if (!cancelled) setBlueskyUsers(result.users.map(toUser));
    }).catch(error=>{if(!cancelled)console.warn('Account search failed',error);});
    return () => {
      cancelled = true;
    };
  }, [activeTab,userText, parsed.source, refreshKey, getBluesky]);

  const searchableUsers = useMemo(() => {
    const byId = new Map<string, User>();
    const list = (parsed.source === 'bluesky' || parsed.source === 'misskey') ? blueskyUsers : [...allUsers, ...blueskyUsers];
    list.forEach((u) => byId.set(u.id, u));
    return Array.from(byId.values());
  }, [allUsers, blueskyUsers, parsed.source]);

  const searchableUsersIndex = useMemo(() => {
    const index = new Map<string, { dn: string; un: string; handle: string; hay: string }>();
    searchableUsers.forEach((u) => {
      const dn = normalizeText(u.displayName);
      const un = normalizeText(u.username);
      const handle = normalizeText(`@${u.username}`);
      index.set(u.id, { dn, un, handle, hay: normalizeText(`${u.displayName} ${u.username} @${u.username} ${u.bio || ''}`) });
    });
    return index;
  }, [searchableUsers]);

  const filteredUsers = useMemo(() => {
    const tokens = normalizeText(userText).split(/[\s\u3000]+/).filter(Boolean);
    if (tokens.length === 0) return [];

    const blueskyIds = new Set(blueskyUsers.map((u) => u.id));
    const matching = searchableUsers
      .map((u) => {
        const idx = searchableUsersIndex.get(u.id);
        const hay = idx?.hay ?? '';
        const dn = idx?.dn ?? '';
        const un = idx?.un ?? '';
        const handle = idx?.handle ?? '';
        let score = 0;
        for (const t of tokens) {
          const candidates = Array.from(new Set([t, t.replace(/^@+/, '')].filter(Boolean)));
          if (!candidates.some((c) => hay.includes(c))) return null;
          if (candidates.some((c) => dn === c || un === c || handle === c)) score += 5;
          else if (candidates.some((c) => dn.startsWith(c) || un.startsWith(c) || handle.startsWith(c))) score += 3;
          else score += 1;
        }
        return { u, score };
      })
      .filter((x): x is { u: User; score: number } => x !== null)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.u);

    return [...matching, ...blueskyUsers.filter(u=>!matching.some(match=>match.id===u.id))].filter(
      (u, i, arr) => arr.findIndex((c) => c.id === u.id) === i,
    );
  }, [userText, searchableUsers, searchableUsersIndex, blueskyUsers]);

  // ---- 表示 ----------------------------------------------------------------
  const chipBar =
    parsed.chips.length > 0 || parsed.warnings.length > 0 ? (
      <div className="flex flex-col gap-2 px-4 pb-3">
        {parsed.chips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {parsed.chips.map((chip, i) => (
              <span
                key={`${chip.label}-${i}`}
                className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary/10 py-1 pl-3 pr-1.5 text-[13px] font-bold text-primary"
              >
                <span className="truncate">{chip.label}</span>
                <button
                  type="button"
                  aria-label={`${chip.label} を外す`}
                  onClick={() => onChangeQuery(removeChipFromQuery(searchQuery, chip))}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full hover:bg-primary/20"
                >
                  <X className="h-3 w-3" strokeWidth={3} />
                </button>
              </span>
            ))}
          </div>
        )}
        {parsed.warnings.map((w, i) => (
          <div key={`${w}-${i}`} className="flex items-start gap-1.5 text-[12px] text-amber-600 dark:text-amber-400">
            <AlertTriangle className="mt-[1px] h-3.5 w-3.5 shrink-0" />
            <span>{w}</span>
          </div>
        ))}
      </div>
    ) : null;

  const currentFeed: FeedState | null = mode && feedsKey === keyBase ? feeds[mode] : null;
  const isFirstLoading = !currentFeed || (!currentFeed.loaded && !currentFeed.error);

  const sentinel = (
    <div ref={sentinelRef} className="flex h-20 items-center justify-center">
      {currentFeed?.hasMore && currentFeed.loaded && <Loader2 className="h-6 w-6 animate-spin text-primary" />}
    </div>
  );

  const renderFeedStatus = (m: FeedMode, emptyTitle: string, emptyDesc: string) => {
    if (isFirstLoading) {
      return <div>{Array.from({ length: 5 }).map((_, i) => <PostCardSkeleton key={i} />)}</div>;
    }
    if (currentFeed && currentFeed.error && currentFeed.items.length === 0) {
      return (
        <div className="flex flex-col items-center gap-3 px-8 pb-8 pt-16 text-center">
          <AlertTriangle className="h-8 w-8 text-amber-500" />
          <p className="text-[15px] text-[rgb(83,100,113)] dark:text-gray-400">{currentFeed.error}</p>
          <button type="button" onClick={() => retry(m)} className="rounded-full bg-primary px-5 py-2 text-[14px] font-bold text-white hover:opacity-90">
            もう一度試す
          </button>
        </div>
      );
    }
    if (currentFeed && currentFeed.items.length === 0) {
      // 修正: まだ続きがある間は「見つかりません」を出さず、読み込み用の要素を残して
      // 無限スクロールで次のページを読み進められるようにする。
      if (currentFeed.hasMore) return sentinel;
      return <EmptyHint title={emptyTitle} desc={emptyDesc} />;
    }
    return null;
  };

  const renderPostList = (m: 'top' | 'latest') => {
    const status = renderFeedStatus(
      m,
      `"${searchQuery}" に一致する結果はありません`,
      ''
    );
    if (status) return status;

    return (
      <div className="flex flex-col gap-4 bg-transparent max-sm:gap-0">
        {m === 'top' && (
          <div className="px-4 pb-1 text-[12px] text-[rgb(83,100,113)] dark:text-gray-400"></div>
        )}
        {currentFeed!.items.map((post) => (
          <div key={post.id} className="bg-transparent sm:overflow-hidden sm:rounded-xl sm:transition-colors sm:hover:bg-black/[0.01] sm:dark:hover:bg-white/[0.02]">
            <PostCard post={post} />
          </div>
        ))}
        {sentinel}
      </div>
    );
  };

  const renderMedia = () => {
    const kinds: Array<{ value: MediaKind; label: string }> = [
      { value: 'all', label: 'すべて' },
      { value: 'image', label: '画像' },
      { value: 'video', label: '動画' },
    ];
    const status = renderFeedStatus(
      'media',
      'メディアが見つかりません',
      '',
    );

    return (
      <div className="flex flex-col">
        <div className="flex gap-2 px-4 pb-3">
          {kinds.map((k) => (
            <button
              key={k.value}
              type="button"
              onClick={() => changeMediaKind(k.value)}
              className={`h-8 rounded-full px-4 text-[13px] font-bold transition-colors ${
                mediaKind === k.value
                  ? 'bg-[rgb(15,20,25)] text-white dark:bg-white dark:text-black'
                  : 'bg-black/5 text-[rgb(83,100,113)] hover:bg-black/10 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/15'
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
        {status ?? (
          <>
            <SearchMediaGrid posts={currentFeed!.items} blueskyIds={blueskyIdsRef.current} />
            {sentinel}
          </>
        )}
      </div>
    );
  };

  const renderUsers = () => {
    if (isUsersLoading) {
      return <div>{Array.from({ length: 5 }).map((_, i) => <RowSkeleton key={i} />)}</div>;
    }
    if (!userText) {
      return (
        <EmptyHint
          title="アカウントを検索できます"
          desc="ユーザー検索には、名前・ユーザー名・自己紹介に含まれる語句を入力してください。"
        />
      );
    }
    if (filteredUsers.length === 0) {
      return <EmptyHint title={`"${userText}" に一致するアカウントはありません`} desc="別のキーワードでお試しください。" />;
    }
    return (
      <div className="flex flex-col gap-2 px-4">
        <div className="pb-1 text-[12px] text-[rgb(83,100,113)] dark:text-gray-400">{filteredUsers.length} 件のアカウント</div>
        {filteredUsers.map((user) => (
          <div key={user.id} className="overflow-hidden rounded-xl transition-colors hover:bg-black/[0.01] dark:hover:bg-white/[0.02]">
            <UserCard user={user} />
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col">
      {chipBar}
      {activeTab === 'users' ? renderUsers() : activeTab === 'media' ? renderMedia() : renderPostList(activeTab)}
    </div>
  );
}

// ===========================================================================
// 検索ページ本体
// ===========================================================================
// Bluesky側の検索は "@handle" ではなく "handle" 形式のクエリを期待するため、
// 先頭の "@" を取り除いてから渡す
const normalizeBlueskyQuery = (query: string) => query.trim().replace(/^@+/, '');

// PC版の検索バー(サジェスト付き)で使う検索履歴。モバイルではHeader.tsx側の
// 検索バーを使うため、同じキーを共有して履歴も共通になる。
const HISTORY_KEY = 'search:recent';
const HISTORY_MAX = 8;

const loadHistory = (): string[] => {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, HISTORY_MAX) : [];
  } catch { return []; }
};
const saveHistory = (list: string[]) => {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
  } catch { /* noop */ }
};

// 「Blueskyの投稿を含めない」設定はHeader.tsx(モバイル)と同じlocalStorageキー/
// カスタムイベントで共有する。
const SEARCH_EXCLUDE_BLUESKY_STORAGE_KEY = 'lime_search_exclude_bluesky';
const SEARCH_EXCLUDE_BLUESKY_CHANGED_EVENT = 'lime-search-exclude-bluesky-changed';
const SEARCH_QUERY_CHANGED_EVENT = 'lime-search-query-changed';
// BottomNav.tsx の検索ボタンをダブルタップ/ダブルクリックしたときに送られるイベント。
// 受け取ったら検索語・入力欄をリセットして、検索前のメイン画面(検索トップ)へ戻す。
const SEARCH_HOME_REQUESTED_EVENT = 'lime-search-home-requested';

const readExcludeBlueskyPosts = (): boolean => {
  try {
    return localStorage.getItem(SEARCH_EXCLUDE_BLUESKY_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

// 検索結果タブ(話題/最新/ユーザー/メディア)。PC版はこのページのTabsListで、
// モバイルではHeader.tsx側のボタンからこのキー/イベント経由で切り替える。
const SEARCH_PAGE_TAB_STORAGE_KEY = 'lime_search_page_tab';
const SEARCH_PAGE_TAB_CHANGED_EVENT = 'lime-search-page-tab-changed';

const readStoredSearchPageTab = (): SearchTab => {
  try {
    return normalizeStoredSearchTab(localStorage.getItem(SEARCH_PAGE_TAB_STORAGE_KEY));
  } catch {
    return 'top';
  }
};

const desktopTabTriggerClass =
  "relative h-full bg-transparent text-[15px] font-medium text-[rgb(83,100,113)] dark:text-gray-400 data-[state=active]:text-[rgb(15,20,25)] dark:data-[state=active]:text-white data-[state=active]:font-bold data-[state=active]:bg-transparent data-[state=active]:shadow-none hover:bg-black/[0.03] dark:hover:bg-white/5 transition-colors";

// ニュースアイテムの型定義
type NewsItem = SearchNewsItem;

// PC版の検索バーのサジェスト行(検索キーワード or ユーザー)の型定義
type SuggestionRow =
  | { type: 'search'; value: string }
  | { type: 'user'; value: string; user: User };

export default function SearchPage() {
  const desktopLayout = useDesktopLayout();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  // PC版の検索バー(サジェスト付き)用の状態。
  const [inputValue, setInputValue] = useState('');
  const [blueskySuggestionUsers, setBlueskySuggestionUsers] = useState<User[]>([]);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const [activeSuggestIdx, setActiveSuggestIdx] = useState<number>(-1);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isSearchSettingsOpen, setIsSearchSettingsOpen] = useState(false);
  const [excludeBlueskyPosts, setExcludeBlueskyPosts] = useState(() => readExcludeBlueskyPosts());

  const updateExcludeBlueskyPosts = useCallback((value: boolean) => {
    setExcludeBlueskyPosts(value);
    try {
      localStorage.setItem(SEARCH_EXCLUDE_BLUESKY_STORAGE_KEY, String(value));
    } catch {
      // noop
    }
    window.dispatchEvent(new CustomEvent(SEARCH_EXCLUDE_BLUESKY_CHANGED_EVENT, { detail: { value } }));
  }, []);

  // Header.tsx(モバイル)側で「Blueskyの投稿を含めない」が変更された場合に同期する。
  useEffect(() => {
    const sync = () => setExcludeBlueskyPosts(readExcludeBlueskyPosts());
    window.addEventListener(SEARCH_EXCLUDE_BLUESKY_CHANGED_EVENT, sync);
    return () => window.removeEventListener(SEARCH_EXCLUDE_BLUESKY_CHANGED_EVENT, sync);
  }, []);

  const [activeTab, setActiveTab] = useState<SearchTab>(() => readStoredSearchPageTab());
  // 初期値をtrueにして、ユーザー一覧の取得前に検索結果の取得が走らないようにする
  const [isUsersLoading, setIsUsersLoading] = useState(true);

  // トレンド用ステート
  const { data: trends = [], isPending: isTrendsLoading } = useTrends();

  // ニュース用ステート
  const [newsSources, setNewsSources] = useState<Record<string, NewsSources>>({});
  const [exploreTab] = useSearchExploreTab();
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [isNewsLoading, setIsNewsLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const suggestBoxRef = useRef<HTMLDivElement>(null);
  const appliedSearchParamRef = useRef<string | null>(null);
  const appliedSearchStateRef = useRef<object | null>(null);
  // 下部ナビの検索ボタンのダブルタップで渡される「検索トップへ戻る」リクエストのうち、
  // すでに処理したものを覚えておく(同じ navigation state で二重に処理しないため)。
  const appliedSearchHomeTokenRef = useRef<number | null>(null);

  const { user } = useAuth();
  const {data:preferences={authors:{},terms:{}}}=useQuery<RecommendationPreferences>({queryKey:['recommendation-preferences',user?.id??null],queryFn:()=>getRecommendationPreferences(user?.id??null),staleTime:0});

  // Both external providers share the same suggestion slots and cancellation.
  useEffect(() => {
    const query=getSearchFreeText(inputValue).trim();
    setBlueskySuggestionUsers([]);
    if(!query || !desktopLayout)return;
    const controller=new AbortController();
    const publish=(users:Awaited<ReturnType<typeof searchExternalUsers>>)=>{
      if(!controller.signal.aborted)setBlueskySuggestionUsers(users.map(user=>({...user,isOfficial:false})));
    };
    const timer=window.setTimeout(()=>{
      void searchExternalUsers(normalizeBlueskyQuery(query),{includeBluesky:!excludeBlueskyPosts,signal:controller.signal})
        .then(publish).catch(error=>{if(!controller.signal.aborted)console.warn('External suggestions unavailable',error);});
    },250);
    return()=>{controller.abort();window.clearTimeout(timer);};
  },[inputValue, excludeBlueskyPosts,desktopLayout]);

  // PC版の検索バー: スクロールに応じた背景のぼかし表示切り替え。
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 90);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // PC版の検索バー: サジェストの外側をクリックしたら閉じる。
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (suggestBoxRef.current && !suggestBoxRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setIsInputFocused(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // ニュース取得用Effect
  useEffect(() => {
    let cancelled = false;
    async function fetchLatestNews() {
      setIsNewsLoading(true);
      try {
        const results = await Promise.all(['limenote', 'bluesky'].map(source => supabase
          .from('news_summaries').select('*').eq('source', source)
          .eq('public_sources_verified', true).order('created_at', {ascending: false}).limit(1)));
        const error = results.find(result => result.error)?.error;
        const data = results.flatMap(result => result.data || []);

        if (error) throw error;
        if (cancelled) return;
        const newsItems = Array.isArray(data) ? data : [];
        setNewsItems(newsItems);
        void getNewsSources(latestNewsPerSource(newsItems)).then(sources => { if (!cancelled) setNewsSources(sources); });
      } catch (err) {
        console.error('Failed to fetch news:', err);
      } finally {
        if (!cancelled) setIsNewsLoading(false);
      }
    }
    fetchLatestNews();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchUsers() {
      setIsUsersLoading(true);
      try {
        // 使用する列だけを取得し、通信量とメモリ使用量を削減
        const { data, error } = await supabase
          .from('profiles')
          .select('id, username, display_name, avatar_url, cover_url, created_at, bio, is_official');
        if (error) throw error;
        if (cancelled) return;
        setAllUsers((data || []).map((u: any) => ({
          id: u.id,
          username: u.username,
          displayName: u.display_name || u.displayName || 'User',
          avatarUrl: u.avatar_url || u.avatarUrl || '',
          coverUrl: u.cover_url || '',
          createdAt: u.created_at || '',
          bio: u.bio || '',
          isOfficial: !!(u.is_official || u.isOfficial),
        })));
      } catch (err) { console.error(err); }
      finally { if (!cancelled) setIsUsersLoading(false); }
    }
    fetchUsers();
    return () => { cancelled = true; };
  }, []);

  const changeActiveTab = useCallback((value: SearchTab) => {
    setActiveTab(value);
    try {
      localStorage.setItem(SEARCH_PAGE_TAB_STORAGE_KEY, value);
    } catch {
      // noop
    }
    window.dispatchEvent(new CustomEvent(SEARCH_PAGE_TAB_CHANGED_EVENT, { detail: { tab: value } }));
    // タブを切り替えたら結果の先頭から見られるようにする
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  // Header.tsx(モバイル)のタブボタンから変更された場合に同期する。
  useEffect(() => {
    const handleTabChange = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: string }>).detail;
      if (detail?.tab) {
        setActiveTab(normalizeStoredSearchTab(detail.tab));
        window.scrollTo({ top: 0, behavior: 'auto' });
      }
    };

    window.addEventListener(SEARCH_PAGE_TAB_CHANGED_EVENT, handleTabChange);
    return () => window.removeEventListener(SEARCH_PAGE_TAB_CHANGED_EVENT, handleTabChange);
  }, []);

  // 検索を確定する。実際の取得は <SearchResults> が searchQuery を見て行う。
  const commitSearch = useCallback((raw: string) => {
    const q = raw.trim();
    if (!q) return;

    setInputValue(q);
    setSearchQuery(q);
    setRefreshKey((n) => n + 1);
    window.dispatchEvent(new CustomEvent(SEARCH_QUERY_CHANGED_EVENT, { detail: { query: q } }));
    setIsInputFocused(false);
    setActiveSuggestIdx(-1);

    setHistory((prev) => {
      const next = [q, ...prev.filter((h) => h !== q)].slice(0, HISTORY_MAX);
      saveHistory(next);
      return next;
    });

    inputRef.current?.blur();
  }, []);

  // 検索トップ(検索前のメイン画面)へ戻す。
  // 検索語・入力欄・サジェスト・詳細検索パネルをすべて初期状態に戻し、
  // <SearchResults> を外して「ニュース/トレンド/おすすめユーザー」の画面を表示させる。
  const resetToSearchHome = useCallback(() => {
    setSearchQuery('');
    setInputValue('');
    setIsInputFocused(false);
    setActiveSuggestIdx(-1);
    setIsSearchSettingsOpen(false);
    setBlueskySuggestionUsers([]);
    inputRef.current?.blur();
    // Header.tsx(モバイル)の検索バーにも「検索語が空になった」ことを伝える。
    window.dispatchEvent(new CustomEvent(SEARCH_QUERY_CHANGED_EVENT, { detail: { query: '' } }));
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  // BottomNav.tsx の検索ボタンをダブルタップ/ダブルクリックしたときに検索トップへ戻す。
  useEffect(() => {
    window.addEventListener(SEARCH_HOME_REQUESTED_EVENT, resetToSearchHome);
    return () => window.removeEventListener(SEARCH_HOME_REQUESTED_EVENT, resetToSearchHome);
  }, [resetToSearchHome]);

  // 条件チップの×で検索語が変わったとき。空になったら検索前の画面に戻す。
  const handleChangeQuery = useCallback((query: string) => {
    if (query.trim()) {
      commitSearch(query);
    } else {
      setSearchQuery('');
      setInputValue('');
      // 修正: Header.tsx(モバイル)側の検索バーにも「検索語が空になった」ことを伝える
      // (以前は通知がなく、Header側に古い検索語が残っていた)
      window.dispatchEvent(new CustomEvent(SEARCH_QUERY_CHANGED_EVENT, { detail: { query: '' } }));
    }
  }, [commitSearch]);

  // サジェスト候補の計算はキー入力のたびに実行されるため、
  // 正規化済みの値はユーザー一覧が変わったときだけ作り直す。
  const allUsersSearchIndex = useMemo(() => {
    const index = new Map<string, { dn: string; un: string; handle: string }>();
    allUsers.forEach((u) => {
      index.set(u.id, {
        dn: normalizeText(u.displayName),
        un: normalizeText(u.username),
        handle: normalizeText(`@${u.username}`),
      });
    });
    return index;
  }, [allUsers]);

  const liveSuggestions = useMemo(() => {
    // "from:xxx" などの演算子は除き、検索語だけでユーザー候補を出す
    const raw = getSearchFreeText(inputValue).trim();
    const normalizedRaw = normalizeText(raw);
    const queryCandidates = Array.from(
      new Set([normalizedRaw, normalizedRaw.replace(/^@+/, '')].filter(Boolean))
    );

    if (queryCandidates.length === 0) return [];

    const localSuggestions = allUsers
      .map((u) => {
        const idx = allUsersSearchIndex.get(u.id);
        const dn = idx?.dn ?? '';
        const un = idx?.un ?? '';
        const handle = idx?.handle ?? '';
        const fields = [dn, un, handle];
        let score = 0;

        if (queryCandidates.some((q) => fields.includes(q))) score = 100;
        else if (queryCandidates.some((q) => fields.some((field) => field.startsWith(q)))) score = 50;
        else if (queryCandidates.some((q) => fields.some((field) => field.includes(q)))) score = 20;

        return { user: u, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((x) => x.user);
    const seen = new Set(localSuggestions.map((user) => user.id));
    const blueskySuggestions = blueskySuggestionUsers.filter((user) => !seen.has(user.id)).slice(0, 3);
    return [...localSuggestions.slice(0, 5 - blueskySuggestions.length), ...blueskySuggestions];
  }, [inputValue, allUsers, allUsersSearchIndex, blueskySuggestionUsers]);

  const suggestionRows = useMemo<SuggestionRow[]>(() => {
    const rows: SuggestionRow[] = [];
    if (inputValue.trim()) {
      rows.push({ type: 'search', value: inputValue.trim() });
      for (const u of liveSuggestions) rows.push({ type: 'user', value: u.username, user: u });
    } else {
      for (const h of history) rows.push({ type: 'search', value: h });
    }
    return rows;
  }, [inputValue, liveSuggestions, history]);

  const handleSuggestionSelect = useCallback((row: SuggestionRow) => {
    if (row.type === 'user') {
      setIsInputFocused(false);
      setActiveSuggestIdx(-1);
      inputRef.current?.blur();
      navigate(`/u/${row.user.username}`);
      return;
    }

    commitSearch(row.value);
  }, [commitSearch, navigate]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isInputFocused) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestIdx((i) => Math.min(suggestionRows.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestIdx((i) => Math.max(-1, i - 1));
    } else if (e.key === 'Enter' && activeSuggestIdx >= 0) {
      // 修正: 候補が減った直後などで activeSuggestIdx が範囲外だと undefined を渡してクラッシュしていた
      const row = suggestionRows[activeSuggestIdx];
      if (!row) return;
      e.preventDefault();
      handleSuggestionSelect(row);
    }
  };

  const removeHistoryItem = (item: string) => {
    setHistory((prev) => {
      const next = prev.filter((h) => h !== item);
      saveHistory(next);
      return next;
    });
  };

  const clearHistory = () => {
    setHistory([]);
    saveHistory([]);
  };

  useEffect(() => {
    const navigationState = location.state as { searchQuery?: string; resetSearchHome?: number } | null;

    // 下部ナビの検索ボタンをダブルタップ/ダブルクリックしたときは、
    // navigation state の resetSearchHome で「検索トップへ戻る」リクエストが届く。
    // (カスタムイベントが届かなかった場合の保険。同じリクエストは1回だけ処理する。)
    const resetToken = navigationState?.resetSearchHome;
    if (typeof resetToken === 'number' && resetToken !== appliedSearchHomeTokenRef.current) {
      appliedSearchHomeTokenRef.current = resetToken;
      // 同じ navigation state に古い searchQuery が残っていても再検索しないよう、
      // このstateオブジェクトは処理済みとして記録する。
      if (navigationState) appliedSearchStateRef.current = navigationState;
      resetToSearchHome();
      return;
    }

    const stateQuery = navigationState?.searchQuery?.trim() || '';

    // Header から /search へ遷移した検索は URL の ?q= ではなく、
    // React Router の navigation state で受け取る。
    if (stateQuery && navigationState !== appliedSearchStateRef.current) {
      appliedSearchStateRef.current = navigationState;
      commitSearch(stateQuery);
      return;
    }

    // 既存リンク等で ?q= が渡された場合だけ後方互換として処理する。
    // 修正: 以前は「前回と同じ ?q= 」だと無視していたため、検索ページ上で別の語を検索した後に
    // 同じハッシュタグ(PostCard内のリンク等)を押しても検索されなかった。
    // 遷移ごとに変わる location.key も組み合わせて判定する。
    const queryParam = searchParams.get('q');
    const paramKey = queryParam ? `${location.key}\u0000${queryParam}` : null;
    if (queryParam && paramKey !== appliedSearchParamRef.current) {
      appliedSearchParamRef.current = paramKey;
      commitSearch(queryParam);
    }
  }, [searchParams, location.state, location.key, commitSearch, resetToSearchHome]);

  // おすすめユーザー用
  // 公式かどうか・登録日時などでは並び替えず、毎回ランダムに3人選ぶ。
  const recommendedUsers = useMemo(() => {
    const candidates = allUsers.filter((u) => !!u.id && !!u.username);
    const shuffled = [...candidates];

    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled.slice(0, 3);
  }, [allUsers]);

  const renderSearchHomeSections = () => (
    <div className="flex flex-col">
      <SearchExploreContent tab={exploreTab} preferences={preferences} viewerId={user?.id ?? null} news={newsItems} sources={newsSources} trends={trends} users={recommendedUsers}
        newsLoading={isNewsLoading} trendsLoading={isTrendsLoading} usersLoading={isUsersLoading}
        onSearch={commitSearch} onNews={id => navigate(`/news?story=${encodeURIComponent(id)}`)} />

    </div>
  );

  const searchBar = (
      <div
        data-lime-search-bar
        className={`hidden sm:sticky sm:top-0 sm:z-50 sm:flex sticky top-0 z-50 transition-all duration-300 w-full h-16 items-center ${
          isScrolled
            ? 'max-sm:bg-[#fbf9f2]/70 dark:max-sm:bg-[#000000]/70 max-sm:backdrop-blur-md border-b border-black/[0.03] dark:border-white/[0.05]'
            : 'bg-transparent'
        }`}
        style={{ position: 'sticky', top: 0 }}
      >
        <div className="mx-auto w-full px-4">
          <form onSubmit={(e) => { e.preventDefault(); commitSearch(inputValue); }} className="relative pr-12">
            <div className={`relative flex items-center h-11 rounded-full border border-border transition-all ${
              isInputFocused
                ? 'bg-white dark:bg-black ring-2 ring-primary'
                : 'bg-transparent'
            }`}>
              <Search className={`absolute left-4 w-[18px] h-[18px] ${isInputFocused ? 'text-primary' : 'text-[rgb(83,100,113)] dark:text-gray-400'}`} />
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => { setInputValue(e.target.value); setActiveSuggestIdx(-1); }}
                onFocus={() => {
                  // Header.tsx(モバイル)側で追加された履歴も反映する
                  setHistory(loadHistory());
                  setIsInputFocused(true);
                }}
                onKeyDown={onKeyDown}
                placeholder="検索"
                className="w-full h-full bg-transparent border-none pl-11 pr-10 text-[15px] outline-none dark:placeholder-gray-500"
              />
              {inputValue && (
                <button type="button" onClick={() => { setInputValue(''); inputRef.current?.focus(); }} className="absolute right-3 w-5 h-5 flex items-center justify-center bg-primary rounded-full">
                  <X className="w-3 h-3 text-white" strokeWidth={3} />
                </button>
              )}
            </div>
              <button
                type="button"
                aria-label="詳細検索"
                aria-expanded={isSearchSettingsOpen}
                onClick={() => setIsSearchSettingsOpen((open) => !open)}
                className="absolute right-0 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted"
              >
                <Settings className="h-5 w-5" />
              </button>

            {isSearchSettingsOpen && (
              <>
                <button
                  type="button"
                  aria-label="詳細検索を閉じる"
                  className="fixed inset-0 z-[55] cursor-default"
                  onClick={() => setIsSearchSettingsOpen(false)}
                />
                <div className="absolute right-0 top-12 z-[60] w-64 rounded-2xl border border-black/5 bg-white p-3 shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:border-white/10 dark:bg-[#15202b]">
                  <SearchAdvancedPanel
                    excludeBluesky={excludeBlueskyPosts}
                    onToggleExcludeBluesky={updateExcludeBlueskyPosts}
                  />
                </div>
              </>
            )}

            {isInputFocused && suggestionRows.length > 0 && (
              <div ref={suggestBoxRef} className="absolute left-0 right-0 mt-2 bg-white/95 dark:bg-[#15202b]/95 backdrop-blur-xl rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.1)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.3)] border border-black/5 dark:border-white/10 overflow-hidden max-h-[420px] overflow-y-auto">
                {!inputValue.trim() && history.length > 0 && (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="font-bold text-[15px]">最近の検索</span>
                    <button type="button" onClick={clearHistory} className="text-primary text-[13px] hover:underline">すべて消去</button>
                  </div>
                )}
                {suggestionRows.map((row, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); handleSuggestionSelect(row); }}
                    className={`w-full flex items-center gap-3 px-4 py-3 transition-colors ${
                      idx === activeSuggestIdx
                        ? 'bg-black/5 dark:bg-white/10'
                        : 'hover:bg-black/[0.03] dark:hover:bg-white/5'
                    }`}
                  >
                    {row.type === 'search' ? (
                      <>
                        {!inputValue.trim()
                          ? <Clock className="w-[18px] h-[18px] text-[rgb(83,100,113)] dark:text-gray-400" />
                          : <Search className="w-[18px] h-[18px] text-[rgb(83,100,113)] dark:text-gray-400" />
                        }
                        <span className="flex-1 text-[15px] truncate text-left ml-3">{row.value}</span>
                        {!inputValue.trim() && (
                          <span role="button" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); removeHistoryItem(row.value); }} className="p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/20">
                            <X className="w-4 h-4 text-[rgb(83,100,113)] dark:text-gray-400" />
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        {row.user.avatarUrl ? (
                          <img
                            src={row.user.avatarUrl}
                            alt={row.user.displayName}
                            loading="lazy"
                            className="w-10 h-10 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-black/5 dark:bg-white/10" />
                        )}
                        <div className="min-w-0 flex flex-col text-left">
                          <span className="flex min-w-0 items-center gap-1">
                            <span className="truncate font-bold text-[15px]">{row.user.displayName}</span>
                            {row.user.isOfficial && (
                              <img
                                src={`${import.meta.env.BASE_URL}verified.png`}
                                alt="Official"
                                className="h-4 w-4 shrink-0 translate-y-[0.5px]"
                                loading="eager"
                              />
                            )}
                          </span>
                          <span className="truncate text-[13px] text-[rgb(83,100,113)] dark:text-gray-400">@{row.user.username}</span>
                        </div>
                      </>
                    )}
                  </button>
                ))}
              </div>
            )}
          </form>
        </div>
      </div>
  );
  const searchTabs = !searchQuery ? <div className="hidden sm:block" data-lime-search-home-tabs><SearchExploreTabs /></div> : (
        <Tabs value={activeTab} onValueChange={(value) => changeActiveTab(value as SearchTab)} className="w-full max-sm:hidden" data-lime-search-tabs>
          <div className="hidden sm:block">
            <TabsList className="w-full h-[53px] bg-transparent border-b border-black/[0.03] dark:border-white/[0.05] rounded-none p-0 grid grid-cols-4 relative z-20">
              {SEARCH_TABS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value} className={desktopTabTriggerClass}>
                  <span data-lime-tab-label>{tab.label}</span>
                </TabsTrigger>
              ))}
              <SearchTabIndicator active={activeTab} />
            </TabsList>
          </div>
        </Tabs>
  );

  return (
    <div className="min-h-screen bg-transparent text-[rgb(15,20,25)] dark:text-white">
      {/* PC版の検索バー(サジェスト・履歴・詳細検索つき)。モバイルではHeader.tsx側の
          検索バーを使うため、ここはsm以上でのみ表示する。 */}
      {desktopLayout ? (
        <div data-lime-search-header className="lime-desktop-search-header">{searchBar}{searchTabs}</div>
      ) : searchBar}

      <div data-lime-search-content className={`mx-auto flex w-full max-w-3xl flex-col gap-6 max-sm:relative max-sm:left-0 max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:gap-0 max-sm:px-0`}>
        {/* モバイルではこのタブバーの代わりにHeader.tsx側のタブボタンを使う。
            結果の中身は <SearchResults> が activeTab を見て切り替える(タブごとの
            読み込み済み結果は保持され、切り替えても再取得しない)。
            修正: モバイルでは中身が空のTabsがflexの子要素として残り、gap-6の余白だけが
            タブと検索結果の間に入っていたため、モバイルでは要素ごと非表示にして
            余白の原因を取り除いた。 */}
        {!desktopLayout && searchTabs}

        <div className={searchQuery ? '-mt-2 bg-transparent max-sm:mt-0' : 'bg-transparent'}>
          {!searchQuery ? (
            renderSearchHomeSections()
          ) : (
            <SearchResults
              searchQuery={searchQuery}
              activeTab={activeTab}
              excludeBlueskyPosts={excludeBlueskyPosts}
              allUsers={allUsers}
              isUsersLoading={isUsersLoading}
              refreshKey={refreshKey}
              onChangeQuery={handleChangeQuery}
            />
          )}
        </div>
      </div>
    </div>
  );
}
