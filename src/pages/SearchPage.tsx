import { useDesktopLayout } from '@/components/layout/DesktopLayoutContext';
import { TrendSection } from '@/components/search/TrendSection';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Search, X, Clock, Loader2, TrendingUp, Newspaper, Radio, Play, Square, UsersRound, Settings2,
  AlertTriangle, ChevronLeft, ChevronRight, Heart,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PostCard } from '@/components/feed/PostCard';
import UserCard from '@/components/search/UserCard';
import { FollowButton } from '@/components/profile/FollowButton';
import { supabase } from '@/lib/supabase';
import { searchBluesky } from '@/lib/bluesky';
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
export type SearchSource = 'all' | 'lime' | 'bluesky';

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
      else return warn('は未対応です(lime / bluesky)');
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
  const isBlueskyPost = String(post.id || '').startsWith('bsky:');
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
  source: '' | 'lime' | 'bluesky';
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
// ラジオ機能(元のSearchPage.tsxにあった処理を、そのままフックにまとめたもの)
// ===========================================================================
// 検索ページの「ラジオ」機能。SearchPage.tsx にあったロジックをそのまま移したもの。
// (ページを離れても再生が続く仕様のため、状態の一部は window に持たせている)

declare global {
  interface Window {
    __limeSearchRadioIsPlaying?: boolean;
    __limeSearchRadioOwnerId?: string;
    __limeSearchRadioStop?: () => void;
  }
}

// ページを離れて戻ってきた後でも、再生状態の表示が実際の状態とズレないよう
// 再生/停止のたびにこのイベントで全インスタンスへ通知する。
const SEARCH_RADIO_STATE_EVENT = 'lime-search-radio-state-changed';

export type RadioNewsItem = { title: string; content: string; category: string };

// 修正: 以前は「バグが発生しています」と読み上げてしまっていた。
const RADIO_FALLBACK_SCRIPT = `
現在、読み上げできるニュースがありません。しばらくしてからもう一度お試しください。
`;

const createSilentAudioUrl = () => {
  const sampleRate = 8000;
  const seconds = 1;
  const samples = sampleRate * seconds;
  const dataSize = samples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
};

const getHumanLikeJapaneseVoice = () => {
  if (!('speechSynthesis' in window)) return null;

  const voices = window.speechSynthesis.getVoices();
  const japaneseVoices = voices.filter((voice) => voice.lang.toLowerCase().startsWith('ja'));
  const candidates = japaneseVoices.length > 0 ? japaneseVoices : voices;

  return candidates
    .map((voice) => {
      const name = voice.name.toLowerCase();
      const uri = voice.voiceURI.toLowerCase();
      const label = `${name} ${uri}`;
      let score = 0;

      if (voice.lang.toLowerCase().startsWith('ja')) score += 130;
      if (/siri|voice 1|voice 2|voice 3|voice 4/.test(label)) score += 110;
      if (/kyoko|otoya/.test(label) && /enhanced|premium/.test(label)) score += 105;
      if (/kyoko|otoya|aoi|mayu|shiori|haruka|ichiro|sayaka/.test(label)) score += 62;
      if (/natural|neural/.test(label)) score += 55;
      if (/enhanced|premium|online/.test(label)) score += 50;
      if (/apple|com.apple/.test(label)) score += 36;
      if (/microsoft|google|nanami|keita/.test(label)) score -= 70;
      if (/compact/.test(label)) score -= 90;
      if (/default/.test(label)) score -= 22;
      if (/novelty|whisper|organ|bad news|bells|boing|bubbles/.test(label)) score -= 120;
      if (voice.localService) score += 18;
      if (!voice.default) score += 10;

      return { voice, score };
    })
    .sort((a, b) => b.score - a.score)[0]?.voice || null;
};

const getRadioTimeIntro = () => {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const period = hours < 12 ? '午前' : '午後';
  const displayHours = hours % 12 || 12;
  const minuteText = minutes === 0 ? 'ちょうど' : `${minutes}分`;

  return `現在、${period}${displayHours}時${minuteText}です。`;
};

export function useSearchRadio(radioNews: RadioNewsItem[]) {
  const [isRadioPlaying, setIsRadioPlaying] = useState(() => !!window.__limeSearchRadioIsPlaying);

  const radioPlayingRef = useRef(false);
  const backgroundAudioRef = useRef<HTMLAudioElement | null>(null);
  const backgroundAudioUrlRef = useRef<string | null>(null);
  const radioAudioContextRef = useRef<AudioContext | null>(null);
  const radioBeatTimerRef = useRef<number | null>(null);
  const radioBeatGainRef = useRef<GainNode | null>(null);
  const isMountedRef = useRef(true);
  const radioInstanceIdRef = useRef(`search-radio-${Date.now()}-${Math.random()}`);
  // 選択済みの読み上げボイスをキャッシュし、発話のたびに全ボイスをスコアリングし直さない
  const cachedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  // 修正: 再生/停止のたびに増やすセッション番号。
  // speechSynthesis.cancel() は古い発話の onerror を非同期に発火させるため、
  // 「停止 → すぐ再生」すると古い発話のエラーで新しい再生まで止まってしまっていた。
  const speechSessionRef = useRef(0);
  // 修正: ジングル後の読み上げ開始/ループ再開用タイマー。停止・再生時に確実に破棄する
  // (以前は追跡しておらず、停止後もタイマーが残って二重再生になることがあった)。
  const radioSpeakTimerRef = useRef<number | null>(null);

  const radioScript = useMemo(() => {
    const newsLines = radioNews.slice(0, 4).map((news, idx) => {
      const content = news.content ? `。${news.content.slice(0, 140)}` : '';
      return `${idx + 1}本目、${news.category}から。${news.title}${content}`;
    });

    if (newsLines.length === 0) {
      return RADIO_FALLBACK_SCRIPT;
    }

    return [
      'こんにちは。こちらはLimeNote開発部です。',
      '検索ページで見つけたニュースを、読み上げます。',
      'まずはニュースです。',
      ...newsLines,
      '以上、LimeNoteでした。読み上げが終わると、また最初から繰り返します。',
    ].filter(Boolean).join('\n');
  }, [radioNews]);

  const clearRadioSpeakTimer = useCallback(() => {
    if (radioSpeakTimerRef.current !== null) {
      window.clearTimeout(radioSpeakTimerRef.current);
      radioSpeakTimerRef.current = null;
    }
  }, []);

  const playRadioJingle = useCallback(() => {
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) return;

    const audioContext = radioAudioContextRef.current || new AudioContextCtor();
    radioAudioContextRef.current = audioContext;

    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {
        // ブラウザ側でAudioContextの再開が拒否された場合は読み上げだけ続ける
      });
    }

    const now = audioContext.currentTime;
    const master = audioContext.createGain();
    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-20, now);
    compressor.knee.setValueAtTime(16, now);
    compressor.ratio.setValueAtTime(3, now);
    compressor.attack.setValueAtTime(0.006, now);
    compressor.release.setValueAtTime(0.16, now);
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.32, now + 0.08);
    master.gain.setValueAtTime(0.28, now + 1.75);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 2.35);
    master.connect(compressor);
    compressor.connect(audioContext.destination);

    const playTone = (
      frequency: number,
      start: number,
      duration: number,
      peak: number,
      type: OscillatorType = 'sine'
    ) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const end = start + duration;

      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.035);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);

      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(start);
      oscillator.stop(end + 0.02);
    };

    const playChordHit = (start: number, frequencies: number[], duration: number) => {
      const chordGain = audioContext.createGain();
      const filter = audioContext.createBiquadFilter();

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2200, start);
      chordGain.gain.setValueAtTime(0.0001, start);
      chordGain.gain.exponentialRampToValueAtTime(0.2, start + 0.06);
      chordGain.gain.setValueAtTime(0.17, start + duration - 0.16);
      chordGain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      frequencies.forEach((frequency, index) => {
        const oscillator = audioContext.createOscillator();
        oscillator.type = index % 2 === 0 ? 'triangle' : 'sine';
        oscillator.frequency.setValueAtTime(frequency, start);
        oscillator.detune.setValueAtTime(index % 2 === 0 ? -5 : 5, start);
        oscillator.connect(filter);
        oscillator.start(start);
        oscillator.stop(start + duration + 0.03);
      });

      filter.connect(chordGain);
      chordGain.connect(master);
    };

    const createNoiseBuffer = (duration: number) => {
      const bufferSize = Math.floor(audioContext.sampleRate * duration);
      const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
      const output = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i += 1) output[i] = Math.random() * 2 - 1;
      return buffer;
    };

    const playNoise = (start: number, duration: number, peak: number, frequency: number) => {
      const noise = audioContext.createBufferSource();
      const filter = audioContext.createBiquadFilter();
      const gain = audioContext.createGain();

      noise.buffer = createNoiseBuffer(duration);
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      noise.start(start);
      noise.stop(start + duration + 0.02);
    };

    playChordHit(now, [293.66, 349.23, 440.00, 523.25, 659.25], 0.62);
    playTone(73.42, now, 0.38, 0.14, 'sawtooth');
    playNoise(now + 0.02, 0.08, 0.08, 6200);

    playChordHit(now + 0.55, [196.00, 246.94, 349.23, 440.00, 587.33], 0.72);
    playTone(98.00, now + 0.56, 0.46, 0.15, 'sawtooth');
    playNoise(now + 0.58, 0.12, 0.1, 2200);

    playChordHit(now + 1.18, [261.63, 329.63, 392.00, 493.88, 587.33], 1.05);
    playTone(65.41, now + 1.18, 0.72, 0.16, 'sawtooth');

    [659.25, 783.99, 987.77, 1174.66, 987.77, 1318.51, 1174.66].forEach((frequency, index) => {
      playTone(frequency, now + 0.18 + index * 0.18, 0.24, 0.13, index % 2 === 0 ? 'triangle' : 'sine');
    });

    playTone(880.00, now + 1.55, 0.26, 0.11, 'triangle');
    playTone(987.77, now + 1.72, 0.28, 0.12, 'triangle');
    playTone(1318.51, now + 1.96, 0.48, 0.15, 'sine');
    playNoise(now + 2.05, 0.22, 0.13, 5600);
  }, []);

  const startRadioBeat = useCallback(() => {
    if (radioBeatTimerRef.current !== null) return;

    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) return;

    const audioContext = radioAudioContextRef.current || new AudioContextCtor();
    radioAudioContextRef.current = audioContext;

    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {
        // ブラウザ側でAudioContextの再開が拒否された場合は読み上げだけ続ける
      });
    }

    const beatGain = audioContext.createGain();
    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-18, audioContext.currentTime);
    compressor.knee.setValueAtTime(18, audioContext.currentTime);
    compressor.ratio.setValueAtTime(4, audioContext.currentTime);
    compressor.attack.setValueAtTime(0.006, audioContext.currentTime);
    compressor.release.setValueAtTime(0.18, audioContext.currentTime);
    beatGain.gain.setValueAtTime(1.25, audioContext.currentTime);
    beatGain.connect(compressor);
    compressor.connect(audioContext.destination);
    radioBeatGainRef.current = beatGain;

    const createNoiseBuffer = (duration = 0.18) => {
      const bufferSize = Math.floor(audioContext.sampleRate * duration);
      const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
      const output = buffer.getChannelData(0);

      for (let i = 0; i < bufferSize; i += 1) {
        output[i] = Math.random() * 2 - 1;
      }

      return buffer;
    };

    const playKick = (time: number) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(116, time);
      oscillator.frequency.exponentialRampToValueAtTime(48, time + 0.14);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.18, time + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.24);

      oscillator.connect(gain);
      gain.connect(beatGain);
      oscillator.start(time);
      oscillator.stop(time + 0.24);
    };

    // ノイズ(ハイハット/スネア)は渡されたバッファを共有して使う
    const playSnare = (time: number, noiseBuffer: AudioBuffer) => {
      const noise = audioContext.createBufferSource();
      const filter = audioContext.createBiquadFilter();
      const gain = audioContext.createGain();

      noise.buffer = noiseBuffer;
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(950, time);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.095, time + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(beatGain);
      noise.start(time);
      noise.stop(time + 0.15);
    };

    const playHat = (time: number, noiseBuffer: AudioBuffer) => {
      const noise = audioContext.createBufferSource();
      const filter = audioContext.createBiquadFilter();
      const gain = audioContext.createGain();

      noise.buffer = noiseBuffer;
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(6200, time);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.045, time + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(beatGain);
      noise.start(time);
      noise.stop(time + 0.07);
    };

    const playBass = (time: number, frequency: number) => {
      const oscillator = audioContext.createOscillator();
      const filter = audioContext.createBiquadFilter();
      const gain = audioContext.createGain();

      oscillator.type = 'sawtooth';
      oscillator.frequency.setValueAtTime(frequency, time);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(420, time);
      filter.Q.setValueAtTime(1.2, time);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.16, time + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.34);

      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(beatGain);
      oscillator.start(time);
      oscillator.stop(time + 0.36);
    };

    const playChord = (time: number, frequencies: number[], duration: number) => {
      const chordGain = audioContext.createGain();
      const filter = audioContext.createBiquadFilter();

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1550, time);
      filter.Q.setValueAtTime(0.6, time);
      chordGain.gain.setValueAtTime(0.0001, time);
      chordGain.gain.exponentialRampToValueAtTime(0.085, time + 0.08);
      chordGain.gain.setValueAtTime(0.075, time + duration - 0.16);
      chordGain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

      frequencies.forEach((frequency, index) => {
        const oscillator = audioContext.createOscillator();
        oscillator.type = index % 2 === 0 ? 'triangle' : 'sine';
        oscillator.frequency.setValueAtTime(frequency, time);
        oscillator.detune.setValueAtTime(index % 2 === 0 ? -4 : 4, time);
        oscillator.connect(filter);
        oscillator.start(time);
        oscillator.stop(time + duration + 0.03);
      });

      filter.connect(chordGain);
      chordGain.connect(beatGain);
    };

    const playArp = (time: number, frequency: number) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const filter = audioContext.createBiquadFilter();

      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(frequency, time);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2400, time);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.055, time + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);

      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(beatGain);
      oscillator.start(time);
      oscillator.stop(time + 0.2);
    };

    const bpm = 92;
    const step = 60 / bpm / 4;
    const patternSteps = 64;
    const patternLength = step * patternSteps;
    const chordProgression = [
      { chord: [261.63, 329.63, 392.00, 493.88], bass: 65.41, arp: [392.00, 493.88, 659.25, 493.88] },
      { chord: [220.00, 261.63, 329.63, 392.00], bass: 55.00, arp: [329.63, 392.00, 523.25, 392.00] },
      { chord: [174.61, 220.00, 261.63, 329.63], bass: 43.65, arp: [329.63, 440.00, 523.25, 440.00] },
      { chord: [196.00, 246.94, 293.66, 392.00], bass: 49.00, arp: [293.66, 392.00, 587.33, 392.00] },
    ];

    const schedulePattern = () => {
      if (!radioPlayingRef.current) return;

      // このパターン周期の間、ハイハット/スネアで使い回すノイズバッファを1個だけ生成する
      const cycleNoiseBuffer = createNoiseBuffer(0.18);

      const start = audioContext.currentTime + 0.04;
      for (let i = 0; i < patternSteps; i += 1) {
        const time = start + i * step;
        const barIndex = Math.floor(i / 16);
        const stepInBar = i % 16;
        const section = chordProgression[barIndex % chordProgression.length];

        if (stepInBar === 0) {
          playChord(time, section.chord, step * 16);
        }
        if (stepInBar === 0 || stepInBar === 6 || stepInBar === 10) playKick(time);
        if (stepInBar === 4 || stepInBar === 12) playSnare(time, cycleNoiseBuffer);
        if (stepInBar % 2 === 0) playHat(time, cycleNoiseBuffer);
        if ([0, 3, 6, 10, 13].includes(stepInBar)) playBass(time, section.bass);
        if ([2, 5, 8, 11, 14].includes(stepInBar)) {
          playArp(time, section.arp[(stepInBar + barIndex) % section.arp.length]);
        }
      }
    };

    schedulePattern();
    radioBeatTimerRef.current = window.setInterval(schedulePattern, patternLength * 1000);
  }, []);

  const setRadioBeatVolume = useCallback((volume: number, fadeSeconds = 0.18) => {
    const beatGain = radioBeatGainRef.current;
    if (!beatGain) return;

    const now = beatGain.context.currentTime;
    beatGain.gain.cancelScheduledValues(now);
    beatGain.gain.setTargetAtTime(volume, now, fadeSeconds);
  }, []);

  const setRadioPlayingState = useCallback((value: boolean) => {
    if (isMountedRef.current) {
      setIsRadioPlaying(value);
    }
    // 他のインスタンス(ページを離れて戻った後の新しいインスタンス等)にも反映させる
    window.dispatchEvent(new CustomEvent(SEARCH_RADIO_STATE_EVENT));
  }, []);

  const stopRadioBeat = useCallback(() => {
    if (radioBeatTimerRef.current !== null) {
      window.clearInterval(radioBeatTimerRef.current);
      radioBeatTimerRef.current = null;
    }
    if (radioBeatGainRef.current) {
      radioBeatGainRef.current.gain.setValueAtTime(0.0001, radioBeatGainRef.current.context.currentTime);
      radioBeatGainRef.current.disconnect();
      radioBeatGainRef.current = null;
    }
  }, []);

  const stopRadio = useCallback(() => {
    if (
      window.__limeSearchRadioOwnerId &&
      window.__limeSearchRadioOwnerId !== radioInstanceIdRef.current &&
      window.__limeSearchRadioStop
    ) {
      window.__limeSearchRadioStop();
      window.__limeSearchRadioIsPlaying = false;
      setRadioPlayingState(false);
      return;
    }

    speechSessionRef.current += 1;
    clearRadioSpeakTimer();
    radioPlayingRef.current = false;
    window.__limeSearchRadioIsPlaying = false;
    if (window.__limeSearchRadioOwnerId === radioInstanceIdRef.current) {
      window.__limeSearchRadioOwnerId = undefined;
      window.__limeSearchRadioStop = undefined;
    }
    setRadioPlayingState(false);
    stopRadioBeat();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (backgroundAudioRef.current) {
      backgroundAudioRef.current.pause();
      backgroundAudioRef.current.currentTime = 0;
    }
  }, [clearRadioSpeakTimer, setRadioPlayingState, stopRadioBeat]);

  const playRadio = useCallback(() => {
    if (!('speechSynthesis' in window)) return;

    if (
      window.__limeSearchRadioOwnerId &&
      window.__limeSearchRadioOwnerId !== radioInstanceIdRef.current &&
      window.__limeSearchRadioStop
    ) {
      window.__limeSearchRadioStop();
    }

    // 新しい再生セッションを開始し、古い発話・タイマーの影響を断つ
    speechSessionRef.current += 1;
    const session = speechSessionRef.current;
    clearRadioSpeakTimer();

    window.__limeSearchRadioOwnerId = radioInstanceIdRef.current;
    window.__limeSearchRadioStop = stopRadio;
    window.__limeSearchRadioIsPlaying = true;
    radioPlayingRef.current = true;
    setRadioPlayingState(true);
    window.speechSynthesis.cancel();
    window.speechSynthesis.getVoices();
    stopRadioBeat();

    if (!backgroundAudioUrlRef.current) {
      backgroundAudioUrlRef.current = createSilentAudioUrl();
    }

    if (!backgroundAudioRef.current) {
      backgroundAudioRef.current = new Audio(backgroundAudioUrlRef.current);
      backgroundAudioRef.current.loop = true;
      backgroundAudioRef.current.preload = 'auto';
    }

    backgroundAudioRef.current.play().catch(() => {
      // ブラウザ側でバックグラウンド保持用audioが拒否されても、読み上げ自体は続ける
    });

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'ベータラジオ',
        artist: '検索ページ',
        album: 'ニュース',
      });
      navigator.mediaSession.setActionHandler('play', () => {
        if (!radioPlayingRef.current) {
          radioPlayingRef.current = true;
          setRadioPlayingState(true);
        }
        backgroundAudioRef.current?.play().catch(() => {
          // ブラウザ側で再開が拒否された場合は、次のユーザー操作で復帰する
        });
        startRadioBeat();
        setRadioBeatVolume(0.24, 0.18);
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
      });
      navigator.mediaSession.setActionHandler('pause', stopRadio);
      navigator.mediaSession.setActionHandler('stop', stopRadio);
    }

    const isCurrentSession = () => radioPlayingRef.current && session === speechSessionRef.current;

    // 修正: Chrome などは長い発話(十数秒以上)を途中で打ち切ることがあるため、
    // 1行ずつに分けて順番に読み上げる。
    const speakChunk = (chunks: string[], index: number) => {
      if (!isCurrentSession()) return;

      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      // ボイス選択は初回だけスコアリングし、以降は使い回す
      if (!cachedVoiceRef.current) {
        cachedVoiceRef.current = getHumanLikeJapaneseVoice();
      }
      const voice = cachedVoiceRef.current;
      if (voice) utterance.voice = voice;
      utterance.lang = 'ja-JP';
      utterance.rate = 0.98;
      utterance.pitch = 1;
      utterance.volume = 1;
      utterance.onend = () => {
        if (!isCurrentSession()) return;

        if (index + 1 < chunks.length) {
          speakChunk(chunks, index + 1);
          return;
        }

        setRadioBeatVolume(0.62, 0.2);
        radioSpeakTimerRef.current = window.setTimeout(() => {
          radioSpeakTimerRef.current = null;
          speak();
        }, 900);
      };
      utterance.onerror = (event) => {
        // 古いセッションの発話や、cancel()による中断では停止しない
        if (session !== speechSessionRef.current) return;
        if (event.error === 'interrupted' || event.error === 'canceled') return;
        stopRadio();
      };

      window.speechSynthesis.speak(utterance);
    };

    const speak = () => {
      if (!isCurrentSession()) return;

      const chunks = `${getRadioTimeIntro()}\n${radioScript}`
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      playRadioJingle();
      stopRadioBeat();
      clearRadioSpeakTimer();
      radioSpeakTimerRef.current = window.setTimeout(() => {
        radioSpeakTimerRef.current = null;
        if (!isCurrentSession()) return;

        startRadioBeat();
        setRadioBeatVolume(0.24, 0.18);
        speakChunk(chunks, 0);
      }, 2450);
    };

    speak();
  }, [clearRadioSpeakTimer, playRadioJingle, radioScript, setRadioBeatVolume, setRadioPlayingState, startRadioBeat, stopRadio, stopRadioBeat]);

  useEffect(() => {
    const keepRadioAlive = () => {
      if (!radioPlayingRef.current) return;

      backgroundAudioRef.current?.play().catch(() => {
        // ブラウザ側で再開が拒否された場合は読み上げ自体は続ける
      });
      startRadioBeat();
      setRadioBeatVolume(0.24, 0.18);

      if ('speechSynthesis' in window && window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    };

    document.addEventListener('visibilitychange', keepRadioAlive);
    window.addEventListener('focus', keepRadioAlive);
    return () => {
      document.removeEventListener('visibilitychange', keepRadioAlive);
      window.removeEventListener('focus', keepRadioAlive);
    };
  }, [setRadioBeatVolume, startRadioBeat]);

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;

    const loadVoices = () => {
      window.speechSynthesis.getVoices();
      // ボイス一覧が変わった場合はキャッシュを破棄して再選択する
      cachedVoiceRef.current = null;
    };

    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
    };
  }, []);

  // 他のインスタンスで再生/停止された場合に、表示上の再生状態を実際の状態へ合わせる。
  useEffect(() => {
    const syncFromWindow = () => {
      if (isMountedRef.current) {
        setIsRadioPlaying(!!window.__limeSearchRadioIsPlaying);
      }
    };
    window.addEventListener(SEARCH_RADIO_STATE_EVENT, syncFromWindow);
    return () => window.removeEventListener(SEARCH_RADIO_STATE_EVENT, syncFromWindow);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return { isRadioPlaying, playRadio, stopRadio };
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

function SearchMediaGrid({ posts, blueskyIds }: SearchMediaGridProps) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<number | null>(null);

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

  const close = useCallback(() => setSelected(null), []);
  const move = useCallback(
    (delta: number) =>
      setSelected((current) => {
        if (current === null) return current;
        const next = current + delta;
        return next < 0 || next >= tiles.length ? current : next;
      }),
    [tiles.length],
  );

  // 修正: 検索し直し・絞り込み変更などでタイルが減ったときに、範囲外のindexが残って
  // ライトボックスが表示されないまま body のスクロールだけロックされ続けるのを防ぐ。
  useEffect(() => {
    setSelected((current) => (current !== null && current >= tiles.length ? null : current));
  }, [tiles.length]);

  useEffect(() => {
    if (selected === null) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      else if (event.key === 'ArrowLeft') move(-1);
      else if (event.key === 'ArrowRight') move(1);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [selected, close, move]);

  const current = selected !== null ? tiles[selected] : null;
  const isBlueskyCurrent = current
    ? blueskyIds.has(current.post.id) || String(current.post.id).startsWith('bsky:')
    : false;

  const lightbox =
    current && typeof document !== 'undefined'
      ? createPortal(
          <div className="fixed inset-0 z-[1000] flex flex-col bg-black/95 text-white" role="dialog" aria-modal="true">
            <div className="flex items-center justify-between px-3 pt-[max(12px,env(safe-area-inset-top))] pb-2">
              <span className="text-[13px] text-white/70">
                {selected! + 1} / {tiles.length}
              </span>
              <button type="button" aria-label="閉じる" onClick={close} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10">
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="relative flex min-h-0 flex-1 items-center justify-center px-2" onClick={close}>
              <div className="flex max-h-full w-full max-w-4xl items-center justify-center" onClick={(e) => e.stopPropagation()}>
                {current.type === 'image' ? (
                  <img src={current.src} alt="" className="max-h-[70vh] max-w-full object-contain" />
                ) : (
                  <div className="aspect-video w-full max-w-3xl overflow-hidden rounded-xl bg-black">
                    <iframe
                      key={current.youtubeId}
                      src={`https://www.youtube-nocookie.com/embed/${current.youtubeId}?autoplay=1&rel=0&playsinline=1`}
                      title="YouTube"
                      className="h-full w-full"
                      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                      allowFullScreen
                    />
                  </div>
                )}
              </div>

              {selected! > 0 && (
                <button type="button" aria-label="前へ" onClick={(e) => { e.stopPropagation(); move(-1); }} className="absolute left-2 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 hover:bg-black/70">
                  <ChevronLeft className="h-6 w-6" />
                </button>
              )}
              {selected! < tiles.length - 1 && (
                <button type="button" aria-label="次へ" onClick={(e) => { e.stopPropagation(); move(1); }} className="absolute right-2 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 hover:bg-black/70">
                  <ChevronRight className="h-6 w-6" />
                </button>
              )}
            </div>

            <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))]">
              <div className="flex items-center gap-3">
                {current.post.author?.avatarUrl ? (
                  <img src={current.post.author.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
                ) : (
                  <div className="h-9 w-9 rounded-full bg-white/15" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-bold">{current.post.author?.displayName}</div>
                  <div className="truncate text-[12px] text-white/60">@{current.post.author?.username}</div>
                </div>
                <span className="flex items-center gap-1 text-[13px] text-white/80">
                  <Heart className="h-4 w-4" />
                  {current.post.likesCount > 0 ? current.post.likesCount : ''}
                </span>
                {isBlueskyCurrent ? (
                  <span className="rounded-full bg-white/15 px-3 py-1 text-[12px] font-bold">Bluesky</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      const id = current.post.id;
                      close();
                      navigate(`/post/${id}`);
                    }}
                    className="rounded-full bg-primary px-4 py-1.5 text-[13px] font-bold text-white hover:opacity-90"
                  >
                    投稿を開く
                  </button>
                )}
              </div>
              {current.post.content && (
                <p className="line-clamp-3 whitespace-pre-wrap break-words text-[13px] text-white/80">{current.post.content}</p>
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div className="grid grid-cols-3 gap-0.5 px-0.5 sm:gap-1 sm:px-0">
        {tiles.map((tile, index) => (
          <button
            key={tile.key}
            type="button"
            onClick={() => setSelected(index)}
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
      {lightbox}
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
  page: number;
  hasMore: boolean;
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

const EMPTY_FEED: FeedState = { items: [], page: 0, hasMore: true, loading: false, loaded: false, error: null };
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

function dedupe(posts: PostWithAuthor[]): PostWithAuthor[] {
  const seen = new Set<string>();
  return posts.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
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
  const [feedsKey, setFeedsKey] = useState('');
  const [mediaKind, setMediaKind] = useState<MediaKind>('all');
  const [blueskyUsers, setBlueskyUsers] = useState<User[]>([]);

  const tokenRef = useRef<Record<FeedMode, number>>({ top: 0, latest: 0, media: 0 });
  const blueskyCacheRef = useRef<Map<string, Promise<BlueskyResult>>>(new Map());
  const blueskyIdsRef = useRef<Set<string>>(new Set());
  const visibilityRef = useRef<Promise<{ conditions: string[]; currentUserId: string | null }> | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const usersById = useMemo(() => new Map(allUsers.map((u) => [u.id, u])), [allUsers]);
  const usersByUsername = useMemo(() => new Map(allUsers.map((u) => [u.username.toLowerCase(), u])), [allUsers]);

  // Bluesky検索は同じ検索語なら結果を使い回す(タブ切り替えで再リクエストしない)
  const getBluesky = useCallback((text: string, includePosts: boolean): Promise<BlueskyResult> => {
    const key = `${text}\u0000${includePosts}`;
    const cached = blueskyCacheRef.current.get(key);
    if (cached) return cached;

    const promise = (searchBluesky(text.trim().replace(/^@+/, ''), { includePosts }) as unknown as Promise<BlueskyResult>).catch(
      (error) => {
        console.error('Bluesky search failed:', error);
        return { posts: [], users: [] } as BlueskyResult;
      },
    );
    blueskyCacheRef.current.set(key, promise);
    return promise;
  }, []);

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
      if (p.source === 'bluesky') return empty;

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

      const { data, error } = await q.range(rangeFrom, rangeTo);
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
      if (excludeBlueskyPosts || p.source === 'lime') return [];
      const text = getPostSearchText(p);
      if (!text) return []; // 語句のない検索(演算子のみ)はLimeNoteだけを検索する

      const result = await getBluesky(text, true);
      const posts = result.posts.map((post: any) => ({
        ...post,
        repostsCount: 0,
        repostedByMe: false,
        author: { ...post.author, coverUrl: '' },
      })) as PostWithAuthor[];
      posts.forEach((post) => blueskyIdsRef.current.add(post.id));
      return posts.filter((post) => postMatchesSearch(post, p, { trustServerTerms: true }));
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
        let currentPage = page;
        let local = await fetchLocalPosts(effective, currentPage, mode);
        let scanned = 0;
        while (local.items.length === 0 && local.hasMore && scanned < MAX_EMPTY_PAGE_SCAN) {
          if (token !== tokenRef.current[mode]) return;
          currentPage += 1;
          scanned += 1;
          local = await fetchLocalPosts(effective, currentPage, mode);
        }

        const extra = page === 0 ? await fetchBlueskyPosts(effective) : [];
        if (token !== tokenRef.current[mode]) return;

        setFeeds((prev) => ({
          ...prev,
          [mode]: {
            items:
              page === 0
                ? sortPosts([...local.items, ...extra], mode)
                : dedupe([...prev[mode].items, ...local.items]),
            page: currentPage,
            hasMore: local.hasMore,
            loading: false,
            loaded: true,
            error: null,
          },
        }));
      } catch (err: any) {
        if (token !== tokenRef.current[mode]) return;
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
    if (!userText || parsed.source === 'lime') {
      setBlueskyUsers([]);
      return;
    }
    getBluesky(userText, false).then((result) => {
      if (!cancelled) setBlueskyUsers(result.users.map(toUser));
    });
    return () => {
      cancelled = true;
    };
  }, [userText, parsed.source, refreshKey, getBluesky]);

  const searchableUsers = useMemo(() => {
    const byId = new Map<string, User>();
    const list = parsed.source === 'bluesky' ? blueskyUsers : [...allUsers, ...blueskyUsers];
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

    return [...blueskyUsers, ...matching.filter((u) => !blueskyIds.has(u.id))].filter(
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
      return <div>{Array.from({ length: 5 }).map((_, i) => <RowSkeleton key={i} />)}</div>;
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
  "relative h-full bg-transparent text-[15px] font-medium text-[rgb(83,100,113)] dark:text-gray-400 data-[state=active]:text-[rgb(15,20,25)] dark:data-[state=active]:text-white data-[state=active]:font-bold data-[state=active]:bg-transparent data-[state=active]:shadow-none hover:bg-black/[0.03] dark:hover:bg-white/5 transition-colors data-[state=active]:after:content-[''] data-[state=active]:after:absolute data-[state=active]:after:bottom-0 data-[state=active]:after:left-1/2 data-[state=active]:after:-translate-x-1/2 data-[state=active]:after:w-12 data-[state=active]:after:h-1 data-[state=active]:after:rounded-full data-[state=active]:after:bg-primary";

// トレンドアイテムの型定義
type TrendItem = {
  title: string;
  traffic: string;
};

// ニュースアイテムの型定義
type NewsItem = {
  id: string;
  title: string;
  content: string;
  category: string;
  created_at: string;
};

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
  const [trends, setTrends] = useState<TrendItem[]>([]);
  const [isTrendsLoading, setIsTrendsLoading] = useState(false);

  // ニュース用ステート
  const [latestNews, setLatestNews] = useState<NewsItem | null>(null);
  const [radioNews, setRadioNews] = useState<NewsItem[]>([]);
  const [isNewsLoading, setIsNewsLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const suggestBoxRef = useRef<HTMLDivElement>(null);
  const appliedSearchParamRef = useRef<string | null>(null);
  const appliedSearchStateRef = useRef<object | null>(null);
  // 下部ナビの検索ボタンのダブルタップで渡される「検索トップへ戻る」リクエストのうち、
  // すでに処理したものを覚えておく(同じ navigation state で二重に処理しないため)。
  const appliedSearchHomeTokenRef = useRef<number | null>(null);

  const { isRadioPlaying, playRadio, stopRadio } = useSearchRadio(radioNews);

  // PC版の検索バー: 入力中のBlueskyユーザーサジェストを取得する。
  // 演算子(from: など)は除き、検索語だけを渡す。
  useEffect(() => {
    const query = getSearchFreeText(inputValue).trim();
    if (!query || excludeBlueskyPosts) {
      setBlueskySuggestionUsers([]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      searchBluesky(normalizeBlueskyQuery(query), { includePosts: false })
        .then((result) => {
          if (cancelled) return;
          setBlueskySuggestionUsers(result.users.slice(0, 3).map((user) => ({
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
            coverUrl: user.coverUrl,
            createdAt: user.createdAt,
            bio: user.bio,
            isOfficial: false,
          })));
        })
        .catch((error) => {
          if (!cancelled) {
            console.error('Bluesky suggestion search failed:', error);
            setBlueskySuggestionUsers([]);
          }
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [inputValue, excludeBlueskyPosts]);

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
        const { data, error } = await supabase
          .from('news_summaries')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(5);

        if (error) throw error;
        if (cancelled) return;
        const newsItems = Array.isArray(data) ? data : [];
        setRadioNews(newsItems);
        setLatestNews(newsItems[0] || null);
      } catch (err) {
        console.error('Failed to fetch news:', err);
      } finally {
        if (!cancelled) setIsNewsLoading(false);
      }
    }
    fetchLatestNews();
    return () => { cancelled = true; };
  }, []);

  // トレンド取得用Effect
  useEffect(() => {
    let cancelled = false;
    async function fetchTrends() {
      setIsTrendsLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke('get-trends', {
          method: 'POST',
          body: {},
        });

        if (error) throw error;
        if (cancelled) return;

        if (Array.isArray(data)) {
          setTrends(data);
        } else if (data && data.error) {
          console.error('Function returned error:', data.error);
          setTrends([]);
        }
      } catch (err) {
        console.error('Failed to fetch trends:', err);
        if (!cancelled) setTrends([]);
      } finally {
        if (!cancelled) setIsTrendsLoading(false);
      }
    }
    fetchTrends();
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
  // <SearchResults> を外して「ニュース/トレンド/おすすめユーザー/ラジオ」の画面を表示させる。
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
    <div className="flex flex-col gap-6">
      {/* 最新ニュースセクション */}
      <div className="px-4">
        <div className="bg-primary/10 dark:bg-primary/5 rounded-2xl border border-primary/20 dark:border-primary/10 overflow-hidden">
          <div className="px-4 py-3 border-b border-primary/20 dark:border-primary/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Newspaper className="w-5 h-5 text-primary" />
              <h2 className="font-extrabold text-xl">ニュース</h2>
            </div>
            {latestNews && (
               <button
                 onClick={() => navigate('/news')}
                 className="text-[11px] font-bold bg-primary text-white px-2 py-0.5 rounded-full uppercase hover:opacity-80 transition-opacity"
               >
                 NEW
               </button>
            )}
          </div>

          {isNewsLoading ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : latestNews ? (
            <div
              className="p-4 flex flex-col gap-2 cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
              onClick={() => navigate('/news')}
            >
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-bold text-primary px-2 py-0.5 bg-primary/10 rounded-md">
                  {latestNews.category}
                </span>
                <span className="text-[12px] text-[rgb(83,100,113)] dark:text-gray-400">
                  {new Date(latestNews.created_at).toLocaleDateString()}
                </span>
              </div>
              <h3 className="font-bold text-[17px] leading-tight hover:underline">
                {latestNews.title}
              </h3>
              <p className="text-[14px] text-[rgb(83,100,113)] dark:text-gray-300 leading-normal line-clamp-3">
                {latestNews.content}
              </p>
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-[rgb(83,100,113)] dark:text-gray-400 text-[14px]">
              現在、表示できるニュースはありません
            </div>
          )}
        </div>
      </div>

      <TrendSection items={trends} loading={isTrendsLoading} onSelect={commitSearch} />

      {/* おすすめユーザーセクション */}
      <div className="px-4">
        <div className="bg-black/[0.02] dark:bg-white/[0.03] rounded-2xl border border-black/[0.03] dark:border-white/[0.05] overflow-hidden">
          <div className="px-4 py-3 border-b border-black/[0.03] dark:border-white/[0.05] flex items-center gap-2">
            <UsersRound className="w-5 h-5 text-primary" />
            <h2 className="font-extrabold text-xl">おすすめユーザー</h2>
          </div>

          {isUsersLoading ? (
            <div className="p-4">
              {Array.from({ length: 3 }).map((_, idx) => (
                <div key={idx} className="flex items-center gap-3 px-1 py-3 border-b last:border-none border-black/[0.03] dark:border-white/[0.05] animate-pulse">
                  <div className="w-12 h-12 rounded-full bg-black/5 dark:bg-white/10 shrink-0" />
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="h-4 w-32 bg-black/5 dark:bg-white/10 rounded" />
                    <div className="h-3 w-24 bg-black/5 dark:bg-white/10 rounded" />
                  </div>
                  <div className="w-24 h-9 rounded-full bg-black/5 dark:bg-white/10 shrink-0" />
                </div>
              ))}
            </div>
          ) : recommendedUsers.length > 0 ? (
            <div className="flex flex-col">
              {recommendedUsers.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center gap-3 px-4 py-3 border-b last:border-none border-black/[0.03] dark:border-white/[0.05] hover:bg-black/[0.02] dark:hover:bg-white/[0.04] transition-colors cursor-pointer"
                  onClick={() => navigate(`/u/${user.username}`)}
                >
                  {user.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt={user.displayName}
                      loading="lazy"
                      className="w-12 h-12 rounded-full object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-black/5 dark:bg-white/10 shrink-0" />
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1">
                      <span className="truncate font-bold text-[16px]">{user.displayName}</span>
                      {user.isOfficial && (
                        <img
                          src={`${import.meta.env.BASE_URL}verified.png`}
                          alt="Official"
                          className="h-4 w-4 shrink-0 translate-y-[0.5px]"
                          loading="eager"
                        />
                      )}
                    </div>
                    <div className="truncate text-[14px] text-[rgb(83,100,113)] dark:text-gray-400">@{user.username}</div>
                  </div>

                  <div
                    className="shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <FollowButton userId={user.id} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-[rgb(83,100,113)] dark:text-gray-400 text-[14px]">
              現在、おすすめユーザーを表示できません
            </div>
          )}
        </div>
      </div>

      {/* ベータラジオセクション */}
      <div className="px-4 pb-6">
        <div className="bg-black/[0.02] dark:bg-white/[0.03] rounded-2xl border border-black/[0.03] dark:border-white/[0.05] overflow-hidden">
          <div className="px-4 py-3 border-b border-black/[0.03] dark:border-white/[0.05] flex items-center gap-2">
            <Radio className="w-5 h-5 text-primary" />
            <h2 className="font-extrabold text-xl">ラジオ</h2>
          </div>

          <div className="p-4 flex items-center justify-between gap-4">
            <div className="min-w-0 flex flex-col gap-1">
              <p className="text-[14px] text-[rgb(83,100,113)] dark:text-gray-400 leading-normal">
                by LimeNote
              </p>
            </div>

            <button
              type="button"
              onClick={isRadioPlaying ? stopRadio : playRadio}
              className="shrink-0 inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-[14px] font-bold text-white hover:opacity-90 transition-opacity"
            >
              {isRadioPlaying ? (
                <>
                  <Square className="w-4 h-4" fill="currentColor" />
                  停止
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" fill="currentColor" />
                  再生
                </>
              )}
            </button>
          </div>
        </div>
      </div>
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
        <div className="max-w-3xl mx-auto w-full px-4">
          <form onSubmit={(e) => { e.preventDefault(); commitSearch(inputValue); }} className="relative">
            <div className={`relative flex items-center h-11 rounded-full transition-all ${
              isInputFocused
                ? 'bg-white dark:bg-black ring-2 ring-primary'
                : 'bg-black/5 dark:bg-white/10'
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
                className="w-full h-full bg-transparent border-none pl-11 pr-20 text-[15px] outline-none dark:placeholder-gray-500"
              />
              {inputValue && (
                <button type="button" onClick={() => { setInputValue(''); inputRef.current?.focus(); }} className="absolute right-11 w-5 h-5 flex items-center justify-center bg-primary rounded-full">
                  <X className="w-3 h-3 text-white" strokeWidth={3} />
                </button>
              )}
              <button
                type="button"
                aria-label="詳細検索"
                aria-expanded={isSearchSettingsOpen}
                onClick={() => setIsSearchSettingsOpen((open) => !open)}
                className="absolute right-3 flex h-7 w-7 items-center justify-center rounded-full text-[rgb(83,100,113)] transition-colors hover:bg-black/10 dark:text-gray-400 dark:hover:bg-white/10"
              >
                <Settings2 className="h-[18px] w-[18px]" />
              </button>
            </div>

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
  const searchTabs = (
        <Tabs value={activeTab} onValueChange={(value) => changeActiveTab(value as SearchTab)} className="w-full max-sm:hidden" data-lime-search-tabs>
          <div className="hidden sm:block">
            <TabsList className="w-full h-[53px] bg-transparent border-b border-black/[0.03] dark:border-white/[0.05] rounded-none p-0 grid grid-cols-4 relative z-20">
              {SEARCH_TABS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value} className={desktopTabTriggerClass}>
                  {tab.label}
                </TabsTrigger>
              ))}
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

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 max-sm:relative max-sm:left-0 max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:gap-0 max-sm:px-1">
        {/* モバイルではこのタブバーの代わりにHeader.tsx側のタブボタンを使う。
            結果の中身は <SearchResults> が activeTab を見て切り替える(タブごとの
            読み込み済み結果は保持され、切り替えても再取得しない)。
            修正: モバイルでは中身が空のTabsがflexの子要素として残り、gap-6の余白だけが
            タブと検索結果の間に入っていたため、モバイルでは要素ごと非表示にして
            余白の原因を取り除いた。 */}
        {!desktopLayout && searchTabs}

        <div className="-mt-2 bg-transparent max-sm:mt-3">
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