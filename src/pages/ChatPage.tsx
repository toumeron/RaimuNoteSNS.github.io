import { isValidElement, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { useTheme } from 'next-themes'
import type { VRM } from '@pixiv/three-vrm'
import type * as THREE from 'three'
import { supabase } from '@/lib/supabase'
import { createPost } from '@/api/posts'
import { formatRelative } from '@/lib/format'
import { useAuth } from "@/hooks/useAuth"
import {
  AudioLines,
  Brain,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Globe,
  History,
  Loader2,
  Maximize2,
  MessageSquare,
  Mic,
  MicOff,
  Minimize2,
  Monitor,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  Pencil,
  Phone,
  Pin,
  PinOff,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  SendHorizontal,
  Share,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Square,
  Tablet,
  Terminal,
  Trash2,
  Upload,
  User,
  Volume2,
  VolumeX,
  Wrench,
  X,
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { toast } from 'sonner'

/* ==================================================================
   LimeAI 拡張: 型定義・モード定義
   ================================================================== */

/* LimeAI チャット拡張機能の共通型 (Kimi風AIチャットアプリから統合) */

type Attachment = {
  name: string
  kind: 'image' | 'text'
  mime: string
  size: number
  /** 画像のdata URL */
  dataUrl?: string
  /** PDF / DOCX / テキストから抽出した本文 */
  text?: string
}

type Source = { title: string; url: string; snippet?: string }

type ToolStep = {
  id: string
  name: string
  args: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  summary?: string
  sources?: Source[]
}

type ArtifactRecord = {
  id: string
  title: string
  type: 'html' | 'svg' | 'markdown' | 'code'
  language?: string
  content: string
}

type Artifact = ArtifactRecord & { messageId: string }

/** 会話モード(現在は通常のチャットのみ) */
type Mode = 'chat'

type AssistantItem = {
  id: string
  slug: string | null
  name: string
  description: string
  systemPrompt: string
  starter: string
  /** 電話に出たときの第一声 */
  greeting: string
  category: string
  builtin: boolean
  gender?: 'female' | 'male'
  lang?: 'ja-JP' | 'en-US'
  pitch?: number
  rate?: number
}

const MODE_META: Record<
  Mode,
  { label: string; short: string; placeholder: string; desc: string }
> = {
  chat: {
    label: 'チャット',
    short: 'チャット',
    placeholder: 'どんなことでもお尋ねください',
    desc: '何でも気軽に相談',
  },
}

/* ==================================================================
   LimeAI 拡張: アシスタントのプリセット
   ================================================================== */

type Preset = {
  slug: string;
  name: string;
  category: string;
  description: string;
  starter: string;
  greeting: string;
  systemPrompt: string;
  gender: "female" | "male";
  lang?: "ja-JP" | "en-US";
  pitch?: number;
  rate?: number;
};

/** 「機能」ではなく「人」として話せるキャラクター。会話の共通ルールは buildContents 側で付与します */
const PRESETS: Preset[] = [
  {
    slug: "nakkar7",
    name: "なか",
    category: "友達",
    gender: "female",
    description: "かわいいイラストレーター〜！",
    starter: "こんにちは",
    greeting: "にゃ〜ん",
    systemPrompt:
      "あなたの名前は「なか」でファンへの丁寧なお礼を中心に穏やかで親しみやすいトーンで投稿し、仕事熱心でファンを大切にしつつ控えめに日常を過ごす優しい性格のイラストレーター。",
  },

    {
    slug: "km170",
    name: "担々麺",
    category: "友達",
    gender: "female",
    description: "猫ちゃん",
    starter: "こんにちは",
    greeting: "にゃ〜ん",
    systemPrompt:
      "あなたの名前は「たんたんめん」でお寿司ともふもふを愛し、引きこもり気味の自由気ままでユーモラスな内向的性格のイラストレーター。",
  },

];

/* ==================================================================
   LimeAI 拡張: ローカル保存 (設定 / メモリ / ピン留め / カスタムアシスタント)
   ================================================================== */

/**
 * ChatPage 拡張機能の設定保存 (ブラウザの localStorage / ユーザーIDごと)。
 * 元アプリではサーバーのDB(Postgres)に保存していた設定・メモリ・アシスタント・ピン留めなどを、
 * Supabase のテーブル定義を変えずに済むよう localStorage に保存しています。
 */

const key = (uid: string | null | undefined, name: string) => `limeai:${uid || 'guest'}:${name}`

function read<T>(uid: string | null | undefined, name: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key(uid, name))
    return raw ? ({ ...(typeof fallback === 'object' && !Array.isArray(fallback) ? fallback : {}), ...JSON.parse(raw) } as T) : fallback
  } catch {
    return fallback
  }
}

function readList<T>(uid: string | null | undefined, name: string): T[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key(uid, name)) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function write(uid: string | null | undefined, name: string, value: unknown) {
  try {
    localStorage.setItem(key(uid, name), JSON.stringify(value))
  } catch {
    /* 容量超過などは無視 */
  }
}

/* ---------- パーソナライズ設定 ---------- */
type ChatSettings = {
  userName: string
  customInstructions: string
  memoryEnabled: boolean
}
const DEFAULT_CHAT_SETTINGS: ChatSettings = { userName: '', customInstructions: '', memoryEnabled: true }
const loadChatSettings = (uid?: string | null) => read<ChatSettings>(uid, 'settings', DEFAULT_CHAT_SETTINGS)

/* ---------- メモリ ---------- */
type MemoryItem = { id: string; content: string }
const loadMemories = (uid?: string | null) => readList<MemoryItem>(uid, 'memories')

/* ---------- チャットごとの付加情報 (ピン留め / モード / アシスタント) ---------- */
type SessionMeta = { pinned?: boolean; mode?: Mode; assistantId?: string | null }
type SessionMetaMap = Record<string, SessionMeta>
const loadSessionMeta = (uid?: string | null) => read<SessionMetaMap>(uid, 'session-meta', {})
const saveSessionMeta = (uid: string | null | undefined, m: SessionMetaMap) => write(uid, 'session-meta', m)

/* ---------- 自作キャラクター ---------- */
type AssistantDraft = {
  id?: string
  name: string
  description: string
  systemPrompt: string
  starter: string
  greeting: string
  gender: 'female' | 'male'
}

function loadCustomAssistants(uid?: string | null): AssistantItem[] {
  return readList<AssistantItem>(uid, 'assistants')
}

function saveCustomAssistant(uid: string | null | undefined, draft: AssistantDraft): AssistantItem[] {
  const list = loadCustomAssistants(uid)
  if (draft.id) {
    const next = list.map((a) => (a.id === draft.id ? { ...a, ...draft, id: a.id } : a))
    write(uid, 'assistants', next)
    return next
  }
  const item: AssistantItem = {
    id: `custom:${crypto.randomUUID()}`,
    slug: null,
    name: draft.name,
    description: draft.description,
    systemPrompt: draft.systemPrompt,
    starter: draft.starter,
    greeting: draft.greeting,
    category: 'カスタム',
    builtin: false,
    gender: draft.gender,
  }
  const next = [...list, item]
  write(uid, 'assistants', next)
  return next
}

function deleteCustomAssistant(uid: string | null | undefined, id: string): AssistantItem[] {
  const next = loadCustomAssistants(uid).filter((a) => a.id !== id)
  write(uid, 'assistants', next)
  return next
}

/* ---------- キャラクターのアイコン画像 (ブラウザ内に保存) ---------- */
type AvatarMap = Record<string, string>

const loadAvatars = (uid?: string | null) => read<AvatarMap>(uid, 'avatars', {})

/** 保存に成功したら true(容量超過などで失敗したら false) */
function saveAvatars(uid: string | null | undefined, map: AvatarMap): boolean {
  try {
    localStorage.setItem(key(uid, 'avatars'), JSON.stringify(map))
    return true
  } catch {
    return false
  }
}

const AVATAR_COLORS: [string, string][] = [
  ['#ffb3c7', '#ff7a9c'],
  ['#a8d8f4', '#4fb3e8'],
  ['#c5b8f5', '#8b6fe0'],
  ['#ffd59a', '#ff9f43'],
  ['#9fe0c2', '#38b17f'],
  ['#f6b7a4', '#e5745a'],
]

/** 初期アイコン(人のシルエット)。キャラクターIDごとに色が決まる */
function defaultAvatarUrl(seed: string): string {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const [c1, c2] = AVATAR_COLORS[h % AVATAR_COLORS.length]
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>` +
    `<rect width="128" height="128" fill="url(#g)"/>` +
    `<circle cx="64" cy="50" r="22" fill="#fff" fill-opacity=".92"/>` +
    `<path d="M20 128c0-27 19-44 44-44s44 17 44 44z" fill="#fff" fill-opacity=".92"/>` +
    `</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const avatarOf = (a: { id: string }, avatars: AvatarMap) => avatars[a.id] || defaultAvatarUrl(a.id)

/** 選んだ画像を中央で正方形に切り抜き、256pxのJPEGにする(localStorageに収まる大きさ) */
async function avatarFromFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('画像ファイルを選んでください')
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const size = 256
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    const sx = (img.naturalWidth - side) / 2
    const sy = (img.naturalHeight - side) / 2
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, size, size)
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
    return canvas.toDataURL('image/jpeg', 0.86)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/* ==================================================================
   LimeAI 拡張: アシスタント(キャラクター)一覧
   ================================================================== */

const BUILTIN_ASSISTANTS: AssistantItem[] = PRESETS.map((p) => ({
  id: `builtin:${p.slug}`,
  slug: p.slug,
  name: p.name,
  description: p.description,
  systemPrompt: p.systemPrompt,
  starter: p.starter,
  greeting: p.greeting,
  category: p.category,
  builtin: true,
  gender: p.gender,
  lang: p.lang,
  pitch: p.pitch,
  rate: p.rate,
}))

const listAssistants = (uid?: string | null): AssistantItem[] => [
  ...BUILTIN_ASSISTANTS,
  ...loadCustomAssistants(uid),
]

const findAssistant = (uid: string | null | undefined, id: string | null | undefined) =>
  id ? listAssistants(uid).find((a) => a.id === id) ?? null : null

/** 電話に出たときの第一声(未設定なら名前だけ名乗る) */
const greetingOf = (a: AssistantItem) => a.greeting?.trim() || `もしもし、${a.name}です。`

/* ==================================================================
   LimeAI 拡張: 追加システム指示の組み立て
   ================================================================== */

/**
 * モード別の追加指示。ChatPage 既存のシステム命令(LimeAI/LimeNote設定)の後ろに追記します。
 * 現在は通常のチャットのみのため、追加指示はありません。
 */
const MODE_PROMPTS: Record<Mode, string> = {
  chat: '',
}

type ExtraPromptCtx = {
  mode: Mode
  assistantPrompt?: string
  /** キャラクターとして会話する場合 true(Markdownで整理する指示を出さない) */
  character?: boolean
  webSearch?: boolean
  voice?: boolean
  /** アシスタント専用の通話モード(電話のように話し言葉で短く答える) */
  call?: boolean
  userName?: string
  customInstructions?: string
  memories?: string[]
}

/** 既存のシステム命令の「■ 応答の絶対ルール」より前に差し込む追加情報を組み立てる */
function buildExtraInstructions(c: ExtraPromptCtx): string {
  const now = new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(new Date())

  const parts: string[] = [
    `現在の日時: ${now} (JST)`,
    c.character
      ? 'コードや数式を出す必要があるときだけ、コードブロック(言語名つき)やKaTeX形式($...$ / $$...$$)を使ってください。画像が添付されたら内容をよく観察して答えてください。'
      : '回答はMarkdownで整理し、コードブロックには言語名を付け、数式はKaTeX形式($...$ / $$...$$)で書いてください。画像が添付されたら内容をよく観察して答えてください。',
  ]
  if (c.assistantPrompt) parts.push(`## あなたの役割 (アシスタント設定)\n${c.assistantPrompt}`)
  if (MODE_PROMPTS[c.mode]) parts.push(MODE_PROMPTS[c.mode])
  if (c.webSearch)
    parts.push('## 検索\n最新情報や確認が必要な話題では、検索ツールが使えるなら調べてから答え、根拠は [1] のように番号で出典を示してください。')
  if (c.voice)
    parts.push(
      '## 音声会話\nあなたの返答は3Dキャラクターが声に出して読み上げます。Markdown記号・箇条書き・絵文字・URLは使わず、親しみやすい話し言葉で、2〜4文の短さで答えてください。',
    )
  if (c.call)
    parts.push(
      '## 通話モード\nあなたは今、ユーザーと電話で通話しています。通話はすでに始まっていて、あなたは電話に出て最初の挨拶を済ませています。キャラクター設定の性格・口調は保ったまま、Markdown記号・箇条書き・表・コードブロック・絵文字・URLは使わず、電話で話すような自然な話し言葉で、1〜3文の短さで答えてください。相づちや「えーっと」のような言葉も自然に使ってかまいません。長い説明が必要なときは要点だけを話し、続きを聞きたいか尋ねてください。',
    )
  if (c.userName) parts.push(`ユーザーの呼び名(ニックネーム): ${c.userName}`)
  if (c.customInstructions) parts.push(`## ユーザーのカスタム指示\n${c.customInstructions}`)
  if (c.memories && c.memories.length)
    parts.push(`## ユーザーについて覚えていること\n${c.memories.map((m) => `- ${m}`).join('\n')}`)
  return parts.join('\n\n')
}

/* ==================================================================
   LimeAI 拡張: 成果物(アーティファクト)の抽出
   ================================================================== */

/** ChatPage の Message から必要な項目だけを見る (型を疎結合にする) */
type ArtifactSourceMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  artifacts?: ArtifactRecord[];
};

const FENCE = /(^|\n)```([\w+-]*)[^\n]*\n([\s\S]*?)(\n```|$)/g;

const PREVIEW_LANGS = new Set(["html", "svg"]);

function titleOf(lang: string, code: string, n: number): string {
  if (lang === "html") {
    const m = code.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (m && m[1].trim()) return m[1].trim().slice(0, 50);
    return n > 1 ? `HTMLデザイン ${n}` : "HTMLデザイン";
  }
  return n > 1 ? `SVG ${n}` : "SVG";
}

/** Extract previewable code fences (html / svg) from a message. Unclosed trailing fence is included (streaming). */
function fenceArtifacts(msg: Pick<ArtifactSourceMessage, "id" | "content">): Artifact[] {
  const out: Artifact[] = [];
  let n = { html: 0, svg: 0 };
  FENCE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FENCE.exec(msg.content))) {
    const lang = m[2].toLowerCase();
    if (!PREVIEW_LANGS.has(lang)) {
      if (m[0].length === 0) FENCE.lastIndex++;
      continue;
    }
    const code = m[3];
    if (lang === "html" && !/<\w+/.test(code)) continue;
    n[lang as "html" | "svg"]++;
    out.push({
      id: `${msg.id}:${out.length}`,
      messageId: msg.id,
      title: titleOf(lang, code, n[lang as "html" | "svg"]),
      type: lang as "html" | "svg",
      language: lang,
      content: code,
    });
    if (m[0].length === 0) FENCE.lastIndex++;
  }
  return out;
}

function messageArtifacts(msg: ArtifactSourceMessage): Artifact[] {
  const tool: Artifact[] = (msg.artifacts || []).map((a) => ({ ...a, messageId: msg.id }));
  return [...tool, ...fenceArtifacts(msg)];
}

function allArtifacts(msgs: ArtifactSourceMessage[]): Artifact[] {
  return msgs.filter((m) => m.role === "assistant").flatMap(messageArtifacts);
}

/** Wrap an html fragment/document so it can be shown in a sandboxed iframe. */
function toSrcDoc(a: Pick<Artifact, "type" | "content">): string {
  if (a.type === "svg") {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;display:grid;place-items:center;background:#fff}svg{max-width:100%;max-height:100vh;height:auto}</style></head><body>${a.content}</body></html>`;
  }
  if (a.type === "html") {
    if (/<html[\s>]/i.test(a.content) || /<!doctype/i.test(a.content)) return a.content;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${a.content}</body></html>`;
  }
  return a.content;
}

function fileNameFor(a: Pick<Artifact, "title" | "type" | "language">): string {
  const base = a.title.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40) || "artifact";
  if (/\.[a-z0-9]{1,5}$/i.test(base)) return base;
  const ext = a.type === "html" ? "html" : a.type === "svg" ? "svg" : a.type === "markdown" ? "md" : a.language || "txt";
  return `${base}.${ext}`;
}

/* ==================================================================
   LimeAI 拡張: 添付ファイル処理
   ================================================================== */

/**
 * 添付ファイルの読み込み。
 * 元アプリでは /api/extract (サーバー) で行っていた PDF / DOCX の本文抽出を、ブラウザ内で行うようにしています。
 */

const MAX_CHARS = 80000
const MAX_BYTES = 25 * 1024 * 1024

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|yaml|yml|toml|ini|log|html|htm|css|scss|js|jsx|mjs|cjs|ts|tsx|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|bash|zsh|sql|r|lua|dart|vue|svelte|tex|srt|env|conf)$/i

async function imageAttachment(file: File): Promise<Attachment> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const max = 1568
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.round(img.naturalWidth * scale)
    const h = Math.round(img.naturalHeight * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    const keepPng = file.type === 'image/png' && file.size < 900 * 1024
    if (!keepPng) {
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, w, h)
    }
    ctx.drawImage(img, 0, 0, w, h)
    const dataUrl = keepPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.86)
    return {
      name: file.name || 'image.png',
      kind: 'image',
      mime: keepPng ? 'image/png' : 'image/jpeg',
      size: file.size,
      dataUrl,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function cleanText(text: string) {
  return text.replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_CHARS)
}

async function extractPdf(file: File): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()))
  const r = await extractText(pdf, { mergePages: true })
  return String(r.text)
}

async function extractDocx(file: File): Promise<string> {
  const mammoth = await import('mammoth')
  const lib = (mammoth as unknown as { default?: typeof mammoth }).default ?? mammoth
  const r = await lib.extractRawText({ arrayBuffer: await file.arrayBuffer() })
  return r.value
}

async function fileToAttachment(file: File): Promise<Attachment> {
  if (file.type.startsWith('image/')) return imageAttachment(file)
  const lower = file.name.toLowerCase()

  if (lower.endsWith('.pdf') || lower.endsWith('.docx')) {
    if (file.size > MAX_BYTES) throw new Error(`${file.name}: 25MBまでのファイルに対応しています`)
    let text = ''
    try {
      text = cleanText(lower.endsWith('.pdf') ? await extractPdf(file) : await extractDocx(file))
    } catch (e) {
      throw new Error(`${file.name}: 解析に失敗しました (${e instanceof Error ? e.message : e})`)
    }
    if (!text) throw new Error(`${file.name}: テキストを抽出できませんでした(スキャン画像のPDFなど)`)
    return { name: file.name, kind: 'text', mime: file.type || 'application/octet-stream', size: file.size, text }
  }

  if (file.type.startsWith('text/') || TEXT_EXT.test(lower) || file.type === 'application/json') {
    const text = (await file.text()).slice(0, MAX_CHARS)
    return { name: file.name, kind: 'text', mime: file.type || 'text/plain', size: file.size, text }
  }

  throw new Error(`${file.name}: 未対応のファイル形式です (画像・PDF・DOCX・テキスト/コードに対応)`)
}

/* ==================================================================
   LimeAI 拡張: 音声合成 / 音声認識
   ================================================================== */

/* Web Speech API helpers: speech synthesis (TTS), recognition (STT) and mic level meter. */

type VoiceOpts = {
  voiceURI?: string;
  lang: string;
  rate: number;
  pitch: number;
  volume: number;
};

function ttsSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function getVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!ttsSupported()) return resolve([]);
    const v = speechSynthesis.getVoices();
    if (v.length) return resolve(v);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      speechSynthesis.removeEventListener("voiceschanged", finish);
      resolve(speechSynthesis.getVoices());
    };
    speechSynthesis.addEventListener("voiceschanged", finish);
    setTimeout(finish, 1500);
  });
}

/** Strip markdown / code so that text is pleasant to read aloud. */
function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " (コードブロック) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/(\*\*|__|\*|_|~~)/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\|/g, " ")
    .replace(/\$\$?[^$]+\$\$?/g, " 数式 ")
    .replace(/https?:\/\/\S+/g, "リンク")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Split text into sentence-sized chunks (Chrome cuts long utterances). */
function splitForSpeech(text: string, max = 80): string[] {
  const out: string[] = [];
  const sentences = text.match(/[^。！？!?\n．.]+[。！？!?．.]*\s*|\n+/g) || [text];
  let cur = "";
  const push = () => {
    if (cur.trim()) out.push(cur);
    cur = "";
  };
  for (const s of sentences) {
    if (/^\n+$/.test(s)) {
      cur += s;
      push();
      continue;
    }
    if (s.length > max) {
      push();
      const parts = s.match(new RegExp(`[\\s\\S]{1,${max}}(?:[、,，\\s]|$)|[\\s\\S]{1,${max}}`, "g")) || [s];
      out.push(...parts.filter((p) => p.trim()));
      continue;
    }
    if ((cur + s).length > max) push();
    cur += s;
  }
  push();
  return out;
}

type SpeakHooks = {
  onChunkStart?: (chunk: string, offset: number) => void;
  onBoundary?: (charIndex: number) => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
};

class Speaker {
  private token = 0;
  private _speaking = false;
  get speaking() {
    return this._speaking;
  }

  speak(text: string, opts: VoiceOpts, hooks: SpeakHooks = {}) {
    if (!ttsSupported()) {
      hooks.onError?.("このブラウザは音声合成(Web Speech API)に対応していません");
      return;
    }
    this.cancel();
    const token = ++this.token;
    const chunks = splitForSpeech(text);
    if (!chunks.length) {
      hooks.onEnd?.();
      return;
    }
    const offsets: number[] = [];
    let cursor = 0;
    for (const c of chunks) {
      const idx = text.indexOf(c, cursor);
      offsets.push(idx >= 0 ? idx : cursor);
      cursor = (idx >= 0 ? idx : cursor) + c.length;
    }
    const voices = speechSynthesis.getVoices();
    const voice = opts.voiceURI ? voices.find((v) => v.voiceURI === opts.voiceURI) : undefined;
    this._speaking = true;

    const finish = () => {
      if (token !== this.token) return;
      this._speaking = false;
      hooks.onEnd?.();
    };
    const next = (i: number) => {
      if (token !== this.token) return;
      if (i >= chunks.length) return finish();
      const u = new SpeechSynthesisUtterance(chunks[i]);
      u.lang = voice?.lang || opts.lang;
      if (voice) u.voice = voice;
      u.rate = opts.rate;
      u.pitch = opts.pitch;
      u.volume = opts.volume;
      let started = false;
      u.onstart = () => {
        started = true;
        if (token === this.token) hooks.onChunkStart?.(chunks[i], offsets[i]);
      };
      u.onboundary = (e) => {
        if (token === this.token) hooks.onBoundary?.(offsets[i] + e.charIndex);
      };
      u.onend = () => next(i + 1);
      u.onerror = (e) => {
        if (token !== this.token) return;
        if (e.error === "canceled" || e.error === "interrupted") return;
        this._speaking = false;
        hooks.onError?.(`音声合成エラー: ${e.error}`);
      };
      speechSynthesis.speak(u);
      // Some engines never fire events when no voice is available – guard against silent hang.
      setTimeout(() => {
        if (token === this.token && !started && !speechSynthesis.speaking && !speechSynthesis.pending) {
          this._speaking = false;
          hooks.onError?.("音声を再生できませんでした。ブラウザに音声(TTS)が入っているか確認してください");
        }
      }, 4000);
    };
    // cancel() right before speak() is flaky in Chrome; wait a tick.
    setTimeout(() => next(0), 60);
  }

  cancel() {
    this.token++;
    this._speaking = false;
    if (ttsSupported()) speechSynthesis.cancel();
  }
}

/* ---------------- recognition ---------------- */

type SR = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

function srCtor(): (new () => SR) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function sttSupported() {
  return !!srCtor();
}

type ListenHandlers = {
  onStart?: () => void;
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onEnd?: () => void;
  onError?: (code: string) => void;
};

class Listener {
  private rec: SR | null = null;
  start(lang: string, h: ListenHandlers) {
    const C = srCtor();
    if (!C) {
      h.onError?.("unsupported");
      return;
    }
    this.abort();
    const rec = new C();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onstart = () => h.onStart?.();
    rec.onresult = (e) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (interim) h.onInterim?.(interim);
      if (final) h.onFinal?.(final);
    };
    rec.onerror = (e) => h.onError?.(e.error);
    rec.onend = () => {
      if (this.rec === rec) this.rec = null;
      h.onEnd?.();
    };
    this.rec = rec;
    try {
      rec.start();
    } catch (e) {
      h.onError?.(e instanceof Error ? e.message : "start-failed");
    }
  }
  stop() {
    try {
      this.rec?.stop();
    } catch {
      /* ignore */
    }
  }
  abort() {
    const r = this.rec;
    this.rec = null;
    if (r) {
      r.onend = null;
      r.onerror = null;
      r.onresult = null;
      try {
        r.abort();
      } catch {
        /* ignore */
      }
    }
  }
}

/** Microphone level meter (0..1) for the listening visualisation. */
async function startMeter(onLevel: (v: number) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  src.connect(an);
  const buf = new Uint8Array(an.fftSize);
  let raf = 0;
  const tick = () => {
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
    raf = requestAnimationFrame(tick);
  };
  tick();
  return () => {
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
    onLevel(0);
  };
}

/* ==================================================================
   LimeAI 拡張: リップシンク・感情推定
   ================================================================== */

/* Lip sync driver for speechSynthesis (which exposes no audio stream).
 * We estimate the currently pronounced character from timing, re-synchronised on `boundary` events,
 * map kana -> vowel visemes and shape the mouth opening as a syllable envelope. */

type Vowel = "aa" | "ih" | "ou" | "ee" | "oh";
type Emotion = "neutral" | "happy" | "sad" | "angry" | "surprised" | "relaxed";

const ROWS: [Vowel, string][] = [
  ["aa", "あかさたなはまやらわがざだばぱぁゃゎ"],
  ["ih", "いきしちにひみりぎじぢびぴぃゐ"],
  ["ou", "うくすつぬふむゆるぐずづぶぷぅゅゔ"],
  ["ee", "えけせてねへめれげぜでべぺぇゑ"],
  ["oh", "おこそとのほもよろをごぞどぼぽぉょ"],
];
const MAP = new Map<string, Vowel>();
for (const [v, chars] of ROWS) for (const c of chars) MAP.set(c, v);
const LATIN: Record<string, Vowel> = { a: "aa", i: "ih", u: "ou", e: "ee", o: "oh" };
const VOWELS: Vowel[] = ["aa", "ih", "ou", "ee", "oh"];
const AMP: Record<Vowel, number> = { aa: 1, oh: 0.85, ee: 0.65, ih: 0.5, ou: 0.55 };

const PAUSE = /[、。，．,.!?！？\n\s…・「」『』()（）:：;；]/;

function toHiragana(ch: string) {
  const c = ch.charCodeAt(0);
  return c >= 0x30a1 && c <= 0x30f6 ? String.fromCharCode(c - 0x60) : ch;
}

type Sample = { vowel: Vowel; open: number; pause: boolean };

class LipSync {
  private text = "";
  private baseIndex = 0;
  private baseTime = 0;
  private rate = 1;
  private lastVowel: Vowel = "aa";
  active = false;

  begin(text: string, rate: number) {
    this.text = text;
    this.rate = rate;
    this.baseIndex = 0;
    this.baseTime = performance.now();
    this.active = true;
  }

  /** Called when a new utterance chunk starts: text is the full text, offset is chunk offset. */
  chunk(offset: number) {
    this.baseIndex = offset;
    this.baseTime = performance.now();
  }

  boundary(charIndex: number) {
    this.baseIndex = charIndex;
    this.baseTime = performance.now();
  }

  end() {
    this.active = false;
  }

  /** Estimated index (float) of the character currently being pronounced. */
  position(now: number) {
    return this.active ? this.baseIndex + ((now - this.baseTime) / 1000) * 7.2 * this.rate : 0;
  }

  sample(now: number): Sample {
    if (!this.active || !this.text) return { vowel: "aa", open: 0, pause: true };
    const cps = 7.2 * this.rate;
    const pos = this.baseIndex + ((now - this.baseTime) / 1000) * cps;
    // 文字数を超えて推定位置が進んだ場合は口を閉じる(最後の文字で口が開きっぱなしになるのを防ぐ)
    if (pos >= this.text.length + 1) return { vowel: this.lastVowel, open: 0, pause: true };
    const i = Math.min(Math.floor(pos), this.text.length - 1);
    if (i < 0) return { vowel: this.lastVowel, open: 0, pause: true };
    let frac = pos - Math.floor(pos);
    const raw = this.text[i];
    const ch = toHiragana(raw).toLowerCase();
    if (PAUSE.test(ch)) return { vowel: this.lastVowel, open: 0, pause: true };
    let vowel: Vowel | undefined = MAP.get(ch);
    if (ch === "ー") vowel = this.lastVowel;
    else if (ch === "ん" || ch === "っ") return { vowel: this.lastVowel, open: 0.08, pause: false };
    else if (LATIN[ch]) vowel = LATIN[ch];
    else if (!vowel) {
      // 漢字などは2音節ぶんとして扱い、前半・後半で母音を変える(口の動きが自然になる)
      const half = frac < 0.5 ? 0 : 1;
      vowel = VOWELS[(raw.charCodeAt(0) * 7 + i + half * 3) % 5];
      frac = (frac * 2) % 1;
    }
    this.lastVowel = vowel;
    // syllable envelope: open quickly, close before the next character
    const env = Math.sin(Math.PI * Math.min(1, frac * 0.95 + 0.04));
    return { vowel, open: Math.max(0.12, env) * AMP[vowel], pause: false };
  }
}

/**
 * 返答テキストから表情を推定する。
 * 「!」だけで喜びになる・「ダメ」で怒りになるなどの誤判定を避けるため、はっきりした語だけを対象にする。
 */
function detectEmotion(text: string): Emotion {
  const t = text.toLowerCase();
  if (/(悲しい|かなしい|ごめん|すみません|申し訳|残念|つらい|辛い|寂しい|さみしい|泣|sorry|sad|unfortunately)/.test(t)) return "sad";
  if (/(怒|むかつく|ふざけ|許さない|最悪|angry|hate)/.test(t)) return "angry";
  if (/(えっ|びっくり|驚|まさか|嘘|うそ|！！|!!|\?!|wow|surprise)/.test(t)) return "surprised";
  if (/(ありがとう|うれしい|嬉しい|楽しい|やった|大好き|最高|素敵|すてき|かわいい|可愛い|おめでとう|わーい|♪|♡|thanks|great|love|happy|awesome)/.test(t)) return "happy";
  if (/(おやすみ|ゆっくり|のんびり|ほっと|安心|ふふ|リラックス|relax|calm)/.test(t)) return "relaxed";
  return "neutral";
}

/* ==================================================================
   LimeAI 拡張: アバターバス
   ================================================================== */

type ModelFormat = "vrm" | "glb" | "mmd";

type ModelSource =
  | { kind: "url"; url: string; name: string; format?: ModelFormat }
  | { kind: "blob"; blob: Blob; name: string; format?: ModelFormat };


/** MMD(PMX/PMD) の ZIP 配布物をブラウザ内でそのまま展開する小型 ZIP リーダー。
 * 外部サーバーへアップロードせず、圧縮方式は store / deflate をサポートする。
 */
type ZipEntry = { name: string; data: Uint8Array; compression: number };

function decodeZipName(bytes: Uint8Array, utf8Flag: boolean) {
  if (utf8Flag) return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (!utf8.includes("�")) return utf8;
  try { return new TextDecoder("shift_jis").decode(bytes); } catch { return utf8; }
}

function zipPath(name: string) {
  const out: string[] = [];
  for (const part of name.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function zipMime(name: string) {
  const ext = name.toLowerCase().split(".").pop() || "";
  return ({
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
    bmp: "image/bmp", tga: "image/x-targa", vpd: "text/plain",
  } as Record<string, string>)[ext] || "application/octet-stream";
}

async function unzipForMmd(file: Blob): Promise<ZipEntry[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minEocd = 22;
  const start = Math.max(0, bytes.length - minEocd - 0xffff);
  let eocd = -1;
  for (let i = bytes.length - minEocd; i >= start; i--) {
    if (i >= 0 && dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("ZIPの終端情報を読み取れませんでした");

  const count = dv.getUint16(eocd + 10, true);
  const centralSize = dv.getUint32(eocd + 12, true);
  const centralOffset = dv.getUint32(eocd + 16, true);
  if (centralOffset + centralSize > bytes.length) throw new Error("ZIPの中央ディレクトリが壊れています");
  if (count > 800) throw new Error("ZIP内のファイル数が多すぎます (800ファイルまで)");

  const entries: ZipEntry[] = [];
  let pos = centralOffset;
  let totalUncompressed = 0;
  const MAX_EXTRACTED = 450 * 1024 * 1024;

  for (let i = 0; i < count; i++) {
    if (dv.getUint32(pos, true) !== 0x02014b50) throw new Error("ZIPのエントリを読み取れませんでした");
    const flags = dv.getUint16(pos + 8, true);
    const compression = dv.getUint16(pos + 10, true);
    const compressedSize = dv.getUint32(pos + 20, true);
    const uncompressedSize = dv.getUint32(pos + 24, true);
    const nameLen = dv.getUint16(pos + 28, true);
    const extraLen = dv.getUint16(pos + 30, true);
    const commentLen = dv.getUint16(pos + 32, true);
    const localOffset = dv.getUint32(pos + 42, true);
    const nameBytes = bytes.slice(pos + 46, pos + 46 + nameLen);
    const name = zipPath(decodeZipName(nameBytes, (flags & 0x800) !== 0));
    pos += 46 + nameLen + extraLen + commentLen;
    if (!name || name.endsWith("/")) continue;

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_EXTRACTED) throw new Error("ZIP展開後のサイズが大きすぎます (450MBまで)");
    if (localOffset + 30 > bytes.length || dv.getUint32(localOffset, true) !== 0x04034b50) throw new Error("ZIPのローカルヘッダーが壊れています");
    const localNameLen = dv.getUint16(localOffset + 26, true);
    const localExtraLen = dv.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) throw new Error(`ZIP内のファイルが壊れています: ${name}`);
    const compressed = bytes.slice(dataStart, dataEnd);

    let data: Uint8Array;
    if (compression === 0) {
      data = compressed;
    } else if (compression === 8) {
      if (typeof DecompressionStream === "undefined") throw new Error("このブラウザはZIP展開に対応していません。Chrome / Edge / Safariの最新版をお使いください");
      const compressedBuffer = new Uint8Array(compressed.byteLength);
      compressedBuffer.set(compressed);
      const stream = new Blob([compressedBuffer.buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    } else {
      throw new Error(`未対応のZIP圧縮方式です (${compression}: ${name})`);
    }
    if (uncompressedSize && data.length !== uncompressedSize) throw new Error(`ZIP展開サイズが一致しません: ${name}`);
    entries.push({ name, data, compression });
  }

  if (!entries.some((e) => /\.(pmx|pmd)$/i.test(e.name))) throw new Error("ZIP内にPMX / PMDモデルが見つかりませんでした");
  return entries;
}

function pickMmdModel(entries: ZipEntry[]) {
  const models = entries.filter((e) => /\.(pmx|pmd)$/i.test(e.name));
  models.sort((a, b) => {
    const rank = (e: ZipEntry) => (e.name.toLowerCase().endsWith(".pmx") ? 1000 : 0) - e.name.split("/").length * 10 + e.data.length / 1e7;
    return rank(b) - rank(a);
  });
  return models[0];
}

function inferModelFormat(name: string): ModelFormat {
  if (/\.(pmx|pmd|zip)$/i.test(name)) return "mmd";
  return /\.vrm$/i.test(name) ? "vrm" : "glb";
}

function mmdVowelOf(name: string): Vowel | null {
  const n = name.trim().toLowerCase();
  if (/^(あ|a|aa|ah|mouth[_ -]?open|口開|口開き|openmouth)(\d+)?$/.test(n)) return "aa";
  if (/^(い|i|ih)(\d+)?$/.test(n)) return "ih";
  if (/^(う|u|ou)(\d+)?$/.test(n)) return "ou";
  if (/^(え|e|ee)(\d+)?$/.test(n)) return "ee";
  if (/^(お|o|oh)(\d+)?$/.test(n)) return "oh";
  return null;
}

function mmdEmotionOf(name: string): Emotion | null {
  const n = name.trim().toLowerCase();
  if (/(笑顔|笑い|にこ|smile|happy|joy)/.test(n)) return "happy";
  if (/(悲|泣|涙|sad|sorrow)/.test(n)) return "sad";
  if (/(怒|険|angry|anger)/.test(n)) return "angry";
  if (/(驚|びっくり|surprise|shock)/.test(n)) return "surprised";
  if (/(照れ|安心|ほっ|relax|calm)/.test(n)) return "relaxed";
  return null;
}

type GestureName = "wave" | "nod" | "bow" | "cheer";
type CameraPreset = "bust" | "face" | "full";

/** Mutable state shared between the UI (React) and the render loop (three.js) – read every frame. */
type AvatarBus = {
  lip: LipSync;
  speaking: boolean;
  listening: boolean;
  thinking: boolean;
  micLevel: number;
  emotion: Emotion;
  gesture: { name: GestureName; id: number } | null;
  /** ジェスチャーIDの通し番号(UI側・3D側どちらから発火してもIDが衝突しないよう1か所で採番する) */
  gestureSeq: number;
};

type ModelInfo = {
  kind: "vrm" | "glb" | "mmd";
  name: string;
  vrmVersion?: string;
  expressions: string[];
  lipSync: boolean;
  title?: string;
  author?: string;
  format?: string;
  modelFile?: string;
  packageFiles?: number;
};

type StageStatus =
  | { state: "loading"; progress: number }
  | { state: "ready"; info: ModelInfo }
  | { state: "error"; message: string };

function createBus(lip: LipSync): AvatarBus {
  return { lip, speaking: false, listening: false, thinking: false, micLevel: 0, emotion: "neutral", gesture: null, gestureSeq: 0 };
}

/** ジェスチャーを発火する(IDは必ず単調増加) */
function triggerGesture(bus: AvatarBus, name: GestureName) {
  bus.gesture = { name, id: ++bus.gestureSeq };
}

/* ==================================================================
   LimeAI 拡張: 3Dモデル保存 (IndexedDB)
   ================================================================== */

/* Persist user-uploaded VRM / GLB models in IndexedDB (no server upload). */

const DB_NAME = "limeai-avatar";
const STORE = "models";

type StoredModel = { id: string; name: string; blob: Blob; createdAt: number; format?: ModelFormat };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }),
  );
}

const listModels = () => tx<StoredModel[]>("readonly", (s) => s.getAll());
const putModel = (m: StoredModel) => tx("readwrite", (s) => s.put(m));
const deleteModel = (id: string) => tx("readwrite", (s) => s.delete(id));
const getModel = (id: string) => tx<StoredModel | undefined>("readonly", (s) => s.get(id));

/* ==================================================================
   LimeAI 拡張: コード実行 (JS / Python)
   ================================================================== */

/* In-browser code runners: JavaScript (Web Worker) and Python (Pyodide in a Web Worker). */

type RunLine = { level: "log" | "error" | "result" | "info"; text: string };
type RunHandle = { promise: Promise<void>; cancel: () => void };

const JS_WORKER = `
const fmt = (a) => { if (typeof a === 'string') return a; try { return JSON.stringify(a, null, 2) ?? String(a); } catch { return String(a); } };
const mk = (level) => (...args) => self.postMessage({ type: 'line', level, text: args.map(fmt).join(' ') });
console.log = mk('log'); console.info = mk('info'); console.warn = mk('log'); console.error = mk('error'); console.debug = mk('log');
self.onmessage = async (e) => {
  try {
    const AF = Object.getPrototypeOf(async function(){}).constructor;
    const r = await new AF(e.data.code)();
    if (r !== undefined) self.postMessage({ type: 'line', level: 'result', text: '=> ' + fmt(r) });
    self.postMessage({ type: 'done' });
  } catch (err) {
    self.postMessage({ type: 'line', level: 'error', text: (err && err.stack) || String(err) });
    self.postMessage({ type: 'done' });
  }
};`;

const PY_WORKER = `
let pyodide = null;
let ready = null;
async function init() {
  importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.2/full/pyodide.js');
  pyodide = await loadPyodide();
  pyodide.setStdout({ batched: (t) => self.postMessage({ type: 'line', level: 'log', text: t }) });
  pyodide.setStderr({ batched: (t) => self.postMessage({ type: 'line', level: 'error', text: t }) });
}
self.onmessage = async (e) => {
  try {
    if (!ready) { self.postMessage({ type: 'line', level: 'info', text: 'Python(Pyodide)を読み込み中…初回のみ数秒かかります' }); ready = init(); }
    await ready;
    try { await pyodide.loadPackagesFromImports(e.data.code); } catch (_) {}
    const r = await pyodide.runPythonAsync(e.data.code);
    if (r !== undefined && r !== null) self.postMessage({ type: 'line', level: 'result', text: '=> ' + String(r) });
  } catch (err) {
    self.postMessage({ type: 'line', level: 'error', text: String((err && err.message) || err) });
  }
  self.postMessage({ type: 'done' });
};`;

function makeWorker(src: string) {
  const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
  const w = new Worker(url);
  return { w, url };
}

let pyWorker: { w: Worker; url: string } | null = null;

function normalizeLang(lang: string): "js" | "py" | null {
  const l = lang.toLowerCase();
  if (["js", "javascript", "node", "mjs"].includes(l)) return "js";
  if (["py", "python", "python3"].includes(l)) return "py";
  return null;
}

function runCode(kind: "js" | "py", code: string, onLine: (l: RunLine) => void, timeoutMs = 20000): RunHandle {
  let cancel = () => {};
  const promise = new Promise<void>((resolve) => {
    let wk: { w: Worker; url: string };
    if (kind === "py") {
      pyWorker = pyWorker || makeWorker(PY_WORKER);
      wk = pyWorker;
    } else {
      wk = makeWorker(JS_WORKER);
    }
    let finished = false;
    const finish = (kill: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      wk.w.onmessage = null;
      if (kind === "js") {
        wk.w.terminate();
        URL.revokeObjectURL(wk.url);
      } else if (kill) {
        wk.w.terminate();
        URL.revokeObjectURL(wk.url);
        pyWorker = null;
      }
      resolve();
    };
    const limit = kind === "py" ? Math.max(timeoutMs, 60000) : timeoutMs;
    const timer = setTimeout(() => {
      onLine({ level: "error", text: `実行がタイムアウトしました (${Math.round(limit / 1000)}秒)` });
      finish(true);
    }, limit);
    wk.w.onmessage = (e: MessageEvent) => {
      if (e.data.type === "line") onLine({ level: e.data.level, text: e.data.text });
      else if (e.data.type === "done") finish(false);
    };
    wk.w.onerror = (e) => {
      onLine({ level: "error", text: e.message || "Worker error" });
      finish(true);
    };
    cancel = () => {
      onLine({ level: "info", text: "実行を停止しました" });
      finish(true);
    };
    wk.w.postMessage({ code });
  });
  return { promise, cancel: () => cancel() };
}

/* ==================================================================
   LimeAI 拡張: 追加スタイル
   ================================================================== */

/**
 * ChatPage に統合した機能(Markdown / コードブロック / プレビューパネル / ボイスモード)用のスタイル。
 * ChatPage の VPOP_STYLES と同じ .vpop-root 配下にスコープしており、--nr-* トークン(ライト/ダーク対応)を使います。
 */
const CHAT_EXT_STYLES = `
.vpop-root {
  --chat-mono: 'JetBrains Mono', 'Roboto Mono', 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace;
}

/* ---------- markdown ---------- */
.vpop-root .md { font-size: 16px; line-height: 1.85; color: var(--nr-ink); word-break: break-word; overflow-wrap: anywhere; white-space: normal; }
.vpop-root .md > *:first-child { margin-top: 0; }
.vpop-root .md > *:last-child { margin-bottom: 0; }
.vpop-root .md p { margin: .7em 0; }
.vpop-root .md h1, .vpop-root .md h2, .vpop-root .md h3, .vpop-root .md h4 { font-weight: 650; line-height: 1.4; margin: 1.4em 0 .6em; }
.vpop-root .md h1 { font-size: 1.5em; }
.vpop-root .md h2 { font-size: 1.3em; }
.vpop-root .md h3 { font-size: 1.14em; }
.vpop-root .md ul, .vpop-root .md ol { margin: .6em 0; padding-left: 1.6em; }
.vpop-root .md ul { list-style: disc; }
.vpop-root .md ol { list-style: decimal; }
.vpop-root .md li { margin: .3em 0; }
.vpop-root .md li::marker { color: var(--nr-ink-sub); }
.vpop-root .md a { color: var(--nr-blue-deep); text-decoration: none; }
.vpop-root .md a:hover { text-decoration: underline; }
.vpop-root .md blockquote { margin: .9em 0; padding: .2em 1em; border-left: 3px solid var(--nr-silver-3); color: var(--nr-ink-sub); }
.vpop-root .md hr { border: none; border-top: 1px solid var(--nr-silver-3); margin: 1.4em 0; }
.vpop-root .md :not(pre) > code { font-family: var(--chat-mono); font-size: .87em; background: var(--nr-silver-2); border-radius: 6px; padding: .15em .4em; }
.vpop-root .md .table-wrap { overflow-x: auto; margin: 1em 0; border: 1px solid var(--nr-silver-3); border-radius: 12px; }
.vpop-root .md table { border-collapse: collapse; width: 100%; font-size: .93em; }
.vpop-root .md th, .vpop-root .md td { padding: .55em .9em; border-bottom: 1px solid var(--nr-silver-3); text-align: left; white-space: nowrap; }
.vpop-root .md td { white-space: normal; min-width: 6em; }
.vpop-root .md th { background: var(--nr-silver-1); font-weight: 600; }
.vpop-root .md tr:last-child td { border-bottom: none; }
.vpop-root .md img { max-width: 100%; border-radius: 12px; }
.vpop-root .md .katex-display { overflow-x: auto; overflow-y: hidden; padding: .3em 0; }
.vpop-root .md sup.cite {
  display: inline-block; font-size: .72em; line-height: 1; min-width: 1.5em; text-align: center;
  padding: .25em .3em; margin: 0 .15em; border-radius: 999px; background: var(--nr-blue-pale);
  color: var(--nr-blue-deep); vertical-align: baseline; position: relative; top: -.25em; font-weight: 600;
}
.vpop-root .md sup.cite a { color: inherit; text-decoration: none; }

/* ---------- code blocks ---------- */
.vpop-root .codeblock { margin: 1em 0; border: 1px solid var(--nr-silver-3); border-radius: 14px; overflow: hidden; background: var(--nr-silver-1); }
.vpop-root .codeblock pre { margin: 0; padding: 14px 16px; overflow-x: auto; font-family: var(--chat-mono); font-size: 13.2px; line-height: 1.65; white-space: pre; }
.vpop-root .codeblock code { font-family: inherit; background: none !important; padding: 0 !important; }
.vpop-root .hljs-comment, .vpop-root .hljs-quote { color: #8a919c; font-style: italic; }
.vpop-root .hljs-keyword, .vpop-root .hljs-selector-tag, .vpop-root .hljs-literal, .vpop-root .hljs-doctag, .vpop-root .hljs-name { color: #cf222e; }
.vpop-root .hljs-string, .vpop-root .hljs-regexp, .vpop-root .hljs-addition { color: #0a7d4e; }
.vpop-root .hljs-number, .vpop-root .hljs-symbol, .vpop-root .hljs-bullet { color: #0550ae; }
.vpop-root .hljs-title, .vpop-root .hljs-title.class_, .vpop-root .hljs-title.function_, .vpop-root .hljs-section { color: #8250df; }
.vpop-root .hljs-built_in, .vpop-root .hljs-type, .vpop-root .hljs-attr, .vpop-root .hljs-attribute, .vpop-root .hljs-selector-class, .vpop-root .hljs-selector-id { color: #0550ae; }
.vpop-root .hljs-variable, .vpop-root .hljs-template-variable, .vpop-root .hljs-params { color: #953800; }
.vpop-root .hljs-meta { color: #6e7781; }
.vpop-root .hljs-deletion { color: #cf222e; }
.dark .vpop-root .hljs-comment, .dark .vpop-root .hljs-quote { color: #7f8794; }
.dark .vpop-root .hljs-keyword, .dark .vpop-root .hljs-selector-tag, .dark .vpop-root .hljs-literal, .dark .vpop-root .hljs-doctag, .dark .vpop-root .hljs-name { color: #ff7b72; }
.dark .vpop-root .hljs-string, .dark .vpop-root .hljs-regexp, .dark .vpop-root .hljs-addition { color: #7ee2a8; }
.dark .vpop-root .hljs-number, .dark .vpop-root .hljs-symbol, .dark .vpop-root .hljs-bullet, .dark .vpop-root .hljs-built_in, .dark .vpop-root .hljs-type, .dark .vpop-root .hljs-attr, .dark .vpop-root .hljs-attribute, .dark .vpop-root .hljs-selector-class, .dark .vpop-root .hljs-selector-id { color: #79c0ff; }
.dark .vpop-root .hljs-title, .dark .vpop-root .hljs-title.class_, .dark .vpop-root .hljs-title.function_, .dark .vpop-root .hljs-section { color: #d2a8ff; }
.dark .vpop-root .hljs-variable, .dark .vpop-root .hljs-template-variable, .dark .vpop-root .hljs-params { color: #ffa657; }

/* ---------- 汎用アニメーション ---------- */
.vpop-root .fade-up { animation: chatFadeUp .35s ease both; }
.vpop-root .spin { animation: chatSpin .9s linear infinite; }
.vpop-root .caret::after {
  content: ''; display: inline-block; width: 8px; height: 8px; margin-left: 4px; border-radius: 999px;
  background: var(--nr-blue); animation: chatBlink 1s ease-in-out infinite; vertical-align: middle;
}
.vpop-root .shimmer-text {
  background: linear-gradient(90deg, var(--nr-ink-sub) 30%, var(--nr-ink) 50%, var(--nr-ink-sub) 70%);
  background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: chatShimmer 2.2s linear infinite;
}
.vpop-root .no-scrollbar::-webkit-scrollbar { display: none; }
.vpop-root .no-scrollbar { scrollbar-width: none; }
.vpop-root .ring { animation: chatRing 1.6s ease-out infinite; }
.vpop-root input[type="range"] { accent-color: var(--nr-blue-deep); }

@keyframes chatFadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes chatSpin { to { transform: rotate(360deg); } }
@keyframes chatBlink { 0%,100% { opacity: 1; } 50% { opacity: .2; } }
@keyframes chatShimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@keyframes float-slow { 0%,100% { transform: translateY(0) rotate(0); } 50% { transform: translateY(-14px) rotate(6deg); } }
@keyframes chatRing { 0% { transform: scale(.9); opacity: .55; } 100% { transform: scale(1.7); opacity: 0; } }

/* ---------- ルート直下の要素の配置 (.vpop-root > * の position:relative を上書き) ---------- */
.vpop-root > .chat-overlay { position: absolute; inset: 0; z-index: 60; }
.vpop-root > .chat-artifact-full { position: absolute; inset: 0; z-index: 55; }
.vpop-root > .chat-artifact-panel { position: relative; }
@media (max-width: 1023px) {
  .vpop-root > .chat-artifact-panel { position: absolute; inset: 0; z-index: 55; }
}

/* ---------- ボイスモード ---------- */
.vpop-root .voice-bg {
  background:
    radial-gradient(1200px 700px at 20% 10%, rgba(255,190,220,.55), transparent 60%),
    radial-gradient(900px 700px at 85% 20%, rgba(150,200,255,.55), transparent 60%),
    radial-gradient(900px 800px at 50% 110%, rgba(190,160,255,.5), transparent 60%),
    linear-gradient(180deg, #fdf3fa 0%, #eef3ff 60%, #f3ecff 100%);
}
.vpop-root .voice-bg.night {
  background:
    radial-gradient(1000px 700px at 15% 5%, rgba(255,120,190,.28), transparent 60%),
    radial-gradient(900px 700px at 90% 15%, rgba(80,140,255,.3), transparent 60%),
    radial-gradient(900px 800px at 50% 110%, rgba(140,90,255,.35), transparent 60%),
    linear-gradient(180deg, #14101f 0%, #10162b 60%, #1a1233 100%);
}
.vpop-root .glass {
  background: rgba(255,255,255,.6);
  backdrop-filter: blur(18px) saturate(1.4); -webkit-backdrop-filter: blur(18px) saturate(1.4);
  border: 1px solid rgba(255,255,255,.7);
}
.vpop-root .night .glass { background: rgba(30,28,50,.55); border-color: rgba(255,255,255,.1); }
`

/* ==================================================================
   LimeAI 拡張: メッセージ部品 (思考 / ステップ / 出典 / 添付)
   ================================================================== */

/* ---------------- tool steps ---------------- */

const TOOL_LABEL: Record<string, string> = {
  web_search: "Web検索",
  fetch_url: "ページを読み込み",
  run_javascript: "JavaScriptを実行",
  get_datetime: "現在時刻を取得",
  create_file: "ファイルを作成",
  save_memory: "メモリに保存",
};

function ToolIcon({ name }: { name: string }) {
  const p = { size: 15 };
  if (name === "web_search") return <Search {...p} />;
  if (name === "fetch_url") return <Globe {...p} />;
  if (name === "run_javascript") return <Code2 {...p} />;
  if (name === "get_datetime") return <Clock {...p} />;
  if (name === "create_file") return <FileText {...p} />;
  if (name === "save_memory") return <Save {...p} />;
  return <Wrench {...p} />;
}

function stepDetail(s: ToolStep): string {
  const a = s.args as Record<string, unknown>;
  if (s.name === "web_search") return String(a.query || "");
  if (s.name === "fetch_url") return String(a.url || "");
  if (s.name === "create_file") return String(a.filename || "");
  if (s.name === "run_javascript") return String(a.code || "").split("\n")[0].slice(0, 80);
  if (s.name === "save_memory") return String(a.content || "");
  return "";
}

function domain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function StepList({ steps, streaming }: { steps: ToolStep[]; streaming?: boolean }) {
  const [open, setOpen] = useState(true);
  if (!steps.length) return null;
  const running = steps.some((s) => s.status === "running");
  return (
    <div className="mb-3 overflow-hidden rounded-2xl border border-[#dfe3e8] dark:border-[#252b33] bg-white dark:bg-[#141920]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm font-medium hover:bg-[#e2e6ea]/55 dark:hover:bg-[#1c2128]"
      >
        {running && streaming ? (
          <Loader2 size={15} className="spin text-[#3aa5e0] dark:text-[#86c9ee]" />
        ) : (
          <Check size={15} className="text-emerald-500" />
        )}
        <span>{running && streaming ? "作業中…" : `${steps.length}件のステップを実行しました`}</span>
        <span className="ml-auto text-[#69707a] dark:text-[#a8b0ba]">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>
      </button>
      {open && (
        <ol className="border-t border-[#dfe3e8] dark:border-[#252b33] px-3.5 py-2">
          {steps.map((s) => (
            <li key={s.id} className="relative flex gap-2.5 py-1.5 text-[13px]">
              <span
                className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg ${
                  s.status === "error" ? "bg-red-500/10 text-red-500" : "bg-[#dceef9] dark:bg-[#1d3446] text-[#3aa5e0] dark:text-[#86c9ee]"
                }`}
              >
                {s.status === "running" ? <Loader2 size={14} className="spin" /> : <ToolIcon name={s.name} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{TOOL_LABEL[s.name] || s.name}</span>
                  <span className="truncate text-[#69707a] dark:text-[#a8b0ba]">{stepDetail(s)}</span>
                </div>
                {s.summary && (
                  <div className={`truncate text-xs ${s.status === "error" ? "text-red-500" : "text-[#69707a] dark:text-[#a8b0ba]"}`}>
                    {s.summary}
                  </div>
                )}
                {s.name === "web_search" && s.sources && s.sources.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {s.sources.slice(0, 6).map((src) => (
                      <a
                        key={src.url}
                        href={src.url}
                        target="_blank"
                        rel="noreferrer"
                        className="max-w-[200px] truncate rounded-full border border-[#dfe3e8] dark:border-[#252b33] px-2 py-0.5 text-[11px] text-[#69707a] dark:text-[#a8b0ba] hover:border-[#a8b0ba] dark:hover:border-[#7e868f] hover:text-[#333a42] dark:hover:text-[#e4e7ea]"
                        title={src.title}
                      >
                        {domain(src.url)}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Reasoning({ text, streaming, hasAnswer }: { text: string; streaming?: boolean; hasAnswer: boolean }) {
  const [open, setOpen] = useState(true);
  const auto = useRef(true);
  useEffect(() => {
    if (hasAnswer && auto.current) {
      auto.current = false;
      setOpen(false);
    }
  }, [hasAnswer]);
  if (!text) return null;
  const thinking = streaming && !hasAnswer;
  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => {
          auto.current = false;
          setOpen(!open);
        }}
        className="inline-flex items-center gap-1.5 rounded-full bg-[#e4e7eb]/70 dark:bg-[#1e242b] px-3 py-1.5 text-[13px] text-[#69707a] dark:text-[#a8b0ba] hover:text-[#333a42] dark:hover:text-[#e4e7ea]"
      >
        <Brain size={14} className={thinking ? "text-[#3aa5e0] dark:text-[#86c9ee]" : ""} />
        <span className={thinking ? "shimmer-text font-medium" : ""}>{thinking ? "思考中…" : "思考プロセス"}</span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && (
        <div className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap border-l-2 border-[#dfe3e8] dark:border-[#252b33] pl-4 text-[13.5px] leading-relaxed text-[#69707a] dark:text-[#a8b0ba]">
          {text}
        </div>
      )}
    </div>
  );
}

function Sources({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);
  if (!sources.length) return null;
  const shown = open ? sources : sources.slice(0, 4);
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-[#69707a] dark:text-[#a8b0ba]">
        <Globe size={14} />
        参考ソース {sources.length}件
        {sources.length > 4 && (
          <button type="button" onClick={() => setOpen(!open)} className="text-[#3aa5e0] dark:text-[#86c9ee] hover:underline">
            {open ? "折りたたむ" : "すべて表示"}
          </button>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {shown.map((s, i) => (
          <a
            key={s.url}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-start gap-2.5 rounded-xl border border-[#dfe3e8] dark:border-[#252b33] bg-white dark:bg-[#141920] px-3 py-2 hover:border-[#a8b0ba] dark:hover:border-[#7e868f]"
          >
                        <img
              src={`https://www.google.com/s2/favicons?domain=${domain(s.url)}&sz=32`}
              alt=""
              width={16}
              height={16}
              className="mt-0.5 h-4 w-4 shrink-0 rounded"
            />
            <span className="min-w-0">
              <span className="line-clamp-1 text-[13px] font-medium">
                <span className="mr-1 text-[#3aa5e0] dark:text-[#86c9ee]">[{i + 1}]</span>
                {s.title || domain(s.url)}
              </span>
              <span className="block truncate text-xs text-[#69707a] dark:text-[#a8b0ba]">{domain(s.url)}</span>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

/* ---------------- attachments ---------------- */

function AttachmentChips({ items, onRemove }: { items: Attachment[]; onRemove?: (i: number) => void }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((a, i) =>
        a.kind === "image" && a.dataUrl ? (
          <div key={i} className="group relative">
                        <img src={a.dataUrl} alt={a.name} className="h-20 max-w-[220px] rounded-xl border border-[#dfe3e8] dark:border-[#252b33] object-cover" />
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-[#333a42] dark:bg-[#e4e7ea] text-white dark:text-[#12161b] opacity-0 group-hover:opacity-100"
                aria-label="削除"
              >
                <X size={12} />
              </button>
            )}
          </div>
        ) : (
          <div
            key={i}
            className="group relative flex items-center gap-2 rounded-xl border border-[#dfe3e8] dark:border-[#252b33] bg-white dark:bg-[#141920] px-3 py-2 text-left"
          >
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#dceef9] dark:bg-[#1d3446] text-[#3aa5e0] dark:text-[#86c9ee]">
              <FileText size={16} />
            </span>
            <span className="min-w-0">
              <span className="block max-w-[180px] truncate text-[13px] font-medium">{a.name}</span>
              <span className="block text-[11px] text-[#69707a] dark:text-[#a8b0ba]">
                {a.text ? `${a.text.length.toLocaleString()}文字` : `${Math.round(a.size / 1024)}KB`}
              </span>
            </span>
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="ml-1 grid h-5 w-5 place-items-center rounded-full text-[#69707a] dark:text-[#a8b0ba] hover:bg-[#e2e6ea]/55 dark:hover:bg-[#1c2128]"
                aria-label="削除"
              >
                <X size={12} />
              </button>
            )}
          </div>
        ),
      )}
    </div>
  );
}

/* ==================================================================
   LimeAI 拡張: Markdown 表示 / コードブロック / アーティファクトカード
   ================================================================== */

function nodeText(n: ReactNode): string {
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(nodeText).join("");
  if (isValidElement(n)) return nodeText((n.props as { children?: ReactNode }).children);
  return "";
}

type HNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HNode[];
};

function rehypeCite(sources: Source[]) {
  return () => (tree: HNode) => {
    const walk = (node: HNode) => {
      if (!node.children) return;
      if (node.tagName && ["code", "pre", "a", "sup"].includes(node.tagName)) return;
      const next: HNode[] = [];
      for (const child of node.children) {
        if (child.type === "text" && child.value && /\[\d{1,2}\]/.test(child.value)) {
          const parts = child.value.split(/(\[\d{1,2}\])/);
          for (const p of parts) {
            const m = p.match(/^\[(\d{1,2})\]$/);
            const src = m ? sources[Number(m[1]) - 1] : undefined;
            if (m && src) {
              next.push({
                type: "element",
                tagName: "sup",
                properties: { className: ["cite"] },
                children: [
                  {
                    type: "element",
                    tagName: "a",
                    properties: { href: src.url, target: "_blank", rel: "noreferrer", title: src.title },
                    children: [{ type: "text", value: m[1] }],
                  },
                ],
              });
            } else if (p) next.push({ type: "text", value: p });
          }
        } else {
          walk(child);
          next.push(child);
        }
      }
      node.children = next;
    };
    walk(tree);
  };
}

function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        setOk(true);
        setTimeout(() => setOk(false), 1500);
      }}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-[#69707a] dark:text-[#a8b0ba] hover:bg-[#e2e6ea]/55 dark:hover:bg-[#1c2128] hover:text-[#333a42] dark:hover:text-[#e4e7ea] ${className}`}
    >
      {ok ? <Check size={13} /> : <Copy size={13} />}
      {ok ? "コピーしました" : "コピー"}
    </button>
  );
}

function CodeBlock({
  lang,
  code,
  onPreview,
}: {
  lang: string;
  code: string;
  onPreview?: () => void;
}) {
  const kind = normalizeLang(lang);
  const [lines, setLines] = useState<RunLine[] | null>(null);
  const [running, setRunning] = useState(false);
  const handle = useRef<RunHandle | null>(null);

  const run = () => {
    if (!kind) return;
    setLines([]);
    setRunning(true);
    const h = runCode(kind, code, (l) => setLines((prev) => [...(prev || []), l]));
    handle.current = h;
    h.promise.then(() => setRunning(false));
  };

  return (
    <div className="codeblock">
      <div className="flex items-center justify-between border-b border-[#dfe3e8] dark:border-[#252b33] bg-[var(--nr-silver-2)] px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-[#69707a] dark:text-[#a8b0ba]">
          <Code2 size={13} />
          {lang || "text"}
        </span>
        <div className="flex items-center gap-0.5">
          {onPreview && (
            <button
              type="button"
              onClick={onPreview}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-[#69707a] dark:text-[#a8b0ba] hover:bg-[#e2e6ea]/55 dark:hover:bg-[#1c2128] hover:text-[#333a42] dark:hover:text-[#e4e7ea]"
            >
              <Eye size={13} />
              プレビュー
            </button>
          )}
          {kind &&
            (running ? (
              <button
                type="button"
                onClick={() => handle.current?.cancel()}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-red-500 hover:bg-[#e2e6ea]/55 dark:hover:bg-[#1c2128]"
              >
                <Square size={12} fill="currentColor" />
                停止
              </button>
            ) : (
              <button
                type="button"
                onClick={run}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-[#3aa5e0] dark:text-[#86c9ee] hover:bg-[#e2e6ea]/55 dark:hover:bg-[#1c2128]"
              >
                <Play size={12} fill="currentColor" />
                実行
              </button>
            ))}
          <CopyButton text={code} />
        </div>
      </div>
      <pre>
        <code className={`hljs language-${lang}`} dangerouslySetInnerHTML={undefined}>
          <HighlightedCode lang={lang} code={code} />
        </code>
      </pre>
      {lines && (
        <div className="border-t border-[#dfe3e8] dark:border-[#252b33] bg-white dark:bg-[#12161b]">
          <div className="flex items-center gap-1.5 px-3 pt-2 text-xs font-medium text-[#69707a] dark:text-[#a8b0ba]">
            <Terminal size={13} />
            出力
            {running && <Loader2 size={12} className="spin" />}
          </div>
          <pre className="!max-h-64 !overflow-auto !py-2 !text-[12.5px]">
            {lines.length === 0 && <span className="text-[#a8b0ba] dark:text-[#7e868f]">実行中…</span>}
            {lines.map((l, i) => (
              <div
                key={i}
                className={
                  l.level === "error"
                    ? "text-red-500"
                    : l.level === "result"
                      ? "text-[#3aa5e0] dark:text-[#86c9ee]"
                      : l.level === "info"
                        ? "text-[#a8b0ba] dark:text-[#7e868f]"
                        : ""
                }
              >
                {l.text || "\u00a0"}
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
}

/** Renders already-highlighted children when available; falls back to plain text. */
function HighlightedCode({ code, children }: { lang: string; code: string; children?: ReactNode }) {
  return <>{children ?? code}</>;
}

function ArtifactCard({
  artifact,
  active,
  streaming,
  onOpen,
}: {
  artifact: Artifact;
  active: boolean;
  streaming?: boolean;
  onOpen: () => void;
}) {
  const lines = artifact.content.split("\n").length;
  const label =
    artifact.type === "html" ? "HTML" : artifact.type === "svg" ? "SVG" : artifact.type === "markdown" ? "ドキュメント" : artifact.language || "コード";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group my-3 flex w-full max-w-md items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition ${
        active ? "border-[#4fb3e8] bg-[#dceef9] dark:bg-[#1d3446]" : "border-[#dfe3e8] dark:border-[#252b33] bg-white dark:bg-[#141920] hover:border-[#a8b0ba] dark:hover:border-[#7e868f]"
      }`}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#dceef9] dark:bg-[#1d3446] text-[#3aa5e0] dark:text-[#86c9ee]">
        {streaming ? <Loader2 size={18} className="spin" /> : <Eye size={18} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{artifact.title}</span>
        <span className="block text-xs text-[#69707a] dark:text-[#a8b0ba]">
          {label} · {lines.toLocaleString()}行 {streaming ? "· 生成中…" : "· クリックでプレビュー"}
        </span>
      </span>
    </button>
  );
}

type MarkdownProps = {
  content: string;
  sources?: Source[];
  fenceArtifacts?: Artifact[];
  activeArtifactId?: string | null;
  streaming?: boolean;
  onOpenArtifact?: (a: Artifact) => void;
};

function MarkdownImpl({ content, sources = [], fenceArtifacts, activeArtifactId, streaming, onOpenArtifact }: MarkdownProps) {
  const rehypePlugins = useMemo(
    () => [
      ...(sources.length ? [rehypeCite(sources)] : []),
      [rehypeKatex, { throwOnError: false, strict: false }],
      [rehypeHighlight, { detect: false, ignoreMissing: true }],
    ],
    [sources.length],
  ) as never;

  let fenceIdx = 0;
  const components = {
    a: ({ href, children }: { href?: string; children?: ReactNode }) => (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ),
    table: ({ children }: { children?: ReactNode }) => (
      <div className="table-wrap">
        <table>{children}</table>
      </div>
    ),
    pre: ({ children }: { children?: ReactNode }) => {
      const child = Array.isArray(children) ? children[0] : children;
      const props = (isValidElement(child) ? child.props : {}) as { className?: string; children?: ReactNode };
      const lang = (props.className || "").match(/language-([\w+-]+)/)?.[1] || "";
      const code = nodeText(props.children).replace(/\n$/, "");
      if (lang === "math") return <>{children}</>;
      const isArtifactLang = (lang === "html" || lang === "svg") && (lang === "svg" || /<\w+/.test(code));
      if (isArtifactLang && fenceArtifacts && onOpenArtifact) {
        const art = fenceArtifacts[fenceIdx++];
        if (art) {
          return (
            <ArtifactCard
              artifact={art}
              active={activeArtifactId === art.id}
              streaming={streaming && fenceIdx === fenceArtifacts.length}
              onOpen={() => onOpenArtifact(art)}
            />
          );
        }
      }
      return (
        <div className="codeblock">
          <CodeBlockShell lang={lang} code={code}>
            {props.children}
          </CodeBlockShell>
        </div>
      );
    },
  };

  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
        rehypePlugins={rehypePlugins}
        components={components as never}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/** Same as CodeBlock but keeps rehype-highlight's highlighted children. */
function CodeBlockShell({ lang, code, children }: { lang: string; code: string; children: ReactNode }) {
  const kind = normalizeLang(lang);
  const [lines, setLines] = useState<RunLine[] | null>(null);
  const [running, setRunning] = useState(false);
  const handle = useRef<RunHandle | null>(null);
  const run = () => {
    if (!kind) return;
    setLines([]);
    setRunning(true);
    const h = runCode(kind, code, (l) => setLines((prev) => [...(prev || []), l]));
    handle.current = h;
    h.promise.then(() => setRunning(false));
  };
  return (
    <>
      <div className="flex items-center justify-between border-b border-[#dfe3e8] dark:border-[#252b33] bg-[var(--nr-silver-2)] px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-[#69707a] dark:text-[#a8b0ba]">
          <Code2 size={13} />
          {lang || "text"}
        </span>
        <div className="flex items-center gap-0.5">
          {kind &&
            (running ? (
              <button
                type="button"
                onClick={() => handle.current?.cancel()}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-red-500 hover:bg-[#e2e6ea]/55 dark:hover:bg-[#1c2128]"
              >
                <Square size={12} fill="currentColor" />
                停止
              </button>
            ) : (
              <button
                type="button"
                onClick={run}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-[#3aa5e0] dark:text-[#86c9ee] hover:bg-[#e2e6ea]/55 dark:hover:bg-[#1c2128]"
              >
                <Play size={12} fill="currentColor" />
                実行
              </button>
            ))}
          <CopyButton text={code} />
        </div>
      </div>
      <pre>
        <code className={`hljs language-${lang}`}>{children}</code>
      </pre>
      {lines && (
        <div className="border-t border-[#dfe3e8] dark:border-[#252b33] bg-white dark:bg-[#12161b]">
          <div className="flex items-center gap-1.5 px-3 pt-2 text-xs font-medium text-[#69707a] dark:text-[#a8b0ba]">
            <Terminal size={13} />
            出力
            {running && <Loader2 size={12} className="spin" />}
          </div>
          <pre className="!max-h-64 !overflow-auto !py-2 !text-[12.5px]">
            {lines.length === 0 && <span className="text-[#a8b0ba] dark:text-[#7e868f]">実行中…</span>}
            {lines.map((l, i) => (
              <div
                key={i}
                className={
                  l.level === "error"
                    ? "text-red-500"
                    : l.level === "result"
                      ? "text-[#3aa5e0] dark:text-[#86c9ee]"
                      : l.level === "info"
                        ? "text-[#a8b0ba] dark:text-[#7e868f]"
                        : ""
                }
              >
                {l.text || "\u00a0"}
              </div>
            ))}
          </pre>
        </div>
      )}
    </>
  );
}

const Markdown = memo(MarkdownImpl);

/* ==================================================================
   LimeAI 拡張: プレビューパネル
   ================================================================== */

type Device = "desktop" | "tablet" | "mobile";
const WIDTHS: Record<Device, string> = { desktop: "100%", tablet: "768px", mobile: "390px" };

type ArtifactPanelProps = {
  artifacts: Artifact[];
  activeId: string | null;
  streaming: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
};

function ArtifactPanel({ artifacts, activeId, streaming, onSelect, onClose }: ArtifactPanelProps) {
  const active = artifacts.find((a) => a.id === activeId) || artifacts[artifacts.length - 1];
  const previewable = active && (active.type === "html" || active.type === "svg" || active.type === "markdown");
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [device, setDevice] = useState<Device>("desktop");
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState(false);
  const [reload, setReload] = useState(0);
  const [lines, setLines] = useState<RunLine[] | null>(null);
  const [running, setRunning] = useState(false);
  const handle = useRef<RunHandle | null>(null);

  // throttle live preview while streaming
  const [live, setLive] = useState(active?.content || "");
  const latest = useRef(active?.content || "");
  latest.current = active?.content || "";
  useEffect(() => {
    if (!streaming) {
      setLive(latest.current);
      return;
    }
    const t = setInterval(() => setLive(latest.current), 600);
    return () => clearInterval(t);
  }, [streaming, active?.id]);
  useEffect(() => {
    setLive(latest.current);
  }, [active?.id, active?.content, streaming]);

  useEffect(() => {
    setLines(null);
    if (active && !previewable) setTab("code");
    else setTab("preview");
  }, [active?.id, previewable]);

  const srcDoc = useMemo(
    () => (active && (active.type === "html" || active.type === "svg") ? toSrcDoc({ type: active.type, content: live }) : ""),
    [live, active?.type, reload],
  );

  if (!active) return null;
  const kind = active.type === "code" ? normalizeLang(active.language || "") : null;

  const download = () => {
    const blob = new Blob([active.content], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileNameFor(active);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const openNew = () => {
    const blob = new Blob([toSrcDoc(active)], { type: "text/html;charset=utf-8" });
    window.open(URL.createObjectURL(blob), "_blank");
  };
  const run = () => {
    if (!kind) return;
    setLines([]);
    setRunning(true);
    const h = runCode(kind, active.content, (l) => setLines((p) => [...(p || []), l]));
    handle.current = h;
    h.promise.then(() => setRunning(false));
  };

  const isPreviewFrame = active.type === "html" || active.type === "svg";

  return (
    <section
      className={`flex min-w-0 flex-col border-l border-[#dfe3e8] dark:border-[#252b33] bg-white dark:bg-[#12161b] ${
        full
          ? "chat-artifact-full"
          : "chat-artifact-panel lg:h-full lg:w-[48%] lg:min-w-[440px] lg:max-w-[980px]"
      }`}
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[#dfe3e8] dark:border-[#252b33] px-3">
        <div className="relative min-w-0">
          <button
            type="button"
            onClick={() => setMenu(!menu)}
            className="flex max-w-[260px] items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold hover:bg-[#e2e6ea]/55 dark:hover:bg-[#1c2128]"
          >
            <span className="truncate">{active.title}</span>
            {artifacts.length > 1 && <ChevronDown size={14} className="shrink-0 text-[#69707a] dark:text-[#a8b0ba]" />}
          </button>
          {menu && artifacts.length > 1 && (
            <div className="absolute left-0 top-10 z-50 max-h-72 w-72 overflow-y-auto rounded-xl border border-[#dfe3e8] dark:border-[#252b33] bg-white dark:bg-[#141920] p-1 shadow-[var(--nr-shadow-m)]">
              {artifacts.map((a, i) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    onSelect(a.id);
                    setMenu(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-[#e2e6ea]/55 dark:hover:bg-[#1c2128]"
                >
                  <span className="w-5 text-xs text-[#a8b0ba] dark:text-[#7e868f]">v{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{a.title}</span>
                  {a.id === active.id && <Check size={14} className="text-[#3aa5e0] dark:text-[#86c9ee]" />}
                </button>
              ))}
            </div>
          )}
        </div>
        {streaming && <span className="shimmer-text text-xs font-medium">生成中…</span>}

        <div className="ml-auto flex items-center gap-1">
          {previewable && (
            <div className="flex rounded-lg bg-[#e4e7eb]/70 dark:bg-[#1e242b] p-0.5 text-[13px] font-medium">
              <button
                type="button"
                onClick={() => setTab("preview")}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 ${tab === "preview" ? "bg-white dark:bg-[#141920] shadow-sm" : "text-[#69707a] dark:text-[#a8b0ba]"}`}
              >
                <Eye size={13} /> プレビュー
              </button>
              <button
                type="button"
                onClick={() => setTab("code")}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 ${tab === "code" ? "bg-white dark:bg-[#141920] shadow-sm" : "text-[#69707a] dark:text-[#a8b0ba]"}`}
              >
                <Code2 size={13} /> コード
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => setFull(!full)}
            aria-label="全画面"
            className="grid h-8 w-8 place-items-center rounded-lg text-[#69707a] dark:text-[#a8b0ba] hover:bg-[#e2e6ea]/55 dark:hover:bg-[#1c2128] max-lg:hidden"
          >
            {full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="grid h-8 w-8 place-items-center rounded-lg text-[#69707a] dark:text-[#a8b0ba] hover:bg-[#e2e6ea]/55 dark:hover:bg-[#1c2128]"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-[#dfe3e8] dark:border-[#252b33] px-3">
        {isPreviewFrame && tab === "preview" && (
          <div className="flex rounded-lg bg-[#e4e7eb]/70 dark:bg-[#1e242b] p-0.5">
            {(
              [
                ["desktop", Monitor, "デスクトップ"],
                ["tablet", Tablet, "タブレット"],
                ["mobile", Smartphone, "モバイル"],
              ] as const
            ).map(([d, Icon, label]) => (
              <button
                key={d}
                type="button"
                title={label}
                aria-label={label}
                onClick={() => setDevice(d)}
                className={`grid h-7 w-8 place-items-center rounded-md ${device === d ? "bg-white dark:bg-[#141920] shadow-sm" : "text-[#69707a] dark:text-[#a8b0ba]"}`}
              >
                <Icon size={15} />
              </button>
            ))}
          </div>
        )}
        {kind && (
          <>
            {running ? (
              <button
                type="button"
                onClick={() => handle.current?.cancel()}
                className="flex h-7 items-center gap-1 rounded-lg bg-red-500/10 px-2.5 text-[13px] font-medium text-red-500"
              >
                <Square size={11} fill="currentColor" /> 停止
              </button>
            ) : (
              <button
                type="button"
                onClick={run}
                className="flex h-7 items-center gap-1 rounded-lg bg-[#dceef9] dark:bg-[#1d3446] px-2.5 text-[13px] font-medium text-[#3aa5e0] dark:text-[#86c9ee]"
              >
                <Play size={11} fill="currentColor" /> 実行
              </button>
            )}
          </>
        )}
        <div className="ml-auto flex items-center gap-0.5 text-[#69707a] dark:text-[#a8b0ba]">
          {isPreviewFrame && (
            <button
              type="button"
              title="再読み込み"
              aria-label="再読み込み"
              onClick={() => setReload((n) => n + 1)}
              className="grid h-8 w-8 place-items-center rounded-lg hover:bg-[#e2e6ea]/55 dark:hover:bg-[#1c2128]"
            >
              <RefreshCw size={15} />
            </button>
          )}
          {isPreviewFrame && (
            <button
              type="button"
              title="新しいタブで開く"
              aria-label="新しいタブで開く"
              onClick={openNew}
              className="grid h-8 w-8 place-items-center rounded-lg hover:bg-[#e2e6ea]/55 dark:hover:bg-[#1c2128]"
            >
              <ExternalLink size={15} />
            </button>
          )}
          <button
            type="button"
            title="コピー"
            aria-label="コピー"
            onClick={() => {
              navigator.clipboard.writeText(active.content);
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            }}
            className="grid h-8 w-8 place-items-center rounded-lg hover:bg-[#e2e6ea]/55 dark:hover:bg-[#1c2128]"
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
          <button
            type="button"
            title="ダウンロード"
            aria-label="ダウンロード"
            onClick={download}
            className="grid h-8 w-8 place-items-center rounded-lg hover:bg-[#e2e6ea]/55 dark:hover:bg-[#1c2128]"
          >
            <Download size={15} />
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#f7f8f9] dark:bg-[#161b21]">
        {tab === "preview" && isPreviewFrame && (
          <div className="flex h-full justify-center overflow-auto p-0">
            <iframe
              key={`${active.id}-${reload}`}
              title={active.title}
              srcDoc={srcDoc}
              sandbox="allow-scripts allow-modals allow-forms allow-popups allow-pointer-lock"
              className={`h-full border-0 bg-white transition-[width] duration-300 ${
                device === "desktop" ? "w-full" : "my-3 h-[calc(100%-1.5rem)] rounded-2xl shadow-[var(--nr-shadow-m)] ring-1 ring-[#dfe3e8] dark:ring-[#252b33]"
              }`}
              style={{ width: WIDTHS[device], maxWidth: "100%" }}
            />
          </div>
        )}
        {tab === "preview" && active.type === "markdown" && (
          <div className="h-full overflow-y-auto bg-white dark:bg-[#12161b] px-8 py-6">
            <div className="mx-auto max-w-3xl">
              <Markdown content={active.content} />
            </div>
          </div>
        )}
        {tab === "code" && (
          <div className="flex h-full flex-col bg-[var(--nr-silver-1)]">
            <pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[13px] leading-[1.65]">
              <code>{active.content}</code>
            </pre>
            {lines && (
              <div className="max-h-[40%] shrink-0 overflow-auto border-t border-[#dfe3e8] dark:border-[#252b33] bg-white dark:bg-[#12161b]">
                <div className="flex items-center gap-1.5 px-4 pt-2 text-xs font-medium text-[#69707a] dark:text-[#a8b0ba]">
                  <Terminal size={13} /> 出力
                </div>
                <pre className="px-4 py-2 font-mono text-[12.5px] leading-relaxed">
                  {lines.map((l, i) => (
                    <div key={i} className={l.level === "error" ? "text-red-500" : l.level === "result" ? "text-[#3aa5e0] dark:text-[#86c9ee]" : l.level === "info" ? "text-[#a8b0ba] dark:text-[#7e868f]" : ""}>
                      {l.text || "\u00a0"}
                    </div>
                  ))}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/* ==================================================================
   LimeAI 拡張: アシスタント画面
   ================================================================== */

type Draft = AssistantDraft;
const EMPTY: Draft = { name: "", description: "", systemPrompt: "", starter: "", greeting: "", gender: "female" };

/** キャラクターの丸いアイコン(未設定なら初期アイコン) */
function AssistantAvatar({
  item,
  avatars,
  className = "",
}: {
  item: { id: string; name: string };
  avatars: AvatarMap;
  className?: string;
}) {
  return <img src={avatarOf(item, avatars)} alt={item.name} draggable={false} className={`rounded-full object-cover ${className}`} />;
}

/** X / Twitter のプロフィール写真に近い、カメラバッジ付きアバター操作ボタン */
function AssistantAvatarPicker({
  item,
  avatars,
  open,
  onToggle,
  onChange,
  onReset,
}: {
  item: { id: string; name: string };
  avatars: AvatarMap;
  open: boolean;
  onToggle: () => void;
  onChange: () => void;
  onReset: () => void;
}) {
  const hasCustom = Boolean(avatars[item.id]);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        aria-label={`${item.name}のアイコンを変更またはリセット`}
        aria-expanded={open}
        title="アイコンを変更 / リセット"
        className="group/avatar relative block h-12 w-12 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4fb3e8]/70 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#141920]"
      >
        <AssistantAvatar
          item={item}
          avatars={avatars}
          className="h-12 w-12 border border-[#dfe3e8] dark:border-[#252b33]"
        />
        <span className="pointer-events-none absolute bottom-0 right-0 grid h-5 w-5 translate-x-0.5 translate-y-0.5 place-items-center rounded-full border-2 border-white bg-[#333a42] text-white opacity-0 shadow-sm transition-opacity duration-150 group-hover/avatar:opacity-100 group-focus-visible/avatar:opacity-100 group-hover/avatar:scale-105 dark:border-[#141920] dark:bg-[#e4e7ea] dark:text-[#12161b]" aria-hidden="true">
          <Camera size={10} strokeWidth={2.4} />
        </span>
      </button>

      {open && (
        <div
          className="absolute left-0 top-[calc(100%+8px)] z-[80] w-44 overflow-hidden rounded-2xl border border-[#dfe3e8] bg-white p-1.5 shadow-[0_16px_40px_rgba(0,0,0,.16)] dark:border-[#252b33] dark:bg-[#141920]"
          onClick={(e) => e.stopPropagation()}
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            onClick={onChange}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-[#e2e6ea]/60 dark:hover:bg-[#1c2128]"
          >
            <Camera size={15} />
            <span>写真を変更</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!hasCustom}
            onClick={onReset}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-[#e2e6ea]/60 disabled:cursor-default disabled:opacity-40 dark:hover:bg-[#1c2128]"
          >
            <RotateCcw size={15} />
            <span>初期アイコンに戻す</span>
          </button>
        </div>
      )}
    </div>
  );
}

function AssistantsView({
  uid,
  avatars,
  onUse,
  onCall,
  onChanged,
  onAvatarChange,
}: {
  uid: string | null
  avatars: AvatarMap
  onUse: (a: AssistantItem) => void
  onCall: (a: AssistantItem) => void
  onChanged?: () => void
  onAvatarChange: (id: string, dataUrl: string | null) => void
}) {
  const [items, setItems] = useState<AssistantItem[]>(() => listAssistants(uid));
  const [cat, setCat] = useState("すべて");
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftAvatar, setDraftAvatar] = useState<string | null>(null);
  const [draftAvatarInitial, setDraftAvatarInitial] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [avatarMenuId, setAvatarMenuId] = useState<string | null>(null);
  const iconInput = useRef<HTMLInputElement>(null);
  const iconTarget = useRef<string>("");

  const load = () => {
    setItems(listAssistants(uid));
    onChanged?.();
  };

  const cats = useMemo(() => ["すべて", ...Array.from(new Set(items.map((i) => i.category)))], [items]);
  const shown = items.filter(
    (i) =>
      (cat === "すべて" || i.category === cat) &&
      (!q || `${i.name}${i.description}${i.category}`.toLowerCase().includes(q.toLowerCase())),
  );

  const pickIcon = (target: string) => {
    iconTarget.current = target;
    iconInput.current?.click();
  };

  const onIconFile = async (file: File | undefined) => {
    if (!file) return;
    setErr("");
    try {
      const url = await avatarFromFile(file);
      if (iconTarget.current === "__draft__") setDraftAvatar(url);
      else onAvatarChange(iconTarget.current, url);
      setAvatarMenuId(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const openNew = () => {
    setAvatarMenuId(null);
    setDraft({ ...EMPTY });
    setDraftAvatar(null);
    setDraftAvatarInitial(null);
    setErr("");
  };

  const openEdit = (a: AssistantItem) => {
    setAvatarMenuId(null);
    const current = avatars[a.id] ?? null;
    setDraft({
      id: a.id,
      name: a.name,
      description: a.description,
      systemPrompt: a.systemPrompt,
      starter: a.starter,
      greeting: a.greeting ?? "",
      gender: a.gender ?? "female",
    });
    setDraftAvatar(current);
    setDraftAvatarInitial(current);
    setErr("");
  };

  const save = () => {
    if (!draft) return;
    setErr("");
    try {
      const list = saveCustomAssistant(uid, draft);
      const savedId = draft.id ?? list[list.length - 1]?.id;
      if (savedId && draftAvatar !== draftAvatarInitial) onAvatarChange(savedId, draftAvatar);
      setDraft(null);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const field = "w-full rounded-xl border border-[#dfe3e8] dark:border-[#252b33] bg-white dark:bg-[#12161b] px-3 text-sm outline-none focus:border-[#4fb3e8]";
  const iconBtn = "grid h-7 w-7 place-items-center rounded-lg text-[#69707a] dark:text-[#a8b0ba] hover:bg-[#e2e6ea]/55 dark:hover:bg-[#1c2128]";

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <input
        ref={iconInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void onIconFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <div className="mx-auto max-w-[1000px] px-6 pb-16 pt-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-bold tracking-tight">
              フレンド
            </h1>
            <p className="mt-1.5 text-sm text-[#69707a] dark:text-[#a8b0ba]">話したい相手を選ぶと、友だちや先輩と話すように会話できます。電話もかけられます。アイコンは自分の画像に変更できます。</p>
          </div>
          <button
            type="button"
            onClick={openNew}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#333a42] dark:bg-[#e4e7ea] px-4 text-sm font-semibold text-white dark:text-[#12161b] hover:opacity-90"
          >
            <Plus size={16} /> 新規作成
          </button>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a8b0ba] dark:text-[#7e868f]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="友だちを検索"
              className="h-9 w-full rounded-full bg-[#e4e7eb]/70 dark:bg-[#1e242b] pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-[#4fb3e8]/40"
            />
          </div>
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
            {cats.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCat(c)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium ${
                  cat === c ? "bg-[#333a42] dark:bg-[#e4e7ea] text-white dark:text-[#12161b]" : "bg-[#e4e7eb]/70 dark:bg-[#1e242b] text-[#69707a] dark:text-[#a8b0ba] hover:text-[#333a42] dark:hover:text-[#e4e7ea]"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {err && !draft && <div className="mt-4 text-sm text-red-500">{err}</div>}
        <div className="mt-6 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((a) => (
            <div
              key={a.id}
              className="group relative flex cursor-pointer flex-col rounded-2xl border border-[#dfe3e8] dark:border-[#252b33] bg-white dark:bg-[#141920] p-4 transition hover:-translate-y-0.5 hover:border-[#a8b0ba] dark:hover:border-[#7e868f] hover:shadow-[var(--nr-shadow-m)]"
              onClick={() => onUse(a)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && onUse(a)}
            >
              <div className="flex items-center gap-3">
                <AssistantAvatarPicker
                  item={a}
                  avatars={avatars}
                  open={avatarMenuId === a.id}
                  onToggle={() => setAvatarMenuId((current) => (current === a.id ? null : a.id))}
                  onChange={() => {
                    pickIcon(a.id);
                    setAvatarMenuId(null);
                  }}
                  onReset={() => {
                    onAvatarChange(a.id, null);
                    setAvatarMenuId(null);
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold">{a.name}</div>
                  <div className="text-xs text-[#a8b0ba] dark:text-[#7e868f]">{a.category}</div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCall(a);
                  }}
                  aria-label={`${a.name}と通話`}
                  title={`${a.name}と通話`}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#bfe3f7] bg-[#f2faff] text-[#3aa5e0] transition hover:bg-[#e5f5fd] dark:border-[#2d4a5f] dark:bg-[#172634] dark:text-[#86c9ee] dark:hover:bg-[#1d3446]"
                >
                  <Phone className="h-[18px] w-[18px]" strokeWidth={2.2} />
                </button>
              </div>
              <p className="mt-3 line-clamp-2 flex-1 text-[13px] leading-relaxed text-[#69707a] dark:text-[#a8b0ba]">{a.description || a.systemPrompt}</p>
              <div className="mt-2 flex min-h-[28px] items-center justify-end gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100">
                {!a.builtin && (
                  <>
                    <button
                      type="button"
                      aria-label="編集"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(a);
                      }}
                      className={iconBtn}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label="削除"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!confirm(`「${a.name}」を削除しますか?`)) return;
                        deleteCustomAssistant(uid, a.id);
                        onAvatarChange(a.id, null);
                        load();
                      }}
                      className={`${iconBtn} hover:text-red-500`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        {shown.length === 0 && <div className="py-20 text-center text-sm text-[#a8b0ba] dark:text-[#7e868f]">友達がいません</div>}
      </div>

      {draft && (
        <div className="absolute inset-0 z-[70] grid place-items-center bg-black/40 p-4" onMouseDown={() => setDraft(null)}>
          <div className="fade-up max-h-full w-full max-w-lg overflow-y-auto rounded-3xl border border-[#dfe3e8] dark:border-[#252b33] bg-white dark:bg-[#12161b] p-6 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">{draft.id ? "キャラクターを編集" : "キャラクターを作成"}</h2>
              <button type="button" onClick={() => setDraft(null)} aria-label="閉じる" className="text-[#69707a] dark:text-[#a8b0ba]">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => pickIcon("__draft__")}
                  aria-label="アイコン画像を選ぶ"
                  title="アイコン画像を選ぶ"
                  className="relative h-16 w-16 shrink-0"
                >
                  <img
                    src={draftAvatar || defaultAvatarUrl(draft.id || "new-character")}
                    alt=""
                    className="h-16 w-16 rounded-full border border-[#dfe3e8] dark:border-[#252b33] object-cover"
                  />
                  <span className="absolute -bottom-0.5 -right-0.5 grid h-6 w-6 place-items-center rounded-full bg-[#3aa5e0] text-white">
                    <Camera size={12} />
                  </span>
                </button>
                <input className={`${field} h-10 flex-1`} value={draft.name} placeholder="名前" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              {draftAvatar && (
                <button type="button" onClick={() => setDraftAvatar(null)} className="text-xs text-[#69707a] dark:text-[#a8b0ba] hover:underline">
                  初期アイコンに戻す
                </button>
              )}
              <input className={`${field} h-10`} value={draft.description} placeholder="紹介文 (一覧に表示されます)" onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              <textarea
                className={`${field} min-h-[140px] resize-y py-2.5 leading-relaxed`}
                value={draft.systemPrompt}
                placeholder="キャラクター設定: 年齢・性格・ユーザーとの関係・口調・話し方のクセなどを書いてください"
                onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
              />
              <input className={`${field} h-10`} value={draft.greeting} placeholder="電話に出たときの第一声" onChange={(e) => setDraft({ ...draft, greeting: e.target.value })} />
              <input className={`${field} h-10`} value={draft.starter} placeholder="最初の入力例 (任意)" onChange={(e) => setDraft({ ...draft, starter: e.target.value })} />
              <div className="flex items-center gap-2 text-sm">
                <span className="text-[#69707a] dark:text-[#a8b0ba]">通話の声</span>
                {(["female", "male"] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setDraft({ ...draft, gender: g })}
                    className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium ${
                      draft.gender === g ? "bg-[#333a42] dark:bg-[#e4e7ea] text-white dark:text-[#12161b]" : "bg-[#e4e7eb]/70 dark:bg-[#1e242b] text-[#69707a] dark:text-[#a8b0ba]"
                    }`}
                  >
                    {g === "female" ? "女性の声" : "男性の声"}
                  </button>
                ))}
              </div>
            </div>
            {err && <div className="mt-3 text-sm text-red-500">{err}</div>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setDraft(null)} className="rounded-xl px-4 py-2 text-sm text-[#69707a] dark:text-[#a8b0ba] hover:bg-[#e2e6ea]/55 dark:hover:bg-[#1c2128]">
                キャンセル
              </button>
              <button
                type="button"
                disabled={!draft.name.trim() || !draft.systemPrompt.trim()}
                onClick={save}
                className="rounded-xl bg-[#3aa5e0] px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ==================================================================
   LimeAI 拡張: 3Dアバター表示 (three.js は必要になった時に読み込み)
   ================================================================== */

/** three.js 関連は重いので、ボイスモードで3D表示が必要になった時に動的に読み込む */
type MMDResultLike = { mesh: THREE.SkinnedMesh };

type MMDLoaderLike = new () => {
  manager: THREE.LoadingManager;
  loadAsync(
    url: string,
    onProgress?: (event: ProgressEvent<EventTarget>) => void,
  ): Promise<MMDResultLike>;
};

type StageLibs = {
  THREE: typeof import("three");
  VRMLoaderPlugin: typeof import("@pixiv/three-vrm").VRMLoaderPlugin;
  VRMUtils: typeof import("@pixiv/three-vrm").VRMUtils;
  GLTFLoader: typeof import("three/examples/jsm/loaders/GLTFLoader.js").GLTFLoader;
  MMDLoader: MMDLoaderLike;
};

type VrmStageProps = {
  source: ModelSource;
  bus: AvatarBus;
  camera: CameraPreset;
  night: boolean;
  onStatus: (s: StageStatus) => void;
};

type Pose = {
  headX: number; headY: number; headZ: number;
  neckX: number; spineX: number; spineZ: number; chestX: number;
  hipsY: number; hipsPosY: number;
  lUz: number; lUy: number; lLy: number; lLz: number;
  rUz: number; rUy: number; rLy: number; rLz: number;
  lShZ: number; rShZ: number;
};

type BoneName = Parameters<VRM["humanoid"]["getNormalizedBoneNode"]>[0];

const GESTURE_DUR = { wave: 2.7, nod: 1.1, bow: 2.1, cheer: 2.5 } as const;

const EXPRESSIONS = ["happy", "sad", "angry", "surprised", "relaxed"] as const;
const STAGE_VOWELS = ["aa", "ih", "ou", "ee", "oh"] as const;

/**
 * 表情の強さ。
 * 以前は 0.55〜0.85 と強く、口パク(aa/ih…)と同時に効いて口や目が崩れていたため控えめにしている。
 */
const EMOTION_GAIN: Record<(typeof EXPRESSIONS)[number], number> = {
  happy: 0.42,
  sad: 0.5,
  angry: 0.35,
  surprised: 0.5,
  relaxed: 0.5,
};

/** 指の軽い曲げ(手がピンと伸びたままの不自然さを解消) */
const FINGER_NAMES = ["Index", "Middle", "Ring", "Little"] as const;
const FINGER_CURL: Record<string, number> = { Index: 0.16, Middle: 0.22, Ring: 0.28, Little: 0.34 };
const FINGER_JOINT_MUL = { Proximal: 1, Intermediate: 1.25, Distal: 0.8 } as const;

const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));

function VrmStageCore({ source, bus, camera, night, onStatus, libs }: VrmStageProps & { libs: StageLibs }) {
  const { THREE, VRMLoaderPlugin, VRMUtils, GLTFLoader, MMDLoader } = libs;
  const mount = useRef<HTMLDivElement>(null);
  const api = useRef<{ load: (s: ModelSource) => void; setCamera: (c: CameraPreset) => void; setNight: (n: boolean) => void } | null>(null);
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;

  useEffect(() => {
    const el = mount.current;
    if (!el) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "width:100%;height:100%;display:block;touch-action:none;cursor:grab";

    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 30);
    cam.position.set(0, 1.25, 2.6);

    const keyLight = new THREE.DirectionalLight(0xffffff, Math.PI * 0.95);
    keyLight.position.set(0.7, 1.4, 1.6);
    scene.add(keyLight);
    const rim = new THREE.DirectionalLight(0xbcd4ff, Math.PI * 0.25);
    rim.position.set(-1.4, 1.2, -1.2);
    scene.add(rim);
    const amb = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(amb);

    // MMD/VRMモデルの材質の明るさに合わせて、3Dステージの背景光(キー/リム/環境光)を
    // 自動調整する。明るいモデルほど照明を下げ、暗いモデルは少し持ち上げることで、
    // 「白飛びして眩しい」状態を避けながら陰影を残す。
    const AUTO_LIGHT = {
      enabled: true,
      targetLuminance: 0.42,
      minScale: 0.34,
      maxScale: 1.18,
      smoothing: 4.5,
    };
    let autoLightScale = 1;
    let autoLightTarget = 1;
    let nightRef = false;

    const srgbToLinear = (v: number) => {
      const x = THREE.MathUtils.clamp(v, 0, 1);
      return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };

    const materialLuminance = (material: any) => {
      let r = 0.7;
      let g = 0.7;
      let b = 0.7;
      if (material?.color) {
        r = material.color.r;
        g = material.color.g;
        b = material.color.b;
      }
      const base = 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
      const emissive = material?.emissive
        ? 0.2126 * material.emissive.r + 0.7152 * material.emissive.g + 0.0722 * material.emissive.b
        : 0;
      const ei = Number.isFinite(material?.emissiveIntensity) ? material.emissiveIntensity : 1;
      return THREE.MathUtils.clamp(base + emissive * ei * 0.35, 0.03, 1.8);
    };

    const updateAutoLightFromObject = (object: THREE.Object3D) => {
      if (!AUTO_LIGHT.enabled) return;
      let sum = 0;
      let weight = 0;
      object.traverse((o: any) => {
        if (!o?.isMesh || !o.material) return;
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        for (const mat of materials) {
          if (!mat) continue;
          const opacity = Number.isFinite(mat.opacity) ? THREE.MathUtils.clamp(mat.opacity, 0.2, 1) : 1;
          const w = Math.max(0.1, (o.geometry?.attributes?.position?.count || 1) / 1000) * opacity;
          sum += materialLuminance(mat) * w;
          weight += w;
        }
      });
      const luminance = weight > 0 ? sum / weight : 0.7;
      // 高輝度モデルほど scale を小さくする。暗すぎるモデルは1.0超まで少し補正。
      autoLightTarget = THREE.MathUtils.clamp(
        AUTO_LIGHT.targetLuminance / Math.max(0.08, luminance),
        AUTO_LIGHT.minScale,
        AUTO_LIGHT.maxScale,
      );
    };

    const applyAutoLight = () => {
      const nightMul = nightRef ? 0.62 : 1;
      const s = autoLightScale * nightMul;
      keyLight.intensity = Math.PI * 0.95 * s;
      rim.intensity = Math.PI * 0.25 * s;
      amb.intensity = 0.55 * s;
    };
    const lookTarget = new THREE.Object3D();
    scene.add(lookTarget);

    /* ---- state ---- */
    let vrm: VRM | null = null;
    let root: THREE.Object3D | null = null; // generic glb root
    let frame = { center: new THREE.Vector3(0, 0.9, 0), height: 1.55, headY: 1.35 };
    let preset: CameraPreset = "bust";
    const camGoal = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
    const view = { yaw: 0, pitch: 0, zoom: 1 };
    const pointer = { x: 0, y: 0 };
    let glbMorph: { mesh: THREE.Mesh; idx: number }[] = [];
    let glbBlink: { mesh: THREE.Mesh; idx: number }[] = [];
    let mmdMesh: THREE.SkinnedMesh | null = null;
    let mmdMorph: { mesh: THREE.SkinnedMesh; idx: number; vowel: Vowel }[] = [];
    let mmdBlink: { mesh: THREE.SkinnedMesh; idx: number }[] = [];
    let mmdEmotion: { mesh: THREE.SkinnedMesh; idx: number; emotion: Emotion }[] = [];
    let mmdObjectUrls: string[] = [];
    let glbBaseY = 0;
    let loadToken = 0;
    let disposed = false;

    /**
     * 正規化ボーンの回転軸の向き。
     * VRM 0.x は「-Z向き」で作られており、three-vrm の正規化ボーンはその座標系のままなので、
     * VRM 1.0 基準で書いたポーズ(腕を下ろす・お辞儀・首かしげ等)は X軸・Z軸まわりの符号を反転させないと逆向きになる。
     * (これが「ずっと手を上げている」「動きがぎこちない」の主因)
     * VRM 1.0 なら 1、VRM 0.x なら -1。読み込み時に左腕の向きから自動判定する。
     */
    let flip = 1;

    const mouth = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
    const emo = { happy: 0, sad: 0, angry: 0, surprised: 0, relaxed: 0 };
    let blink = 0;
    let blinkAt = 2;
    let blinkPhase = -1;
    let gesture: { name: keyof typeof GESTURE_DUR; start: number } | null = null;
    let pendingGesture: keyof typeof GESTURE_DUR | null = null;
    let lastGestureId = 0;
    let t = 0;
    let listenNod = 0;
    // 状態の切り替わりでポーズが瞬間移動しないよう、なめらかに追従させる量
    let speakAmt = 0;
    let thinkAmt = 0;

    /* ---- camera ---- */
    const computeGoal = () => {
      const H = frame.height;
      const aspect = cam.aspect || 1;
      const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
      let visible: number, cy: number, minWidth: number;
      if (preset === "face") {
        visible = 0.34 * H;
        cy = frame.headY + 0.015;
        minWidth = 0.42 * H;
      } else if (preset === "full") {
        visible = 1.2 * H;
        cy = frame.center.y + 0.02 * H;
        minWidth = 0.95 * H;
      } else {
        visible = 0.68 * H;
        cy = frame.headY - 0.2 * H + 0.03;
        minWidth = 0.62 * H;
      }
      const distH = visible / 2 / tanH;
      const distW = minWidth / 2 / (tanH * aspect);
      const dist = Math.max(distH, distW) * view.zoom;
      const cp = Math.cos(view.pitch);
      camGoal.target.set(frame.center.x, cy, frame.center.z);
      camGoal.pos.set(
        frame.center.x + Math.sin(view.yaw) * dist * cp,
        cy + Math.sin(view.pitch) * dist,
        frame.center.z + Math.cos(view.yaw) * dist * cp,
      );
    };

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
      computeGoal();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    cam.position.copy(camGoal.pos);
    const camLook = camGoal.target.clone();

    /* ---- model loading ---- */
    const disposeModel = () => {
      if (vrm) {
        scene.remove(vrm.scene);
        VRMUtils.deepDispose(vrm.scene);
        vrm = null;
      }
      if (root) {
        scene.remove(root);
        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.geometry?.dispose();
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            mats.forEach((mat) => mat?.dispose?.());
          }
        });
        root = null;
      }
      glbMorph = [];
      glbBlink = [];
      mmdMesh = null;
      mmdMorph = [];
      mmdBlink = [];
      mmdEmotion = [];
      for (const u of mmdObjectUrls) URL.revokeObjectURL(u);
      mmdObjectUrls = [];
      flip = 1;
    };

    /** 左腕(上腕→肘)が正規化座標系の +X 側へ伸びていれば 1、-X 側なら -1 */
    const detectFlip = (loaded: VRM): number => {
      const h = loaded.humanoid;
      const upper = h.getNormalizedBoneNode("leftUpperArm");
      const lower = h.getNormalizedBoneNode("leftLowerArm");
      const rootNode = h.normalizedHumanBonesRoot;
      if (upper && lower && rootNode) {
        rootNode.updateWorldMatrix(true, true);
        const a = rootNode.worldToLocal(upper.getWorldPosition(new THREE.Vector3()));
        const b = rootNode.worldToLocal(lower.getWorldPosition(new THREE.Vector3()));
        const dx = b.x - a.x;
        if (Math.abs(dx) > 1e-4) return dx > 0 ? 1 : -1;
      }
      // 判定できなかった場合はメタ情報から推定
      return (loaded.meta as unknown as { metaVersion?: string }).metaVersion === "0" ? -1 : 1;
    };

    const load = async (src: ModelSource) => {
      const token = ++loadToken;
      statusRef.current({ state: "loading", progress: 0 });
      const rawUrl = src.kind === "url" ? src.url : URL.createObjectURL(src.blob);
      try {
        const sourceFormat = src.format ?? inferModelFormat(src.name);

        if (sourceFormat === "mmd") {
          disposeModel();
          const sourceBlob: Blob = src.kind === "blob"
            ? src.blob
            : await fetch(src.url).then(async (r) => {
                if (!r.ok) throw new Error(`MMDモデルを取得できませんでした (${r.status})`);
                return await r.blob();
              });
          const archive = src.name.toLowerCase().endsWith(".zip");
          const entries: ZipEntry[] = archive
            ? await unzipForMmd(sourceBlob)
            : [{ name: src.name, data: new Uint8Array(await sourceBlob.arrayBuffer()), compression: 0 }];
          if (token !== loadToken || disposed) return;

          const selected = pickMmdModel(entries);
          if (!selected) throw new Error("PMX / PMDモデルが見つかりませんでした");
          const selectedExt = selected.name.toLowerCase().endsWith(".pmx") ? "pmx" : "pmd";

          const byPath = new Map<string, string>();
          const byBase = new Map<string, string[]>();
          const modelDir = selected.name.includes("/") ? selected.name.slice(0, selected.name.lastIndexOf("/")) : "";
          for (const entry of entries) {
            const entryBuffer = new Uint8Array(entry.data.byteLength);
            entryBuffer.set(entry.data);
            const objectUrl = URL.createObjectURL(new Blob([entryBuffer.buffer], { type: zipMime(entry.name) }));
            mmdObjectUrls.push(objectUrl);
            const normalized = zipPath(entry.name).toLowerCase();
            byPath.set(normalized, objectUrl);
            const base = normalized.split("/").pop() || normalized;
            byBase.set(base, [...(byBase.get(base) || []), objectUrl]);
          }

          // MMDLoaderは拡張子をURLから判定するため、ローカルZIP内のPMX/PMDを
          // 「仮想URL」に見せ、MMDLoader自身が保持しているLoadingManagerで
          // 実体のBlob URLへリダイレクトする。
          const requestedModelUrl = `https://limeai.local/mmd/${selected.name}`;
          if (!byPath.has(zipPath(selected.name).toLowerCase())) throw new Error("MMDモデル本体を展開できませんでした");

          const configureMmdLoader = (loader: { manager: THREE.LoadingManager }) => {
            loader.manager.setURLModifier((requested) => {
              let decoded = requested;
              try { decoded = decodeURIComponent(requested); } catch { /* keep raw */ }
              decoded = decoded.replace(/\\/g, "/").split("#")[0].split("?")[0].toLowerCase();

              const exact = [...byPath.entries()]
                .filter(([path]) => decoded === path || decoded.endsWith("/" + path))
                .sort((a, b) => b[0].length - a[0].length)[0];
              if (exact) return exact[1];

              const requestPath = decoded.split("/").pop() || decoded;
              const resolvedRelative = zipPath([modelDir, requestPath].filter(Boolean).join("/")).toLowerCase();
              if (byPath.has(resolvedRelative)) return byPath.get(resolvedRelative)!;

              const candidates = byBase.get(requestPath);
              if (candidates?.length === 1) return candidates[0];
              if (candidates?.length) {
                const matching = [...byPath.entries()].find(([path]) => path.endsWith("/" + requestPath));
                return matching?.[1] || candidates[0];
              }

              return requested;
            });
          };

          statusRef.current({ state: "loading", progress: 0.35 });
          const mmdLoader = new MMDLoader();
          configureMmdLoader(mmdLoader);
          const loadedMmd = await mmdLoader.loadAsync(requestedModelUrl, (e) => {
            if (e.total) statusRef.current({ state: "loading", progress: 0.35 + Math.min(0.64, (e.loaded / e.total) * 0.64) });
          });
          const mesh = loadedMmd.mesh;
          if (token !== loadToken || disposed) return;

          // 体格をVRM/GLBと同じ表示スケールへ正規化する。
          const box0 = new THREE.Box3().setFromObject(mesh);
          const size0 = box0.getSize(new THREE.Vector3());
          const scale = 1.55 / (size0.y || 1);
          mesh.scale.multiplyScalar(scale);
          mesh.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(mesh);
          const center = box.getCenter(new THREE.Vector3());
          mesh.position.x -= center.x;
          mesh.position.z -= center.z;
          mesh.position.y -= box.min.y;
          mesh.updateMatrixWorld(true);
          mesh.traverse((o) => (o.frustumCulled = false));
          scene.add(mesh);
          mmdMesh = mesh;
          root = mesh;
          updateAutoLightFromObject(mesh);
          glbBaseY = mesh.position.y;

          const names: string[] = [];
          const dict = (mesh.morphTargetDictionary ?? {}) as Record<string, number>;
          for (const [name, idx] of Object.entries(dict)) {
            names.push(name);
            const vowel = mmdVowelOf(name);
            if (vowel) mmdMorph.push({ mesh, idx, vowel });
            if (/(まばたき|瞬き|blink|eye.?close|closeeye)/i.test(name)) mmdBlink.push({ mesh, idx });
            const emotion = mmdEmotionOf(name);
            if (emotion) mmdEmotion.push({ mesh, idx, emotion });
          }

          frame = { center: new THREE.Vector3(0, 0.78, 0), height: 1.55, headY: 1.4 };
          const info: ModelInfo = {
            kind: "mmd",
            name: src.name,
            expressions: names.slice(0, 60),
            lipSync: mmdMorph.length > 0,
            format: selectedExt.toUpperCase(),
            modelFile: selected.name,
            packageFiles: entries.length,
          };
          computeGoal();
          camLook.copy(camGoal.target);
          cam.position.copy(camGoal.pos);
          statusRef.current({ state: "ready", info });
          return;
        }

        const loader = new GLTFLoader();
        loader.register((p) => new VRMLoaderPlugin(p));
        const gltf = await loader.loadAsync(rawUrl, (e) => {
          if (e.total) statusRef.current({ state: "loading", progress: e.loaded / e.total });
        });
        if (token !== loadToken || disposed) return;
        disposeModel();

        const loaded: VRM | undefined = gltf.userData.vrm;
        let info: ModelInfo;
        if (loaded) {
          VRMUtils.removeUnnecessaryVertices(gltf.scene);
          VRMUtils.combineSkeletons(gltf.scene);
          VRMUtils.rotateVRM0(loaded);
          loaded.scene.traverse((o) => (o.frustumCulled = false));
          scene.add(loaded.scene);
          vrm = loaded;
          updateAutoLightFromObject(loaded.scene);
          loaded.lookAt && (loaded.lookAt.target = lookTarget);
          loaded.scene.updateMatrixWorld(true);
          flip = detectFlip(loaded);
          const box = new THREE.Box3().setFromObject(loaded.scene);
          const head = loaded.humanoid.getNormalizedBoneNode("head");
          const hp = new THREE.Vector3();
          (head || loaded.scene).getWorldPosition(hp);
          frame = {
            center: new THREE.Vector3((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, 0),
            height: box.max.y - box.min.y,
            headY: head ? hp.y + 0.06 : box.max.y - 0.12,
          };
          const meta = loaded.meta as unknown as { name?: string; metaVersion?: string; authors?: string[]; author?: string; title?: string };
          const names: string[] = [];
          loaded.expressionManager?.expressions.forEach((e) => names.push(e.expressionName));
          info = {
            kind: "vrm",
            name: src.name,
            vrmVersion: meta.metaVersion === "1" ? "VRM 1.0" : "VRM 0.x",
            expressions: names,
            lipSync: STAGE_VOWELS.some((v) => names.includes(v)),
            title: meta.name || meta.title,
            author: meta.authors?.join(", ") || meta.author,
          };
        } else {
          const obj = gltf.scene;
          const box0 = new THREE.Box3().setFromObject(obj);
          const size0 = box0.getSize(new THREE.Vector3());
          const s = 1.55 / (size0.y || 1);
          obj.scale.multiplyScalar(s);
          obj.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(obj);
          const c = box.getCenter(new THREE.Vector3());
          obj.position.x -= c.x;
          obj.position.z -= c.z;
          obj.position.y -= box.min.y;
          obj.updateMatrixWorld(true);
          obj.traverse((o) => (o.frustumCulled = false));
          scene.add(obj);
          root = obj;
          updateAutoLightFromObject(obj);
          glbBaseY = obj.position.y;
          let headY = 0;
          let found = false;
          obj.traverse((o) => {
            if (!found && /(^|[_:.\s-])(head|頭)$/i.test(o.name)) {
              const v = new THREE.Vector3();
              o.getWorldPosition(v);
              headY = v.y;
              found = true;
            }
          });
          frame = { center: new THREE.Vector3(0, 0.78, 0), height: 1.55, headY: found ? headY + 0.05 : 1.4 };
          const names: string[] = [];
          obj.traverse((o) => {
            const m = o as THREE.Mesh;
            const dict = m.morphTargetDictionary as Record<string, number> | undefined;
            if (!m.isMesh || !dict) return;
            for (const [k, idx] of Object.entries(dict)) {
              const lk = k.toLowerCase();
              names.push(k);
              if (/^(aa|a|あ|mouth_?open|jaw_?open|viseme_aa|mth_a|fcl_mth_a|vrc\.v_aa|mouthopen)$/.test(lk)) glbMorph.push({ mesh: m, idx });
              if (/(blink|eyes?_?closed|fcl_eye_close$|eye_?close)/.test(lk)) glbBlink.push({ mesh: m, idx });
            }
          });
          info = { kind: "glb", name: src.name, expressions: names.slice(0, 40), lipSync: glbMorph.length > 0 };
        }
        computeGoal();
        camLook.copy(camGoal.target);
        cam.position.copy(camGoal.pos);
        statusRef.current({ state: "ready", info });
      } catch (e) {
        if (token !== loadToken || disposed) return;
        statusRef.current({ state: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        if (src.kind === "blob") URL.revokeObjectURL(rawUrl);
      }
    };

    api.current = {
      load,
      setCamera: (c) => {
        preset = c;
        view.yaw = 0;
        view.pitch = 0;
        view.zoom = 1;
        computeGoal();
      },
      setNight: (n) => {
        nightRef = n;
        keyLight.color.set(n ? 0xdfe6ff : 0xffffff);
        rim.color.set(n ? 0xff9ad0 : 0xbcd4ff);
        applyAutoLight();
      },
    };

    /* ---- interaction ---- */
    const cv = renderer.domElement;
    let dragging = false;
    let moved = 0;
    let lx = 0;
    let ly = 0;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      moved = 0;
      lx = e.clientX;
      ly = e.clientY;
      cv.setPointerCapture(e.pointerId);
      cv.style.cursor = "grabbing";
    };
    const onMove = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointer.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
      if (!dragging) return;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      view.yaw = THREE.MathUtils.clamp(view.yaw - dx * 0.006, -1.1, 1.1);
      view.pitch = THREE.MathUtils.clamp(view.pitch + dy * 0.004, -0.35, 0.55);
      computeGoal();
    };
    const onUp = (e: PointerEvent) => {
      dragging = false;
      cv.style.cursor = "grab";
      try {
        cv.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (moved < 6) triggerGesture(bus, Math.random() < 0.5 ? "wave" : "nod");
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      view.zoom = THREE.MathUtils.clamp(view.zoom * (1 + e.deltaY * 0.001), 0.45, 1.8);
      computeGoal();
    };
    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("wheel", onWheel, { passive: false });
    const onWinMove = (e: PointerEvent) => {
      if (dragging) return;
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", onWinMove);

    /* ---- per-frame update ---- */
    const update = (dt: number) => {
      t += dt;
      if (AUTO_LIGHT.enabled) {
        autoLightScale = damp(autoLightScale, autoLightTarget, AUTO_LIGHT.smoothing, dt);
        applyAutoLight();
      }
      const now = performance.now();
      const s = bus.lip.sample(now);
      const speaking = bus.speaking && bus.lip.active;
      const openTarget = speaking && !s.pause ? s.open : 0;

      // 状態量をなめらかに追従(話し始め・考え始めで腕や首が急にカクつかない)
      speakAmt = damp(speakAmt, speaking ? 1 : 0, 5, dt);
      thinkAmt = damp(thinkAmt, bus.thinking ? 1 : 0, 4, dt);

      // vowel weights
      for (const v of STAGE_VOWELS) {
        const target = speaking && s.vowel === v ? openTarget * 0.9 : 0;
        mouth[v] = damp(mouth[v], target, target > mouth[v] ? 34 : 22, dt);
      }
      const openness = mouth.aa + mouth.ih * 0.6 + mouth.ou * 0.6 + mouth.ee * 0.6 + mouth.oh * 0.8;

      // emotion(口を開けている間は表情を弱め、口パクと表情が重なって崩れるのを防ぐ)
      for (const e of EXPRESSIONS) {
        const goal = bus.emotion === e ? EMOTION_GAIN[e] : 0;
        emo[e] = damp(emo[e], goal, 5, dt);
      }
      const emoScale = 1 - Math.min(1, openness) * 0.6;

      // blink
      blinkAt -= dt;
      if (blinkAt <= 0 && blinkPhase < 0) {
        blinkPhase = 0;
        blinkAt = 2 + Math.random() * 3.5;
      }
      if (blinkPhase >= 0) {
        blinkPhase += dt / 0.16;
        blink = blinkPhase < 1 ? Math.sin(blinkPhase * Math.PI) : 0;
        if (blinkPhase >= 1) blinkPhase = -1;
      }

      // gesture request (再生中に新しい要求が来たら1件だけ待たせ、終わってから再生する)
      if (bus.gesture && bus.gesture.id !== lastGestureId) {
        lastGestureId = bus.gesture.id;
        if (!gesture) gesture = { name: bus.gesture.name, start: t };
        else pendingGesture = bus.gesture.name;
      }
      let gp = 0;
      let genv = 0;
      let gname: keyof typeof GESTURE_DUR | null = null;
      if (gesture) {
        const dur = GESTURE_DUR[gesture.name];
        gp = (t - gesture.start) / dur;
        if (gp >= 1) {
          gesture = pendingGesture ? { name: pendingGesture, start: t } : null;
          pendingGesture = null;
          gp = 0;
        } else {
          gname = gesture.name;
          genv = Math.min(1, gp * 5, (1 - gp) * 5);
          genv = genv * genv * (3 - 2 * genv);
        }
      }
      const gt = gesture ? t - gesture.start : 0;

      if (vrm) {
        const em = vrm.expressionManager;
        if (em) {
          for (const v of STAGE_VOWELS) em.setValue(v, Math.min(1, mouth[v]));
          for (const e of EXPRESSIONS) em.setValue(e, emo[e] * emoScale);
          em.setValue("blink", Math.max(0, blink * (1 - Math.min(1, emo.happy * 1.5))));
        }

        // pose(VRM 1.0 の座標系で記述。実際の適用時に flip で VRM 0.x へ変換する)
        const breath = Math.sin(t * 1.6);
        listenNod = damp(listenNod, bus.listening ? 1 : 0, 4, dt);
        const P: Pose = {
          headX: Math.sin(t * 0.8) * 0.015 - openness * 0.05 + speakAmt * Math.sin(t * 3.3) * 0.012 + Math.sin(t * 1.3) * 0.02 * listenNod,
          headY: Math.sin(t * 0.55) * 0.05 + pointer.x * 0.28,
          headZ: 0.07 * listenNod + (1 - listenNod) * Math.sin(t * 0.45) * 0.015,
          neckX: 0,
          spineX: 0.012 * breath + 0.02 * speakAmt,
          spineZ: Math.sin(t * 0.6) * 0.018,
          chestX: 0.014 * breath,
          hipsY: Math.sin(t * 0.4) * 0.035,
          hipsPosY: 0,
          lUz: -1.22 + 0.02 * breath,
          lUy: -0.1,
          lLy: -0.28,
          lLz: 0,
          rUz: 1.22 - 0.02 * breath,
          rUy: 0.1,
          rLy: 0.28,
          rLz: 0,
          lShZ: -0.02 * breath,
          rShZ: 0.02 * breath,
        };
        P.headX += -pointer.y * 0.12;
        P.neckX = P.headX * 0.4;
        // 考え中のしぐさ
        P.headZ += 0.09 * thinkAmt;
        P.headY += 0.16 * thinkAmt;
        P.headX += -0.05 * thinkAmt;
        // 話している間の控えめな手ぶり
        P.rUz -= speakAmt * (0.06 + 0.05 * Math.sin(t * 1.9));
        P.rLy += speakAmt * (0.12 + 0.1 * Math.sin(t * 2.3 + 1));
        P.lLy -= speakAmt * (0.06 + 0.05 * Math.sin(t * 2.1));

        const mix = <K extends keyof Pose>(k: K, v: number) => {
          P[k] = P[k] * (1 - genv) + v * genv;
        };
        if (gname === "wave") {
          mix("rUz", 0.3);
          mix("rUy", 0.6);
          mix("rLz", -1.3 + Math.sin(gt * 11) * 0.3);
          mix("rLy", 0.2);
          P.headZ += 0.07 * genv;
          P.headX += -0.03 * genv;
        } else if (gname === "nod") {
          P.headX += Math.sin(gp * Math.PI * 2) * 0.2 * genv;
        } else if (gname === "bow") {
          const bell = Math.pow(Math.sin(Math.PI * Math.min(1, gp)), 0.8);
          P.spineX += 0.42 * bell;
          P.chestX += 0.2 * bell;
          P.headX += 0.22 * bell;
          mix("lLy", -0.5);
          mix("rLy", 0.5);
        } else if (gname === "cheer") {
          mix("lUz", 1.35 + Math.sin(gt * 9) * 0.12);
          mix("rUz", -1.35 - Math.sin(gt * 9 + 1) * 0.12);
          mix("lLy", -0.1);
          mix("rLy", 0.1);
          P.hipsPosY += Math.abs(Math.sin(gt * 7)) * 0.035 * genv;
          P.headX += -0.1 * genv;
        }

        const h = vrm.humanoid;
        const F = flip;
        const set = (name: BoneName, x: number, y: number, z: number, order?: THREE.EulerOrder) => {
          const n = h.getNormalizedBoneNode(name);
          if (!n) return;
          if (order) n.rotation.order = order;
          // X/Z まわりの回転は VRM 0.x では符号を反転する(Y軸まわりは共通)
          n.rotation.set(x * F, y, z * F);
        };
        set("hips", 0, P.hipsY, 0);
        const hips = h.getNormalizedBoneNode("hips");
        if (hips) hips.position.y = (hips.userData.baseY ??= hips.position.y) + P.hipsPosY;
        set("spine", P.spineX, 0, P.spineZ);
        set("chest", P.chestX, 0, 0);
        set("neck", P.neckX, P.headY * 0.4, P.headZ * 0.4);
        set("head", P.headX - P.neckX, P.headY * 0.6, P.headZ * 0.6);
        set("leftShoulder", 0, 0, P.lShZ);
        set("rightShoulder", 0, 0, P.rShZ);
        set("leftUpperArm", 0, P.lUy, P.lUz, "ZYX");
        set("rightUpperArm", 0, P.rUy, P.rUz, "ZYX");
        set("leftLowerArm", 0, P.lLy, P.lLz, "ZYX");
        set("rightLowerArm", 0, P.rLy, P.rLz, "ZYX");
        set("leftHand", 0, 0, 0.08 * Math.sin(t * 1.1));
        set("rightHand", 0, 0, -0.08 * Math.sin(t * 1.1 + 1));

        // 指を軽く曲げて自然な手にする(万歳・手を振る間は少し開く)
        const open = gname === "cheer" || gname === "wave" ? genv * 0.6 : 0;
        for (const f of FINGER_NAMES) {
          const base = FINGER_CURL[f] * (1 - open);
          for (const joint of ["Proximal", "Intermediate", "Distal"] as const) {
            const c = base * FINGER_JOINT_MUL[joint];
            set(`left${f}${joint}` as BoneName, 0, 0, -c);
            set(`right${f}${joint}` as BoneName, 0, 0, c);
          }
        }

        // eye look target follows the pointer
        lookTarget.position.set(pointer.x * 0.8, frame.headY + pointer.y * 0.5, 2.0);
        vrm.update(dt);
      } else if (mmdMesh) {
        const amp = Math.min(1, openness);
        for (const m of mmdMorph) {
          const target = speaking && !s.pause && s.vowel === m.vowel ? amp : 0;
          if (m.mesh.morphTargetInfluences) m.mesh.morphTargetInfluences[m.idx] = target;
        }
        for (const m of mmdBlink) if (m.mesh.morphTargetInfluences) m.mesh.morphTargetInfluences[m.idx] = blink;
        for (const m of mmdEmotion) if (m.mesh.morphTargetInfluences) m.mesh.morphTargetInfluences[m.idx] = emo[m.emotion] * emoScale;

        // MMDはVRMの正規化ボーンを持たないため、通話中の自然な首振り・呼吸・ジェスチャーは
        // モデル全体に軽く加える。元のPMX/PMD骨格や物理設定を直接壊さない。
        mmdMesh.position.y = glbBaseY + Math.sin(t * 1.5) * 0.006 + amp * 0.01;
        mmdMesh.rotation.y = Math.sin(t * 0.5) * 0.12 + pointer.x * 0.25;
        mmdMesh.rotation.z = Math.sin(t * 0.7) * 0.01;
        if (gname === "nod") mmdMesh.rotation.x = Math.sin(gp * Math.PI * 2) * 0.06 * genv;
        else if (gname === "wave") mmdMesh.rotation.z += Math.sin(gt * 11) * 0.05 * genv;
        else if (gname === "bow") mmdMesh.rotation.x = 0.3 * Math.sin(Math.PI * gp);
        else if (gname === "cheer") mmdMesh.position.y += Math.abs(Math.sin(gt * 7)) * 0.05 * genv;
        else mmdMesh.rotation.x = 0;
      } else if (root) {
        const amp = Math.min(1, openness);
        root.position.y = glbBaseY + Math.sin(t * 1.5) * 0.006 + amp * 0.01;
        root.rotation.y = Math.sin(t * 0.5) * 0.12 + pointer.x * 0.25;
        root.rotation.z = Math.sin(t * 0.7) * 0.01;
        if (gname === "nod") root.rotation.x = Math.sin(gp * Math.PI * 2) * 0.06 * genv;
        else if (gname === "wave") root.rotation.z += Math.sin(gt * 11) * 0.05 * genv;
        else if (gname === "bow") root.rotation.x = 0.3 * Math.sin(Math.PI * gp);
        else if (gname === "cheer") root.position.y += Math.abs(Math.sin(gt * 7)) * 0.05 * genv;
        else root.rotation.x = 0;
        for (const m of glbMorph) if (m.mesh.morphTargetInfluences) m.mesh.morphTargetInfluences[m.idx] = amp;
        for (const m of glbBlink) if (m.mesh.morphTargetInfluences) m.mesh.morphTargetInfluences[m.idx] = blink;
      }

      // camera easing
      cam.position.x = damp(cam.position.x, camGoal.pos.x, 5, dt);
      cam.position.y = damp(cam.position.y, camGoal.pos.y, 5, dt);
      cam.position.z = damp(cam.position.z, camGoal.pos.z, 5, dt);
      camLook.x = damp(camLook.x, camGoal.target.x, 5, dt);
      camLook.y = damp(camLook.y, camGoal.target.y, 5, dt);
      camLook.z = damp(camLook.z, camGoal.target.z, 5, dt);
      cam.lookAt(camLook);
    };

    let lastTs = performance.now();
    renderer.setAnimationLoop(() => {
      const ts = performance.now();
      const dt = Math.min((ts - lastTs) / 1000, 0.05);
      lastTs = ts;
      update(dt);
      renderer.render(scene, cam);
    });

    return () => {
      disposed = true;
      loadToken++;
      renderer.setAnimationLoop(null);
      ro.disconnect();
      cv.removeEventListener("pointerdown", onDown);
      cv.removeEventListener("pointermove", onMove);
      cv.removeEventListener("pointerup", onUp);
      cv.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointermove", onWinMove);
      disposeModel();
      renderer.dispose();
      renderer.domElement.remove();
      api.current = null;
    };
  }, []);

  useEffect(() => {
    api.current?.load(source);
  }, [source]);
  useEffect(() => {
    api.current?.setCamera(camera);
  }, [camera]);
  useEffect(() => {
    api.current?.setNight(night);
  }, [night]);

  return <div ref={mount} className="absolute inset-0" />;
}

function VrmStage(props: VrmStageProps) {
  const [libs, setLibs] = useState<StageLibs | null>(null);
  const statusRef = useRef(props.onStatus);
  statusRef.current = props.onStatus;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      import("three"),
      import("@pixiv/three-vrm"),
      import("three/examples/jsm/loaders/GLTFLoader.js"),
      // MMDLoader は three の一部バージョンで型宣言が提供されないため、
      // 実行時 import は維持しつつローカルの最小型で受ける。
      import("@moeru/three-mmd"),
    ])
      .then(([THREE, vrm, gltf, mmd]) => {
        if (cancelled) return;
        setLibs({
          THREE,
          VRMLoaderPlugin: vrm.VRMLoaderPlugin,
          VRMUtils: vrm.VRMUtils,
          GLTFLoader: gltf.GLTFLoader,
          MMDLoader: mmd.MMDLoader as unknown as MMDLoaderLike,
        });
      })
      .catch((e) => {
        if (!cancelled) statusRef.current({ state: "error", message: `3Dライブラリを読み込めませんでした: ${e instanceof Error ? e.message : String(e)}` });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!libs) return <div className="absolute inset-0" />;
  return <VrmStageCore {...props} libs={libs} />;
}

/* ==================================================================
   LimeAI 拡張: ボイスモード
   ================================================================== */

const DEFAULT_MODEL = { id: "default", name: "アリア (VRoid サンプル / CC0)", url: `${import.meta.env.BASE_URL}models/aria.vrm` };

type Prefs = {
  voiceURI: string;
  lang: "auto" | "ja-JP" | "en-US" | "zh-CN" | "ko-KR";
  rate: number;
  pitch: number;
  volume: number;
  emotion: "auto" | Emotion;
  camera: CameraPreset;
  modelId: string;
};

const DEFAULT_PREFS: Prefs = {
  voiceURI: "",
  lang: "auto",
  rate: 1,
  pitch: 1.15,
  volume: 1,
  emotion: "auto",
  camera: "bust",
  modelId: "default",
};

const LANGS: { id: Prefs["lang"]; label: string }[] = [
  { id: "auto", label: "自動判定" },
  { id: "ja-JP", label: "日本語" },
  { id: "en-US", label: "English" },
  { id: "zh-CN", label: "中文" },
  { id: "ko-KR", label: "한국어" },
];

const EMOTIONS: { id: Prefs["emotion"]; label: string }[] = [
  { id: "auto", label: "自動" },
  { id: "neutral", label: "通常" },
  { id: "happy", label: "喜び" },
  { id: "sad", label: "悲しみ" },
  { id: "angry", label: "怒り" },
  { id: "surprised", label: "驚き" },
  { id: "relaxed", label: "安らぎ" },
];

const GESTURES: { id: GestureName; label: string }[] = [
  { id: "wave", label: "手を振る" },
  { id: "nod", label: "うなずく" },
  { id: "bow", label: "お辞儀" },
  { id: "cheer", label: "バンザイ" },
];

function detectTtsLang(text: string): string {
  if (/[\u3040-\u30ff]/.test(text)) return "ja-JP";
  if (/[\uac00-\ud7af]/.test(text)) return "ko-KR";
  if (/[\u4e00-\u9fff]/.test(text)) return "zh-CN";
  return /[a-z]/i.test(text) ? "en-US" : "ja-JP";
}

function pickVoice(voices: SpeechSynthesisVoice[], lang: string, preferred: string) {
  const prefix = lang.split("-")[0].toLowerCase();
  const pref = voices.find((v) => v.voiceURI === preferred);
  if (pref && pref.lang.toLowerCase().startsWith(prefix)) return pref;
  const cands = voices.filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith(prefix));
  const score = (v: SpeechSynthesisVoice) =>
    (/(nanami|haruka|ayumi|kyoko|o-ren|google 日本語|sayaka|female|xiaoxiao|yuna|aria|jenny|samantha)/i.test(v.name) ? 2 : 0) +
    (/(natural|online|neural)/i.test(v.name) ? 1 : 0);
  return cands.sort((a, b) => score(b) - score(a))[0];
}

const MIC_ERRORS: Record<string, string> = {
  "not-allowed": "マイクの使用が許可されていません。ブラウザのアドレスバーの設定から許可してください。",
  "service-not-allowed": "このブラウザでは音声認識サービスが許可されていません。",
  "audio-capture": "マイクが見つかりません。接続を確認してください。",
  network: "音声認識サーバーに接続できません。ネットワークを確認してください (ChromeやEdgeの音声認識はオンライン接続が必要です)。",
  unsupported: "このブラウザは音声認識に対応していません。Chrome / Edge / Safari をお使いください。",
};

type Phase = "idle" | "listening" | "thinking" | "speaking";

type VoiceModeProps = {
  onClose: () => void;
  /** ユーザーの発話(テキスト入力 or 音声認識)をAIへ送り、返答テキスト(Markdown可)を返す。ChatPage 側で LimeAI へ問い合わせる */
  onAsk: (text: string, signal: AbortSignal) => Promise<string>;
};

function VoiceMode({ onClose, onAsk }: VoiceModeProps) {
  const { resolvedTheme } = useTheme();
  const night = resolvedTheme === "dark";
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const [loadedPrefs, setLoadedPrefs] = useState(false);

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [customs, setCustoms] = useState<StoredModel[]>([]);
  const [status, setStatus] = useState<StageStatus>({ state: "loading", progress: 0 });
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [panel, setPanel] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const phaseRef = useRef<Phase>("idle");
  const [micOn, setMicOn] = useState(false);
  const micRef = useRef(false);
  const [interim, setInterim] = useState("");
  const [text, setText] = useState("");
  const [current, setCurrent] = useState("");
  const [spoken, setSpoken] = useState(0);
  const [history, setHistory] = useState<{ id: number; text: string }[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState("");
  const [uploadErr, setUploadErr] = useState("");
  const [saved, setSaved] = useState(false);

  const bus = useRef<AvatarBus>(createBus(new LipSync()));
  const speaker = useRef(new Speaker());
  const listener = useRef(new Listener());
  const stopMeter = useRef<null | (() => void)>(null);
  const ring = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const abortAI = useRef<AbortController | null>(null);
  const historyId = useRef(0);
  const neutralTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const update = (patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch }));

  /* ---------- init ---------- */
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem("limeai-voice") || "{}");
      delete p.night;
      // 旧バージョンの「そのまま読み上げる」モード設定は廃止(常にAIの返答を読み上げる)
      delete p.aiMode;
      setPrefs({ ...DEFAULT_PREFS, ...p });
    } catch {
      /* ignore */
    }
    setLoadedPrefs(true);
    getVoices().then(setVoices);
    listModels()
      .then((m) => setCustoms(m.sort((a, b) => a.createdAt - b.createdAt)))
      .catch(() => {});
    const b = bus.current;
    const sp = speaker.current;
    const ls = listener.current;
    return () => {
      sp.cancel();
      ls.abort();
      abortAI.current?.abort();
      stopMeter.current?.();
      if (neutralTimer.current) clearTimeout(neutralTimer.current);
      b.speaking = false;
      b.listening = false;
      b.lip.end();
    };
  }, []);

  useEffect(() => {
    if (!loadedPrefs) return;
    try {
      localStorage.setItem("limeai-voice", JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }, [prefs, loadedPrefs]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  /* per-frame UI updates (subtitle progress, mic ring) */
  useEffect(() => {
    let raf = 0;
    let last = -1;
    const tick = () => {
      const b = bus.current;
      if (b.speaking && b.lip.active) {
        const i = Math.floor(b.lip.position(performance.now()));
        if (i !== last) {
          last = i;
          setSpoken(i);
        }
      }
      if (ring.current) ring.current.style.transform = `scale(${1 + b.micLevel * 0.9})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ---------- model source ---------- */
  const source: ModelSource = useMemo(() => {
    if (prefs.modelId !== "default") {
      const m = customs.find((c) => c.id === prefs.modelId);
      if (m) return { kind: "blob", blob: m.blob, name: m.name, format: m.format ?? inferModelFormat(m.name) };
    }
    return { kind: "url", url: DEFAULT_MODEL.url, name: DEFAULT_MODEL.name, format: "vrm" };
  }, [prefs.modelId, customs.length]);

  const onStatus = useCallback((s: StageStatus) => {
    setStatus(s);
    if (s.state === "ready") setInfo(s.info);
  }, []);

  const uploadModel = async (file: File) => {
    setUploadErr("");
    if (!/\.(vrm|glb|pmx|pmd|zip)$/i.test(file.name)) {
      setUploadErr("VRM / GLB / PMX / PMD / MMD ZIP に対応しています");
      return;
    }
    if (file.size > 120 * 1024 * 1024) {
      setUploadErr("ファイルサイズが大きすぎます (120MBまで)");
      return;
    }
    const m: StoredModel = { id: `m_${Date.now().toString(36)}`, name: file.name, blob: file, format: inferModelFormat(file.name), createdAt: Date.now() };
    try {
      await putModel(m);
    } catch {
      /* IndexedDB unavailable: still use in-memory */
    }
    setCustoms((c) => [...c, m]);
    update({ modelId: m.id });
  };

  const removeModel = async (id: string) => {
    await deleteModel(id).catch(() => {});
    setCustoms((c) => c.filter((m) => m.id !== id));
    if (prefsRef.current.modelId === id) update({ modelId: "default" });
  };

  /* ---------- speaking ---------- */
  const fireGesture = (name: GestureName) => {
    triggerGesture(bus.current, name);
  };

  const startListenRef = useRef<() => void>(() => {});

  const finishSpeaking = useCallback(() => {
    const b = bus.current;
    b.speaking = false;
    b.lip.end();
    setSpoken(Number.MAX_SAFE_INTEGER);
    if (neutralTimer.current) clearTimeout(neutralTimer.current);
    neutralTimer.current = setTimeout(() => {
      if (!bus.current.speaking) bus.current.emotion = "neutral";
    }, 900);
    if (micRef.current) {
      setPhaseBoth("listening");
      setTimeout(() => startListenRef.current(), 350);
    } else {
      setPhaseBoth("idle");
    }
  }, []);

  /** AIの返答テキスト(またはテスト文・履歴の再生)を3Dキャラクターが声に出して話す */
  const speak = useCallback(
    (raw: string) => {
      const t = raw.replace(/[ \t]+\n/g, "\n").trim();
      if (!t) return;
      const p = prefsRef.current;
      listener.current.abort();
      setInterim("");
      setError("");
      if (neutralTimer.current) clearTimeout(neutralTimer.current);
      const lang = p.lang === "auto" ? detectTtsLang(t) : p.lang;
      const voice = pickVoice(voices.length ? voices : ttsSupported() ? speechSynthesis.getVoices() : [], lang, p.voiceURI);
      const b = bus.current;
      b.emotion = p.emotion === "auto" ? detectEmotion(t) : p.emotion;
      b.thinking = false;
      b.listening = false;
      b.lip.begin(t, p.rate);
      b.speaking = true;
      if (/(こんにちは|こんばんは|おはよう|はじめまして|初めまして|やあ|hello|hi\b|hey)/i.test(t)) fireGesture("wave");
      else if (/(ありがとう|ごめん|すみません|申し訳|お願いします|thank|sorry)/i.test(t)) fireGesture("bow");
      else if (/(おめでとう|やった|最高|わーい|congrat)/i.test(t)) fireGesture("cheer");
      else fireGesture("nod");
      setCurrent(t);
      setSpoken(0);
      setPhaseBoth("speaking");
      setHistory((h) => [{ id: ++historyId.current, text: t }, ...h].slice(0, 30));
      speaker.current.speak(
        t,
        { voiceURI: voice?.voiceURI, lang, rate: p.rate, pitch: p.pitch, volume: p.volume },
        {
          onChunkStart: (_c, off) => b.lip.chunk(off),
          onBoundary: (i) => b.lip.boundary(i),
          onEnd: finishSpeaking,
          onError: (m) => {
            setError(m);
            finishSpeaking();
          },
        },
      );
    },
    [voices, finishSpeaking],
  );

  /** ユーザーの発話をAIへ送り、返ってきた返答をキャラクターが話す */
  const askAI = useCallback(
    async (userText: string) => {
      // 前回の返答の読み上げ・問い合わせが残っていれば止める
      speaker.current.cancel();
      abortAI.current?.abort();
      bus.current.speaking = false;
      bus.current.lip.end();
      bus.current.listening = false;
      listener.current.abort();
      setInterim("");

      setPhaseBoth("thinking");
      bus.current.thinking = true;
      setCurrent("");
      setError("");
      const ac = new AbortController();
      abortAI.current = ac;
      let reply = "";
      try {
        reply = await onAsk(userText, ac.signal);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
      } finally {
        bus.current.thinking = false;
        if (abortAI.current === ac) abortAI.current = null;
      }
      const spokenReply = stripMarkdown(reply);
      if (spokenReply && !ac.signal.aborted) speak(spokenReply);
      else if (!ac.signal.aborted) {
        setPhaseBoth(micRef.current ? "listening" : "idle");
        if (micRef.current) setTimeout(() => startListenRef.current(), 250);
      }
    },
    [speak, onAsk],
  );

  /** 入力された文字・認識された音声は、必ずAIに送って返答を話してもらう */
  const handleUserText = useCallback(
    (t: string) => {
      const s = t.trim();
      if (!s) return;
      askAI(s);
    },
    [askAI],
  );

  const stopAll = () => {
    speaker.current.cancel();
    abortAI.current?.abort();
    const b = bus.current;
    b.speaking = false;
    b.thinking = false;
    b.lip.end();
    setPhaseBoth(micRef.current ? "listening" : "idle");
    if (micRef.current) startListenRef.current();
  };

  /* ---------- microphone ---------- */
  const startListen = useCallback(() => {
    if (!micRef.current) return;
    if (phaseRef.current === "speaking" || phaseRef.current === "thinking") return;
    const p = prefsRef.current;
    const lang = p.lang === "auto" ? "ja-JP" : p.lang;
    bus.current.listening = true;
    setPhaseBoth("listening");
    listener.current.start(lang, {
      onInterim: () => {},
      onFinal: (t) => {
        setInterim("");
        bus.current.listening = false;
        handleUserText(t);
      },
      onEnd: () => {
        if (!micRef.current) return;
        if (phaseRef.current === "listening") setTimeout(() => startListenRef.current(), 250);
      },
      onError: (code) => {
        if (code === "no-speech" || code === "aborted") return;
        setError(MIC_ERRORS[code] || `音声認識エラー: ${code}`);
        if (code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture" || code === "unsupported") {
          micRef.current = false;
          setMicOn(false);
          bus.current.listening = false;
          setPhaseBoth("idle");
          stopMeter.current?.();
          stopMeter.current = null;
        }
      },
    });
  }, [handleUserText]);
  startListenRef.current = startListen;

  const toggleMic = async () => {
    if (micRef.current) {
      micRef.current = false;
      setMicOn(false);
      listener.current.abort();
      bus.current.listening = false;
      setInterim("");
      stopMeter.current?.();
      stopMeter.current = null;
      if (phaseRef.current === "listening") setPhaseBoth("idle");
      return;
    }
    if (!sttSupported()) {
      setError(MIC_ERRORS.unsupported);
      return;
    }
    setError("");
    micRef.current = true;
    setMicOn(true);
    startMeter((v) => (bus.current.micLevel = v))
      .then((stop) => {
        if (!micRef.current) stop();
        else stopMeter.current = stop;
      })
      .catch(() => {});
    if (phaseRef.current === "speaking") speaker.current.cancel(), finishSpeaking();
    startListen();
  };

  const send = () => {
    if (!text.trim()) return;
    const t = text;
    setText("");
    handleUserText(t);
  };

  const selectedVoice = useMemo(() => {
    const lang = prefs.lang === "auto" ? "ja-JP" : prefs.lang;
    return pickVoice(voices, lang, prefs.voiceURI);
  }, [voices, prefs.lang, prefs.voiceURI]);

  const voicesForLang = useMemo(() => {
    const pf = (prefs.lang === "auto" ? "ja" : prefs.lang.split("-")[0]).toLowerCase();
    const list = voices.filter((v) => v.lang.toLowerCase().startsWith(pf));
    return list.length ? list : voices;
  }, [voices, prefs.lang]);

  /** 設定画面の「テスト再生」: 声の確認用にサンプル文を話させる(AIへは送らない) */
  const testVoice = () => {
    const sample: Record<string, string> = {
      "ja-JP": "こんにちは! 音声のテストです。私の声、聞こえていますか?",
      "en-US": "Hello! This is a voice test. Can you hear me?",
      "zh-CN": "你好!这是语音测试。你能听到我说话吗?",
      "ko-KR": "안녕하세요! 음성 테스트입니다.",
    };
    speak(sample[prefs.lang === "auto" ? "ja-JP" : prefs.lang]);
  };

  const spokenText = current.slice(0, Math.min(spoken, current.length));
  const restText = current.slice(Math.min(spoken, current.length));
  void spokenText
  void restText

  const ttsOk = ttsSupported();
  const sttOk = typeof window !== "undefined" ? sttSupported() : true;
  const panelBtn = "rounded-full border px-3 py-1.5 text-xs font-medium transition";
  const on = night ? "border-pink-400/60 bg-pink-500/20 text-pink-200" : "border-pink-400/60 bg-pink-500/10 text-pink-600";
  const off = night ? "border-white/10 text-white/70 hover:bg-white/10" : "border-black/10 text-black/60 hover:bg-black/5";
  const label = night ? "text-white/60" : "text-black/50";
  const fg = night ? "text-white" : "text-slate-800";

  return (
    <div className={`voice-bg absolute inset-0 z-[60] overflow-hidden ${night ? "night" : ""} ${fg}`} role="dialog" aria-label="ボイスモード">
      {/* decorative */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className={`absolute left-1/2 top-[52%] h-[70vmin] w-[70vmin] -translate-x-1/2 -translate-y-1/2 rounded-full blur-2xl ${night ? "bg-violet-500/20" : "bg-white/60"}`} />
        {[...Array(14)].map((_, i) => (
          <span
            key={i}
            className={`absolute rounded-full ${night ? "bg-pink-200/60" : "bg-white/90"}`}
            style={{
              left: `${(i * 37 + 7) % 100}%`,
              top: `${(i * 53 + 11) % 90}%`,
              width: 4 + (i % 4) * 3,
              height: 4 + (i % 4) * 3,
              animation: `float-slow ${6 + (i % 5)}s ease-in-out ${i * 0.4}s infinite`,
              opacity: 0.55,
            }}
          />
        ))}
      </div>

      {/* 3D stage */}
      {loadedPrefs && (
        <Suspense fallback={null}>
          <VrmStage source={source} bus={bus.current} camera={prefs.camera} night={night} onStatus={onStatus} />
        </Suspense>
      )}

      {status.state === "loading" && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="glass flex items-center gap-3 rounded-2xl px-5 py-3 text-sm font-medium shadow-lg">
            <Loader2 size={18} className="spin text-pink-500" />
            キャラクターを読み込み中… {Math.round(status.progress * 100)}%
          </div>
        </div>
      )}
      {status.state === "error" && (
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="glass max-w-md rounded-2xl p-5 text-sm shadow-lg">
            <div className="mb-1 font-bold text-red-500">モデルを読み込めませんでした</div>
            <div className="break-words opacity-80">{status.message}</div>
            <button type="button" onClick={() => update({ modelId: "default" })} className="mt-3 rounded-full bg-pink-500 px-4 py-1.5 text-white">
              デフォルトのキャラクターに戻す
            </button>
          </div>
        </div>
      )}

      {/* top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 p-3 sm:p-4">
        <button type="button" onClick={onClose} aria-label="閉じる" className="glass pointer-events-auto grid h-10 w-10 place-items-center rounded-full shadow-sm hover:scale-105">
          <X size={19} />
        </button>
        <button
          type="button"
          onClick={() => setShowHistory(!showHistory)}
          aria-label="返答履歴"
          title="AIの返答履歴"
            className="glass pointer-events-auto grid h-10 w-10 place-items-center rounded-full shadow-sm hover:scale-105"
          >
            <History size={18} />
          </button>
          <button
            type="button"
            onClick={() => setPanel(!panel)}
            aria-label="設定"
            title="キャラクター・音声設定"
            className={`glass pointer-events-auto grid h-10 w-10 place-items-center rounded-full shadow-sm hover:scale-105 ${panel ? "!bg-pink-500 !text-white" : ""}`}
          >
            <SlidersHorizontal size={18} />
          </button>
      </div>

      {/* history */}
      {showHistory && (
        <div className="glass absolute right-3 top-[68px] z-10 max-h-[60vh] w-[min(360px,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl p-2 shadow-xl sm:right-4">
          <div className="flex items-center justify-between px-2 py-1.5 text-xs font-bold">
            <span>AIの返答履歴</span>
            {history.length > 0 && (
              <button type="button" onClick={() => setHistory([])} className="flex items-center gap-1 opacity-60 hover:opacity-100">
                <Trash2 size={12} /> クリア
              </button>
            )}
          </div>
          {history.length === 0 && <div className="px-2 py-6 text-center text-xs opacity-60">まだ返答がありません</div>}
          {history.map((h) => (
            <button key={h.id} type="button" onClick={() => speak(h.text)} className="flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left text-sm hover:bg-black/5">
              <Play size={13} className="mt-1 shrink-0 text-pink-500" />
              <span className="line-clamp-2">{h.text}</span>
            </button>
          ))}
        </div>
      )}

      {/* settings panel */}
      {panel && (
        <div className="glass absolute inset-x-3 bottom-3 top-[68px] z-20 overflow-y-auto rounded-3xl p-4 shadow-2xl sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[360px]">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold">設定</h2>
            <button type="button" onClick={() => setPanel(false)} aria-label="閉じる" className="opacity-60 hover:opacity-100">
              <X size={18} />
            </button>
          </div>

          <section className="mb-5">
            <div className={`mb-2 text-xs font-semibold ${label}`}>キャラクター (3Dモデル)</div>
            <div className="space-y-1.5">
              {[{ id: "default", name: DEFAULT_MODEL.name }, ...customs].map((m) => (
                <div
                  key={m.id}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${prefs.modelId === m.id ? on : off}`}
                >
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => update({ modelId: m.id })}>
                    {prefs.modelId === m.id ? <Check size={14} /> : <Sparkles size={14} className="opacity-50" />}
                    <span className="truncate">{m.name}</span>
                  </button>
                  {m.id !== "default" && (
                    <button type="button" aria-label="削除" onClick={() => removeModel(m.id)} className="opacity-50 hover:text-red-500 hover:opacity-100">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".vrm,.glb,.pmx,.pmd,.zip"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadModel(f);
                e.target.value = "";
              }}
            />
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) uploadModel(f);
              }}
              className="mt-2 rounded-xl border border-dashed border-pink-400/60"
            >
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex w-full items-center justify-center gap-2 py-2.5 text-sm font-medium text-pink-500 hover:bg-pink-500/10"
              >
                <Upload size={15} /> VRM / GLB / MMD ZIP を読み込む
              </button>
              <div className="pb-2 text-center text-[10px] opacity-55"></div>
            </div>
            {uploadErr && <p className="mt-1.5 text-xs text-red-500">{uploadErr}</p>}
            {info && (
              <p className={`mt-2 text-[11px] leading-relaxed ${label}`}>
              </p>
            )}
          </section>

          <section className="mb-5 space-y-3">
            <div className={`text-xs font-semibold ${label}`}>音声</div>
            <div className="flex flex-wrap gap-1.5">
              {LANGS.map((l) => (
                <button key={l.id} type="button" onClick={() => update({ lang: l.id })} className={`${panelBtn} ${prefs.lang === l.id ? on : off}`}>
                  {l.label}
                </button>
              ))}
            </div>
            <select
              value={selectedVoice?.voiceURI || ""}
              onChange={(e) => update({ voiceURI: e.target.value })}
              className={`h-10 w-full rounded-xl border px-3 text-sm outline-none ${night ? "border-white/10 bg-white/10" : "border-black/10 bg-white/70"}`}
            >
              {voicesForLang.length === 0 && <option value="">音声が見つかりません</option>}
              {voicesForLang.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI} className="text-black">
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
            {(
              [
                ["rate", "速度", 0.5, 2, 0.05],
                ["pitch", "ピッチ", 0, 2, 0.05],
                ["volume", "音量", 0, 1, 0.05],
              ] as const
            ).map(([k, name, min, max, step]) => (
              <label key={k} className="flex items-center gap-3 text-sm">
                <span className="w-14 shrink-0">{name}</span>
                <input type="range" min={min} max={max} step={step} value={prefs[k]} onChange={(e) => update({ [k]: Number(e.target.value) } as Partial<Prefs>)} className="flex-1" />
                <span className="w-9 text-right text-xs tabular-nums opacity-70">{prefs[k].toFixed(2)}</span>
              </label>
            ))}
            <button type="button" onClick={testVoice} className="flex items-center gap-1.5 rounded-full bg-pink-500 px-4 py-2 text-sm font-semibold text-white hover:bg-pink-600">
              <Volume2 size={15} /> テスト再生
            </button>
          </section>

          <section className="mb-5">
            <div className={`mb-2 text-xs font-semibold ${label}`}>表情</div>
            <div className="flex flex-wrap gap-1.5">
              {EMOTIONS.map((e) => (
                <button key={e.id} type="button" onClick={() => update({ emotion: e.id })} className={`${panelBtn} ${prefs.emotion === e.id ? on : off}`}>
                  {e.label}
                </button>
              ))}
            </div>
            <div className={`mb-2 mt-4 text-xs font-semibold ${label}`}>ジェスチャー</div>
            <div className="flex flex-wrap gap-1.5">
              {GESTURES.map((g) => (
                <button key={g.id} type="button" onClick={() => fireGesture(g.id)} className={`${panelBtn} ${off}`}>
                  {g.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className={`mb-2 flex items-center gap-1.5 text-xs font-semibold ${label}`}>
              <Camera size={13} /> カメラ
            </div>
            <div className="flex gap-1.5">
              {(
                [
                  ["bust", "アップ"],
                  ["face", "顔アップ"],
                  ["full", "全身"],
                ] as const
              ).map(([id, name]) => (
                <button key={id} type="button" onClick={() => update({ camera: id })} className={`${panelBtn} ${prefs.camera === id ? on : off}`}>
                  {name}
                </button>
              ))}
            </div>
          </section>
          {saved && null}
        </div>
      )}

      {/* bottom: subtitle + input */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 p-3 pb-5 sm:p-5">
        {error && (
          <div className="pointer-events-auto flex max-w-[720px] items-start gap-2 rounded-2xl bg-red-500/90 px-4 py-2.5 text-sm text-white shadow-lg">
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError("")} aria-label="閉じる">
              <X size={15} />
            </button>
          </div>
        )}

        <div className="pointer-events-auto flex w-full max-w-[720px] items-center gap-2.5">
          <div className="relative grid h-14 w-14 shrink-0 place-items-center">
            <div ref={ring} className={`absolute inset-0 rounded-full transition-transform duration-75 ${micOn ? "bg-emerald-400/30" : "bg-transparent"}`} />
            <button
              type="button"
              onClick={toggleMic}
              aria-label={micOn ? "マイクをオフ" : "マイクをオン"}
              title={sttOk ? (micOn ? "マイクをオフ" : "マイクで話しかける") : "このブラウザは音声認識に未対応です"}
              className={`relative grid h-12 w-12 place-items-center rounded-full text-white shadow-lg transition hover:scale-105 ${
                micOn ? "bg-emerald-500" : sttOk ? "bg-gradient-to-br from-pink-500 to-violet-500" : "bg-slate-400"
              }`}
            >
              {micOn ? <Mic size={21} /> : <MicOff size={21} />}
            </button>
          </div>
          <form
            className="glass flex h-14 min-w-0 flex-1 items-center gap-2 rounded-full pl-5 pr-2 shadow-lg"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              value={interim && !text ? interim : text}
              onChange={(e) => setText(e.target.value)}
              placeholder="AIに話しかける…"
              className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:opacity-50"
              autoFocus
              aria-label="AIに送るメッセージ"
            />
            {phase === "speaking" || phase === "thinking" ? (
              <button type="button" onClick={stopAll} aria-label="停止" className="grid h-10 w-10 place-items-center rounded-full bg-slate-800 text-white">
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!text.trim() || !ttsOk}
                aria-label="AIに送信"
                className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-pink-500 to-violet-500 text-white transition disabled:opacity-40"
              >
                <SendHorizontal size={18} />
              </button>
            )}
          </form>
        </div>
        {!ttsOk && <div className="pointer-events-auto rounded-xl bg-amber-500/90 px-3 py-1.5 text-xs text-white">このブラウザは音声合成に未対応です</div>}
      </div>
    </div>
  );
}

/* ==================================================================
   LimeAI 拡張: アシスタント専用の通話モード (PC・タブレット・モバイル対応)
   ================================================================== */

/**
 * アシスタントを選んだチャットから発信できる「電話」風のボイスモード。
 * 既存の VoiceMode(3Dアバター)とは独立していて、ChatPage からPC・タブレット・モバイルで起動される。
 * 呼び出し中 → 接続(タイマー開始・挨拶) → 聞く → 考える → 話す → 聞く … をハンズフリーで繰り返す。
 */

type CallPhase = 'connecting' | 'listening' | 'thinking' | 'speaking'

type AssistantCallProps = {
  assistant: AssistantItem
  avatars: AvatarMap
  onClose: () => void
  /** ユーザーの発話をAIへ送り、返答テキスト(Markdown可)を返す。ChatPage 側でキャラクター設定つきで LimeAI へ問い合わせる */
  onAsk: (text: string, signal: AbortSignal) => Promise<string>
}

const CALL_STYLES = `
.lime-call {
  --call-green-top: #6fae99;
  --call-green-mid: #347d65;
  --call-green-bottom: #18543f;
  --call-control: rgba(255,255,255,.15);
  --call-control-hover: rgba(255,255,255,.22);
  --call-border: rgba(255,255,255,.14);
  position: fixed;
  inset: 0;
  z-index: 9999;
  overflow: hidden;
  color: #fff;
  background:
    radial-gradient(90% 42% at 50% 0%, rgba(198,237,221,.22) 0%, rgba(198,237,221,0) 70%),
    linear-gradient(180deg, var(--call-green-top) 0%, var(--call-green-mid) 36%, #286e58 68%, var(--call-green-bottom) 100%);
  font-family: 'Zen Kaku Gothic New', 'Hiragino Kaku Gothic ProN', system-ui, sans-serif;
  -webkit-user-select: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.lime-call::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(255,255,255,.035) 0%, rgba(255,255,255,0) 18%, rgba(0,0,0,.06) 100%);
}
.lime-call-shell {
  position: relative;
  z-index: 1;
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 100dvh;
  flex-direction: column;
  align-items: center;
}
.lime-call-topbar {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: flex-end;
  padding: max(18px, env(safe-area-inset-top)) 24px 0;
}
.lime-call-mobile-toggle {
  display: none;
  width: 42px;
  height: 42px;
  place-items: center;
  border: 1px solid rgba(255,255,255,.13);
  border-radius: 999px;
  background: rgba(255,255,255,.11);
  color: rgba(255,255,255,.92);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 8px 24px rgba(0,0,0,.08), inset 0 1px 0 rgba(255,255,255,.05);
}
.lime-call-mobile-toggle:active { transform: scale(.96); }
.lime-call-topbar-btn {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border: 1px solid rgba(255,255,255,.13);
  border-radius: 999px;
  background: rgba(255,255,255,.11);
  color: rgba(255,255,255,.92);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 8px 24px rgba(0,0,0,.08), inset 0 1px 0 rgba(255,255,255,.05);
}
.lime-call-topbar-btn:active { transform: scale(.96); }
.lime-call-person {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 34px;
}
.lime-call-avatar {
  display: grid;
  width: 68px;
  height: 68px;
  place-items: center;
  border: 0;
  border-radius: 22px;
  background: rgba(63,151,119,.88);
  color: #fff;
  font-size: 34px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.14), 0 14px 30px rgba(0,0,0,.10);
}
.lime-call-avatar.speaking {
  box-shadow: inset 0 1px 0 rgba(255,255,255,.14), 0 0 0 3px rgba(255,255,255,.10), 0 14px 30px rgba(0,0,0,.10);
}
.lime-call-name {
  margin-top: 9px;
  max-width: min(70vw, 320px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: .01em;
}
.lime-call-timer {
  margin-top: 25px;
  font-size: 29px;
  font-weight: 400;
  line-height: 1;
  letter-spacing: .015em;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 10px rgba(0,0,0,.08);
}
.lime-call-timer.connecting {
  font-size: 18px;
  margin-top: 27px;
  opacity: .9;
}
.lime-call-spacer {
  flex: 1;
  min-height: 180px;
}
.lime-call-error {
  width: min(86vw, 440px);
  margin: 0 auto 18px;
  border: 1px solid rgba(255,255,255,.14);
  border-radius: 18px;
  background: rgba(0,0,0,.18);
  padding: 10px 14px;
  color: rgba(255,255,255,.92);
  font-size: 13px;
  line-height: 1.55;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
.lime-call-controls {
  display: grid;
  width: min(100%, 430px);
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: start;
  justify-items: center;
  gap: 12px;
  padding: 0 22px max(34px, env(safe-area-inset-bottom));
}
.lime-call-control {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.lime-call-btn {
  display: grid;
  width: 78px;
  height: 78px;
  place-items: center;
  border: 1px solid var(--call-border);
  border-radius: 999px;
  background: var(--call-control);
  color: #fff;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.05), 0 10px 24px rgba(0,0,0,.10);
  transition: background-color .15s ease, transform .12s ease;
}
.lime-call-btn:hover { background: var(--call-control-hover); }
.lime-call-btn:active { transform: scale(.96); }
.lime-call-btn.danger {
  border-color: rgba(255,97,75,.10);
  background: #e3422d;
  box-shadow: 0 12px 26px rgba(124,31,22,.22);
}
.lime-call-btn.danger:hover { background: #ec4933; }
.lime-call-btn.active { background: rgba(255,255,255,.24); }
.lime-call-control-label {
  max-width: 110px;
  text-align: center;
  font-size: 12px;
  line-height: 1.25;
  color: rgba(255,255,255,.92);
  overflow-wrap: anywhere;
}
/* モバイルだけ: 通話画面を上部の通話中バーへ縮小する。PCには表示しない。 */
.lime-call.compact {
  inset: 0;
  background: transparent;
  pointer-events: none;
}
.lime-call.compact .lime-call-shell {
  pointer-events: none;
}
.lime-call.compact .lime-call-compact-bar {
  pointer-events: auto;
}
.lime-call-compact-bar {
  position: fixed;
  top: max(8px, env(safe-area-inset-top));
  left: 50%;
  z-index: 10000;
  display: flex;
  width: calc(100% - 16px);
  max-width: 520px;
  min-height: 68px;
  transform: translateX(-50%);
  align-items: center;
  gap: 10px;
  padding: 9px 10px 9px 12px;
  border: 1px solid rgba(255,255,255,.13);
  border-radius: 18px;
  background: rgba(30,73,59,.96);
  color: #fff;
  cursor: pointer;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
.lime-call-compact-avatar {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  place-items: center;
  border-radius: 14px;
  background: rgba(255,255,255,.11);
  font-size: 22px;
}
.lime-call-compact-main {
  min-width: 0;
  flex: 1;
  text-align: left;
}
.lime-call-compact-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 600;
}
.lime-call-compact-status {
  margin-top: 3px;
  display: flex;
  align-items: baseline;
  gap: 8px;
  color: rgba(255,255,255,.68);
  font-size: 12px;
}
.lime-call-compact-time {
  color: rgba(255,255,255,.9);
  font-variant-numeric: tabular-nums;
}
.lime-call-compact-toggle {
  display: grid;
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  place-items: center;
  border: 1px solid rgba(255,255,255,.13);
  border-radius: 999px;
  background: rgba(255,255,255,.11);
  color: rgba(255,255,255,.92);
}

@media (max-width: 700px) {
  .lime-call-topbar { padding-right: 16px; }
  .lime-call-mobile-toggle { display: grid; }
  .lime-call-person { padding-top: 26px; }
  .lime-call-avatar { width: 62px; height: 62px; border-radius: 20px; font-size: 31px; }
  .lime-call-timer { margin-top: 22px; font-size: 27px; }
  .lime-call-spacer { min-height: 120px; }
  .lime-call-controls { padding-left: 14px; padding-right: 14px; padding-bottom: max(26px, env(safe-area-inset-bottom)); }
  .lime-call-btn { width: 74px; height: 74px; }
}
@media (prefers-reduced-motion: reduce) {
  .lime-call, .lime-call * { transition: none !important; animation: none !important; }
}
/* ---- 丸いアイコン画像 / 呼び出し中の演出 ---- */
.lime-call-avatar {
  width: 92px;
  height: 92px;
  padding: 0;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255,255,255,.18);
  box-shadow: 0 0 0 3px rgba(255,255,255,.18), 0 14px 30px rgba(0,0,0,.14);
}
.lime-call-avatar img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 999px;
}
.lime-call-avatar.speaking {
  box-shadow: 0 0 0 4px rgba(255,255,255,.28), 0 0 0 10px rgba(255,255,255,.10), 0 14px 30px rgba(0,0,0,.14);
}
.lime-call-avatar.ringing { animation: limeCallRing 1.6s ease-out infinite; }
@keyframes limeCallRing {
  0% { box-shadow: 0 0 0 0 rgba(255,255,255,.35), 0 14px 30px rgba(0,0,0,.14); }
  100% { box-shadow: 0 0 0 26px rgba(255,255,255,0), 0 14px 30px rgba(0,0,0,.14); }
}
.lime-call-compact-avatar { overflow: hidden; padding: 0; border-radius: 999px; }
.lime-call-compact-avatar img { display: block; width: 100%; height: 100%; object-fit: cover; border-radius: 999px; }
@media (max-width: 700px) {
  .lime-call-avatar { width: 84px; height: 84px; border-radius: 999px; }
}
`

const formatCallTime = (total: number) => `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`

function CallButton({
  label,
  active,
  danger,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  danger?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <div className="lime-call-control">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        className={`lime-call-btn ${danger ? 'danger' : active ? 'active' : ''}`}
      >
        {children}
      </button>
      <span className="lime-call-control-label">{label}</span>
    </div>
  )
}

/** 呼び出し音(プルルル…)。日本の電話の呼び出し音に近い「400Hzを15Hzで変調、1秒鳴って2秒休む」をWeb Audioで合成 */
class RingTone {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private timer: number | null = null
  private volume = 0.15

  start(volume = 0.15) {
    this.stop()
    this.volume = volume
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      ctx.resume().catch(() => {})
      const carrier = ctx.createOscillator()
      carrier.type = 'sine'
      carrier.frequency.value = 400
      const am = ctx.createGain()
      am.gain.value = 0.5
      const lfo = ctx.createOscillator()
      lfo.frequency.value = 15
      const depth = ctx.createGain()
      depth.gain.value = 0.5
      lfo.connect(depth)
      depth.connect(am.gain)
      const master = ctx.createGain()
      master.gain.value = 0
      carrier.connect(am)
      am.connect(master)
      master.connect(ctx.destination)
      carrier.start()
      lfo.start()
      this.ctx = ctx
      this.master = master

      const burst = () => {
        const t = ctx.currentTime
        master.gain.cancelScheduledValues(t)
        master.gain.setValueAtTime(0, t)
        master.gain.linearRampToValueAtTime(this.volume, t + 0.04)
        master.gain.setValueAtTime(this.volume, t + 0.96)
        master.gain.linearRampToValueAtTime(0, t + 1.0)
      }
      burst()
      this.timer = window.setInterval(burst, 3000)
    } catch {
      /* 音を出せない環境では無音のまま待つ */
    }
  }

  private halt() {
    if (this.timer !== null) {
      window.clearInterval(this.timer)
      this.timer = null
    }
    if (this.ctx && this.master) {
      const t = this.ctx.currentTime
      this.master.gain.cancelScheduledValues(t)
      this.master.gain.setValueAtTime(0, t)
    }
  }

  /** 呼び出し音を止め、受話器を取る「カチャッ」という音を鳴らす */
  pickup() {
    this.halt()
    const ctx = this.ctx
    if (!ctx) return
    try {
      const len = Math.floor(ctx.sampleRate * 0.06)
      const buf = ctx.createBuffer(1, len, ctx.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3)
      const src = ctx.createBufferSource()
      src.buffer = buf
      const g = ctx.createGain()
      g.gain.value = 0.25
      src.connect(g)
      g.connect(ctx.destination)
      src.start()
    } catch {
      /* ignore */
    }
    window.setTimeout(() => this.stop(), 300)
  }

  stop() {
    this.halt()
    const ctx = this.ctx
    this.ctx = null
    this.master = null
    ctx?.close().catch(() => {})
  }
}

const MALE_VOICE = /(ichiro|takumi|keita|otoya|daichi|hiroshi|male|男|david|mark|james|guy|daniel|alex|fred)/i
const FEMALE_VOICE = /(nanami|haruka|ayumi|kyoko|o-ren|sayaka|female|女|xiaoxiao|yuna|aria|jenny|samantha|zira|emma|karen|victoria)/i

/** キャラクターの性別に合う声を優先して選ぶ(見つからなければ通常の選び方) */
function pickCharacterVoice(voices: SpeechSynthesisVoice[], lang: string, gender?: 'female' | 'male') {
  const prefix = lang.split('-')[0].toLowerCase()
  const cands = voices.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(prefix))
  if (gender && cands.length) {
    const re = gender === 'male' ? MALE_VOICE : FEMALE_VOICE
    const hit = cands.filter((v) => re.test(v.name))
    if (hit.length) {
      const q = (v: SpeechSynthesisVoice) => (/(natural|online|neural)/i.test(v.name) ? 1 : 0)
      return hit.sort((a, b) => q(b) - q(a))[0]
    }
  }
  return pickVoice(voices, lang, '')
}

function AssistantCall({ assistant, avatars, onClose, onAsk }: AssistantCallProps) {
  const [phase, setPhase] = useState<CallPhase>('connecting')
  const phaseRef = useRef<CallPhase>('connecting')
  const [connected, setConnected] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [muted, setMuted] = useState(false)
  const mutedRef = useRef(false)
  const [speakerOn, setSpeakerOn] = useState(true)
  const speakerRef = useRef(true)
  const [compactOnMobile, setCompactOnMobile] = useState(false)
  const [error, setError] = useState('')
  const speaker = useRef(new Speaker())
  const listener = useRef(new Listener())
  const ring = useRef(new RingTone())
  const abortAI = useRef<AbortController | null>(null)
  const voicesRef = useRef<SpeechSynthesisVoice[]>([])
  const aliveRef = useRef(true)
  const startListenRef = useRef<() => void>(() => {})
  const onAskRef = useRef(onAsk)
  onAskRef.current = onAsk
  const assistantRef = useRef(assistant)
  assistantRef.current = assistant

  const setPhaseBoth = (p: CallPhase) => {
    phaseRef.current = p
    setPhase(p)
  }

  /* ---------- 聞く ---------- */
  const handleUserTextRef = useRef<(text: string) => void>(() => {})

  const startListen = useCallback(() => {
    if (!aliveRef.current || mutedRef.current) return
    if (phaseRef.current === 'speaking' || phaseRef.current === 'thinking') return
    if (!sttSupported()) {
      setError(MIC_ERRORS.unsupported)
      mutedRef.current = true
      setMuted(true)
      return
    }
    setPhaseBoth('listening')
    const lang = assistantRef.current.lang ?? 'ja-JP'
    listener.current.start(lang, {
      onInterim: () => {},
      onFinal: (t) => {
        handleUserTextRef.current(t)
      },
      onEnd: () => {
        if (!aliveRef.current || mutedRef.current) return
        if (phaseRef.current === 'listening') setTimeout(() => startListenRef.current(), 250)
      },
      onError: (code) => {
        if (code === 'no-speech' || code === 'aborted') return
        setError(MIC_ERRORS[code] || `音声認識エラー: ${code}`)
        if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture' || code === 'unsupported') {
          mutedRef.current = true
          setMuted(true)
        }
      },
    })
  }, [])
  startListenRef.current = startListen

  const resumeListening = useCallback(() => {
    if (!aliveRef.current) return
    setPhaseBoth('listening')
    setTimeout(() => startListenRef.current(), 300)
  }, [])

  /* ---------- 話す ---------- */
  const speak = useCallback(
    (raw: string) => {
      const t = raw.trim()
      if (!t) {
        resumeListening()
        return
      }
      listener.current.abort()
      const a = assistantRef.current
      const lang = detectTtsLang(t)
      const pool = voicesRef.current.length ? voicesRef.current : ttsSupported() ? speechSynthesis.getVoices() : []
      const voice = pickCharacterVoice(pool, lang, a.gender)
      setPhaseBoth('speaking')
      speaker.current.speak(
        t,
        {
          voiceURI: voice?.voiceURI,
          lang,
          rate: a.rate ?? 1,
          pitch: a.pitch ?? (a.gender === 'male' ? 0.85 : 1.08),
          volume: speakerRef.current ? 1 : 0.7,
        },
        {
          onEnd: resumeListening,
          onError: (m) => {
            setError(m)
            resumeListening()
          },
        },
      )
    },
    [resumeListening],
  )

  /* ---------- AIへ問い合わせ ---------- */
  const handleUserText = useCallback(
    async (text: string) => {
      const s = text.trim()
      if (!s || !aliveRef.current) return
      speaker.current.cancel()
      abortAI.current?.abort()
      listener.current.abort()
      setError('')
      setPhaseBoth('thinking')
      const ac = new AbortController()
      abortAI.current = ac
      let reply = ''
      try {
        reply = await onAskRef.current(s, ac.signal)
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (abortAI.current === ac) abortAI.current = null
      }
      if (!aliveRef.current || ac.signal.aborted) return
      const spokenReply = stripMarkdown(reply)
      if (spokenReply) speak(spokenReply)
      else resumeListening()
    },
    [speak, resumeListening],
  )
  handleUserTextRef.current = handleUserText

  /* ---------- 発信(呼び出し音) → 相手が電話に出る → 第一声 ---------- */
  useEffect(() => {
    aliveRef.current = true
    getVoices().then((v) => {
      voicesRef.current = v
    })

    let wake: { release: () => Promise<void> } | null = null
    try {
      const nav = navigator as unknown as { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } }
      nav.wakeLock?.request('screen').then((w) => { wake = w }).catch(() => {})
    } catch {
      /* ignore */
    }

    // 呼び出し音を2〜3回鳴らしてから、少し間をおいて相手が電話に出る
    const tone = ring.current
    tone.start(speakerRef.current ? 0.16 : 0.07)
    const rings = 2 + Math.floor(Math.random() * 2)
    const pickupDelay = (rings - 1) * 3000 + 1300 + Math.random() * 700
    let greetTimer: ReturnType<typeof setTimeout> | null = null

    const connectTimer = setTimeout(() => {
      if (!aliveRef.current) return
      tone.pickup()
      setConnected(true)
      // 受話器を取ってから、ひと呼吸おいて第一声
      greetTimer = setTimeout(() => {
        if (!aliveRef.current) return
        speak(greetingOf(assistantRef.current))
      }, 800 + Math.random() * 500)
    }, pickupDelay)

    const sp = speaker.current
    const ls = listener.current
    return () => {
      aliveRef.current = false
      clearTimeout(connectTimer)
      if (greetTimer) clearTimeout(greetTimer)
      tone.stop()
      sp.cancel()
      ls.abort()
      abortAI.current?.abort()
      try {
        wake?.release().catch(() => {})
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!connected) return
    const timer = setInterval(() => setSeconds((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [connected])

  const endCall = () => {
    aliveRef.current = false
    ring.current.stop()
    speaker.current.cancel()
    listener.current.abort()
    abortAI.current?.abort()
    onClose()
  }

  const toggleMute = () => {
    const next = !mutedRef.current
    mutedRef.current = next
    setMuted(next)
    if (next) {
      listener.current.abort()
    } else {
      setError('')
      if (phaseRef.current === 'listening') startListenRef.current()
    }
  }

  const toggleSpeaker = () => {
    const next = !speakerRef.current
    speakerRef.current = next
    setSpeakerOn(next)
  }

  const interrupt = () => {
    if (phaseRef.current !== 'speaking' && phaseRef.current !== 'thinking') return
    speaker.current.cancel()
    abortAI.current?.abort()
    abortAI.current = null
    resumeListening()
  }

  const toggleCompactOnMobile = () => {
    if (typeof window === 'undefined' || window.innerWidth > 700) return
    setCompactOnMobile((value) => !value)
  }

  const avatarSrc = avatarOf(assistant, avatars)

  return createPortal(
    <div
      className={`lime-call ${compactOnMobile ? 'compact' : ''}`}
      role="dialog"
      aria-label={`${assistant.name}との通話`}
    >
      <style>{CALL_STYLES}</style>

      {compactOnMobile ? (
        <button
          type="button"
          className="lime-call-compact-bar"
          onClick={() => setCompactOnMobile(false)}
          aria-label={`${assistant.name}との通話を展開`}
          title="通話画面を展開"
        >
          <span className="lime-call-compact-avatar" aria-hidden="true">
            <img src={avatarSrc} alt="" />
          </span>
          <span className="lime-call-compact-main">
            <span className="lime-call-compact-name">{assistant.name}</span>
            <span className="lime-call-compact-status">
              <span>{connected ? '通話中' : '呼び出し中'}</span>
              <span className="lime-call-compact-time">{connected ? formatCallTime(seconds) : '…'}</span>
            </span>
          </span>
          <span
            className="lime-call-compact-toggle"
            onClick={(e) => {
              e.stopPropagation()
              setCompactOnMobile(false)
            }}
            aria-hidden="true"
          >
            <Maximize2 size={16} strokeWidth={2.1} />
          </span>
        </button>
      ) : (
      <div className="lime-call-shell">
        <div className="lime-call-topbar">
          <button
            type="button"
            className="lime-call-mobile-toggle"
            onClick={toggleCompactOnMobile}
            aria-label="通話画面を縮小して上部バーにする"
            title="通話画面を縮小"
          >
            <Minimize2 size={17} strokeWidth={2.1} />
          </button>
        </div>

        <div className="lime-call-person">
          <button
            type="button"
            onClick={interrupt}
            aria-label="話を遮る"
            className={`lime-call-avatar ${phase === 'speaking' ? 'speaking' : ''} ${connected ? '' : 'ringing'}`}
            title={phase === 'speaking' ? '相手の発話を止めて聞き取る' : '通話'}
          >
            <img src={avatarSrc} alt={assistant.name} draggable={false} />
          </button>
          <div className="lime-call-name">{assistant.name}</div>
          <div className={`lime-call-timer ${connected ? '' : 'connecting'}`}>
            {connected ? formatCallTime(seconds) : '呼び出し中…'}
          </div>
        </div>

        <div className="lime-call-spacer" aria-hidden="true" />

        {error && (
          <div className="lime-call-error" role="alert">
            <div className="flex items-start gap-2">
              <span className="flex-1 break-words">{error}</span>
              <button type="button" onClick={() => setError('')} aria-label="閉じる" className="shrink-0 opacity-70">
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        <div className="lime-call-controls">
          <CallButton label="スピーカー" active={speakerOn} onClick={toggleSpeaker}>
            {speakerOn ? <Volume2 size={29} strokeWidth={2.2} /> : <VolumeX size={29} strokeWidth={2.2} />}
          </CallButton>
          <CallButton label="終了" danger onClick={endCall}>
            <Phone size={30} strokeWidth={2.2} className="rotate-[135deg]" fill="currentColor" />
          </CallButton>
          <CallButton label="ミュート" active={muted} onClick={toggleMute}>
            {muted ? <MicOff size={29} strokeWidth={2.2} /> : <Mic size={29} strokeWidth={2.2} />}
          </CallButton>
        </div>
      </div>
      )}
    </div>,
    document.body,
  )
}

/* ==================================================================
   ChatPage 本体
   ================================================================== */

/** true: 添付画像をGemini形式(inlineData)でそのまま送る / false: 画像はファイル名のみAIに伝える */
const SEND_IMAGE_PARTS = true

const VPOP_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@500;700;900&family=Zen+Kaku+Gothic+New:wght@400;500;700&family=Roboto+Mono:wght@400;500&display=swap');

/* ============================================================
   炉なる世界観トークン
   🩶 シルバーグレーが主役 / 🩵 ライトブルーは差し色
   ============================================================ */
.vpop-root {
  --nr-silver-0: #fbfbfc;
  --nr-silver-1: #f3f4f6;
  --nr-silver-2: #e8eaee;
  --nr-silver-3: #d9dde3;
  --nr-ink:      #333a42;
  --nr-ink-sub:  #69707a;
  --nr-ink-mute: #98a0aa;
  --nr-blue:     #4fb3e8;
  --nr-blue-deep:#3aa5e0;
  --nr-blue-soft:#86c9ee;
  --nr-blue-pale:#dceef9;
  --nr-glow:     rgba(79,179,232,.32);
  --nr-shadow-s: 0 2px 6px -2px rgba(90,105,125,.18);
  --nr-shadow-m: 0 10px 26px -14px rgba(90,105,125,.45);
  --nr-shadow-glow: 0 10px 30px -12px rgba(79,179,232,.55);

  font-family: 'Zen Kaku Gothic New', 'Hiragino Kaku Gothic ProN', system-ui, sans-serif;
  color: var(--nr-ink);
  letter-spacing: .01em;
  background:
    radial-gradient(120% 80% at 14% -10%, #ffffff 0%, rgba(255,255,255,0) 58%),
    radial-gradient(90% 70% at 88% 110%, rgba(79,179,232,.10) 0%, rgba(255,255,255,0) 60%),
    linear-gradient(168deg, #fafbfc 0%, #eef0f3 46%, #f5f6f8 100%);
}
.dark .vpop-root {
  --nr-silver-0: #12161b;
  --nr-silver-1: #171c22;
  --nr-silver-2: #1e242b;
  --nr-silver-3: #2b323b;
  --nr-ink:      #e6e9ed;
  --nr-ink-sub:  #a8b0ba;
  --nr-ink-mute: #7e868f;
  --nr-blue-pale:#1d3446;
  --nr-glow:     rgba(79,179,232,.5);
  --nr-shadow-s: 0 2px 8px -2px rgba(0,0,0,.5);
  --nr-shadow-m: 0 12px 30px -16px rgba(0,0,0,.8);
  --nr-shadow-glow: 0 0 28px -6px rgba(79,179,232,.45);
  background:
    radial-gradient(110% 80% at 14% -10%, rgba(79,179,232,.16) 0%, rgba(0,0,0,0) 58%),
    radial-gradient(90% 70% at 86% 112%, rgba(79,179,232,.12) 0%, rgba(0,0,0,0) 60%),
    linear-gradient(168deg, #10151a 0%, #161d25 52%, #0d1116 100%);
}

/* ---------- 文字組み ---------- */
.vpop-root .vpop-title {
  font-family: 'Zen Maru Gothic', 'Zen Kaku Gothic New', sans-serif;
  font-weight: 900;
  letter-spacing: .04em;
  color: var(--nr-ink);
  text-shadow: 0 2px 0 rgba(255,255,255,.9), 0 10px 26px rgba(79,179,232,.28);
}
.dark .vpop-root .vpop-title { text-shadow: 0 0 22px rgba(79,179,232,.6); }
.vpop-root .vpop-round { font-family: 'Zen Maru Gothic', sans-serif; font-weight: 700; }
.vpop-root .vpop-num { font-family: 'Roboto Mono', ui-monospace, monospace; letter-spacing: .06em; font-size: .92em; }
.vpop-mark { color: var(--nr-blue-soft); font-weight: 800; font-size: .9em; vertical-align: .06em; }
.dark .vpop-mark { color: var(--nr-blue); text-shadow: 0 0 10px rgba(79,179,232,.7); }

/* ---------- 背景レイヤー ---------- */
.vpop-bg { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 0; }
.vpop-blob { position: absolute; border-radius: 9999px; filter: blur(54px); opacity: .5; }
.vpop-blob-1 { width: 44vw; height: 44vw; left: -10vw; top: -12vw; background: #dfe3e8; animation: vpopDrift 24s ease-in-out infinite; }
.vpop-blob-2 { width: 34vw; height: 34vw; right: -8vw; top: 20%; background: #cfe6f4; animation: vpopDrift 30s ease-in-out infinite reverse; }
.vpop-blob-3 { width: 32vw; height: 32vw; left: 32%; bottom: -14vw; background: #e6e9ed; animation: vpopDrift 27s ease-in-out infinite; }
.dark .vpop-blob { opacity: .22; }

/* 粒状ノイズ（配信画面のざらつき） */
.vpop-grain {
  position: absolute; inset: 0; opacity: .35; mix-blend-mode: multiply;
  background-image: radial-gradient(rgba(120,135,150,.16) .5px, transparent .6px);
  background-size: 3px 3px;
}
.dark .vpop-grain { mix-blend-mode: screen; opacity: .18; background-image: radial-gradient(rgba(180,205,225,.22) .5px, transparent .6px); }

/* 走査線 */
.vpop-scan {
  position: absolute; inset: 0;
  background: repeating-linear-gradient(to bottom, rgba(79,179,232,.05) 0 1px, transparent 1px 4px);
  opacity: .55;
}
.dark .vpop-scan { background: repeating-linear-gradient(to bottom, rgba(134,201,238,.07) 0 1px, transparent 1px 4px); }

/* 配信フレーム（四隅のトンボ付き） */
.vpop-frame {
  position: absolute; inset: 12px; border-radius: 30px;
  border: 1.5px dashed rgba(120,135,150,.22);
  box-shadow: inset 0 0 80px rgba(79,179,232,.05);
}
.dark .vpop-frame { border-color: rgba(134,201,238,.16); box-shadow: inset 0 0 90px rgba(79,179,232,.1); }
.vpop-corner { position: absolute; width: 22px; height: 22px; border: 2px solid var(--nr-blue-soft); opacity: .55; }
.vpop-corner-tl { left: 18px; top: 18px; border-right: 0; border-bottom: 0; border-radius: 10px 0 0 0; }
.vpop-corner-tr { right: 18px; top: 18px; border-left: 0; border-bottom: 0; border-radius: 0 10px 0 0; }
.vpop-corner-bl { left: 18px; bottom: 18px; border-right: 0; border-top: 0; border-radius: 0 0 0 10px; }
.vpop-corner-br { right: 18px; bottom: 18px; border-left: 0; border-top: 0; border-radius: 0 0 10px 0; }

.vpop-float {
  position: absolute; font-size: 19px; color: rgba(79,179,232,.42);
  font-family: 'Zen Maru Gothic', sans-serif; font-weight: 700;
  animation: vpopFloat 10s ease-in-out infinite;
}
.dark .vpop-float { color: rgba(134,201,238,.5); text-shadow: 0 0 12px rgba(79,179,232,.7); }

.vpop-root > *:not(.vpop-bg) { position: relative; z-index: 1; }

/* ---------- 立ち絵スタンディ ---------- */
.vpop-standee { position: relative; display: inline-flex; }
.vpop-standee::after {
  content: ''; position: absolute; left: 50%; bottom: -16px; translate: -50% 0;
  width: 92px; height: 14px; border-radius: 9999px;
  background: radial-gradient(closest-side, rgba(79,179,232,.28), rgba(79,179,232,0));
  animation: vpopShadow 3.4s ease-in-out infinite;
}
.vpop-mascot {
  animation: vpopBob 3.4s ease-in-out infinite;
  box-shadow: var(--nr-shadow-glow), inset 0 0 0 4px rgba(255,255,255,.6);
}
.dark .vpop-mascot { box-shadow: var(--nr-shadow-glow), inset 0 0 0 4px rgba(79,179,232,.15); }
.vpop-live {
  position: absolute; right: -16px; bottom: -4px;
  font-family: 'Roboto Mono', monospace;
  font-size: 10px; font-weight: 700; letter-spacing: .14em;
  padding: 3px 10px; border-radius: 9999px;
  background: var(--nr-blue); color: #ffffff;
  box-shadow: 0 6px 16px rgba(79,179,232,.5);
  animation: vpopPulse 2.2s ease-in-out infinite;
}

/* 挨拶コピー */
.vpop-greet { font-family: 'Zen Maru Gothic', sans-serif; font-weight: 700; color: var(--nr-ink-sub); }
.vpop-greet-strong { color: var(--nr-blue-deep); }
.dark .vpop-greet-strong { color: var(--nr-blue-soft); }

/* サジェストチップ */
.vpop-chip {
  font-family: 'Zen Maru Gothic', sans-serif; font-weight: 700; font-size: 13px;
  padding: 8px 14px; border-radius: 9999px;
  background: rgba(255,255,255,.85); color: var(--nr-ink-sub);
  border: 1.5px solid var(--nr-silver-3);
  box-shadow: var(--nr-shadow-s);
}
.vpop-chip:hover { border-color: var(--nr-blue-soft); color: var(--nr-blue-deep); box-shadow: var(--nr-shadow-glow); }
.dark .vpop-chip { background: rgba(30,36,43,.8); border-color: var(--nr-silver-3); }
.dark .vpop-chip:hover { color: var(--nr-blue-soft); }

/* ---------- モーション ---------- */
.vpop-in { animation: vpopIn .42s cubic-bezier(.22,.9,.28,1.3) both; }
.vpop-card { will-change: transform; }
.vpop-card:hover { transform: translateY(-2px); }
.vpop-root button { transition: transform .16s cubic-bezier(.2,.8,.3,1.2), background-color .2s, color .2s, box-shadow .2s, border-color .2s; }
.vpop-root button:hover { transform: translateY(-1px); }
.vpop-root button:active { transform: scale(.94); }

.vpop-root .custom-scrollbar::-webkit-scrollbar { width: 8px; }
.vpop-root .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(120,135,150,.28); border-radius: 9999px; }
.vpop-root .custom-scrollbar:hover::-webkit-scrollbar-thumb { background: rgba(79,179,232,.45); }

/* 入力欄：呼吸する水色の光 */
.vpop-root .vpop-composer { box-shadow: var(--nr-shadow-m); }
.vpop-root .vpop-composer:focus-within {
  border-color: var(--nr-blue-soft);
  box-shadow: 0 0 0 4px var(--nr-glow), 0 16px 34px -18px rgba(58,165,224,.9);
}

/* 思考中：✦︎ が順に光る */
.vpop-root .vpop-thinking { animation: vpopShimmer 1.7s ease-in-out infinite; }
.vpop-spark { display: inline-block; color: var(--nr-blue); animation: vpopSpark 1.2s ease-in-out infinite; }
.vpop-spark:nth-child(2) { animation-delay: .18s; }
.vpop-spark:nth-child(3) { animation-delay: .36s; }

@keyframes vpopIn { from { opacity: 0; transform: translateY(14px) scale(.985); } to { opacity: 1; transform: none; } }
@keyframes vpopBob { 0%,100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-8px) rotate(2deg); } }
@keyframes vpopShadow { 0%,100% { opacity: .8; transform: translate(-50%,0) scaleX(1); } 50% { opacity: .45; transform: translate(-50%,0) scaleX(.8); } }
@keyframes vpopFloat { 0%,100% { transform: translateY(0) rotate(0deg); opacity: .3; } 50% { transform: translateY(-26px) rotate(12deg); opacity: .7; } }
@keyframes vpopDrift { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(4vw,3vh) scale(1.12); } }
@keyframes vpopPulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .5; transform: scale(.9); } }
@keyframes vpopShimmer { 0%,100% { opacity: 1; } 50% { opacity: .5; } }
@keyframes vpopSpark { 0%,100% { opacity: .25; transform: scale(.85); } 50% { opacity: 1; transform: scale(1.15); } }

@media (prefers-reduced-motion: reduce) {
  .vpop-root *, .vpop-root *::before, .vpop-root *::after { animation: none !important; transition: none !important; }
}
`


type ReferencedPost = {
  id: string
  authorUsername: string
  authorDisplayName: string
  authorAvatarUrl: string | null
  authorIsOfficial: boolean
  createdAt: string
  contentSnippet: string
  likesCount: number
  repostsCount: number
  commentsCount: number
  imageCount: number
  isQuote: boolean
  isReply: boolean
  isBot: boolean
  clientName: string | null
  sourceTwitter: boolean
  prefecture: string | null
  city: string | null
}

type CodingArtifact = {
  title: string
  language: 'html'
  html: string
}

type ThinkingStep = {
  label: string
  content: string
}

type ThinkingTrace = {
  summary: string
  steps?: ThinkingStep[]
  activeLabel?: string
}

type AgentAction = {
  type: 'create_post'
  content: string
  status: 'pending' | 'posting' | 'posted' | 'cancelled' | 'failed'
}

type PostLinkPreview = {
  id: string
  sourceUrl: string
  authorUsername: string
  authorDisplayName: string
  authorAvatarUrl: string | null
  authorIsOfficial: boolean
  createdAt: string
  content: string
  imageUrls: string[]
  likesCount: number
  repostsCount: number
  commentsCount: number
  visibility: 'public' | 'following' | string
}

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  references?: ReferencedPost[]
  codingArtifact?: CodingArtifact
  postPreview?: PostLinkPreview
  thinking?: ThinkingTrace
  agentAction?: AgentAction
  // --- 統合した機能 ---
  /** ユーザーが添付した画像・ファイル */
  attachments?: Attachment[]
  /** モデルの思考テキスト(reasoning) */
  reasoning?: string
  /** ツール実行ステップ(検索・ファイル作成など) */
  steps?: ToolStep[]
  /** ツールが作成したファイル(HTML/SVG/Markdown/コード) */
  artifacts?: ArtifactRecord[]
  /** Web検索などの出典 */
  sources?: Source[]
}

const getRecordString = (item: Record<string, unknown>, camelKey: string, snakeKey: string) => {
  const camelValue = item[camelKey]
  const snakeValue = item[snakeKey]

  if (typeof camelValue === 'string') return camelValue
  if (typeof snakeValue === 'string') return snakeValue

  return ''
}

const getRecordBoolean = (item: Record<string, unknown>, camelKey: string, snakeKey: string) => {
  const camelValue = item[camelKey]
  const snakeValue = item[snakeKey]

  if (typeof camelValue === 'boolean') return camelValue
  if (typeof snakeValue === 'boolean') return snakeValue

  return false
}

const getRecordNumber = (item: Record<string, unknown>, camelKey: string, snakeKey: string) => {
  const camelValue = item[camelKey]
  const snakeValue = item[snakeKey]
  const value = camelValue ?? snakeValue

  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)

    if (Number.isFinite(parsed)) return parsed
  }

  return 0
}

const getRecordNullableString = (item: Record<string, unknown>, camelKey: string, snakeKey: string) => {
  const camelValue = item[camelKey]
  const snakeValue = item[snakeKey]

  if (typeof camelValue === 'string') return camelValue
  if (typeof snakeValue === 'string') return snakeValue

  return null
}

const normalizeReferencedPost = (value: unknown): ReferencedPost | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null

  const item = value as Record<string, unknown>

  const id = getRecordString(item, 'id', 'id')
  const authorUsername = getRecordString(item, 'authorUsername', 'author_username')
  const authorDisplayName = getRecordString(item, 'authorDisplayName', 'author_display_name')
  const createdAt = getRecordString(item, 'createdAt', 'created_at')
  const contentSnippet = getRecordString(item, 'contentSnippet', 'content_snippet')

  if (!id || !createdAt || !contentSnippet) return null

  return {
    id,
    authorUsername: authorUsername || 'unknown',
    authorDisplayName: authorDisplayName || '無名',
    authorAvatarUrl: getRecordNullableString(item, 'authorAvatarUrl', 'author_avatar_url'),
    authorIsOfficial: getRecordBoolean(item, 'authorIsOfficial', 'author_is_official'),
    createdAt,
    contentSnippet,
    likesCount: getRecordNumber(item, 'likesCount', 'likes_count'),
    repostsCount: getRecordNumber(item, 'repostsCount', 'reposts_count'),
    commentsCount: getRecordNumber(item, 'commentsCount', 'comments_count'),
    imageCount: getRecordNumber(item, 'imageCount', 'image_count'),
    isQuote: getRecordBoolean(item, 'isQuote', 'is_quote'),
    isReply: getRecordBoolean(item, 'isReply', 'is_reply'),
    isBot: getRecordBoolean(item, 'isBot', 'is_bot'),
    clientName: getRecordNullableString(item, 'clientName', 'client_name'),
    sourceTwitter: getRecordBoolean(item, 'sourceTwitter', 'source_twitter'),
    prefecture: getRecordNullableString(item, 'prefecture', 'prefecture'),
    city: getRecordNullableString(item, 'city', 'city'),
  }
}

const normalizeReferencedPosts = (value: unknown) => {
  if (!Array.isArray(value)) return []

  return value
    .map(normalizeReferencedPost)
    .filter((post): post is ReferencedPost => post !== null)
}

const formatReferencedPostDate = (value: string) => {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}


const normalizeCodingArtifact = (value: unknown): CodingArtifact | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null

  const item = value as Record<string, unknown>
  const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : 'HTMLプレビュー'
  const language = item.language === 'html' ? 'html' : 'html'
  const html = typeof item.html === 'string' ? item.html : ''

  if (!html.trim()) return null

  return {
    title,
    language,
    html,
  }
}

const POST_LINK_URL_REGEX = /https?:\/\/[^\s]+/gi
const POST_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const normalizeStringArray = (value: unknown) => {
  if (!Array.isArray(value)) return []

  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
}

const extractSupportedPostLink = (text: string) => {
  const urls = text.match(POST_LINK_URL_REGEX) ?? []

  for (const rawUrl of urls) {
    const cleanedUrl = rawUrl.replace(/[)\]}>。、，．！？!?]+$/g, '')

    try {
      const url = new URL(cleanedUrl)
      const isSupportedHost =
        url.hostname === 'localhost' ||
        url.hostname === '127.0.0.1' ||
        url.hostname === 'toumeron.github.io'

      if (!isSupportedHost) continue

      const path = url.pathname.replace(/\/+/g, '/').replace(/\/$/, '')
      const match = path.match(/(?:^|\/)RaimuNoteSNS\.github\.io\/post\/([0-9a-fA-F-]{36})$|(?:^|\/)post\/([0-9a-fA-F-]{36})$/)
      const postId = match?.[1] || match?.[2] || ''

      if (!POST_ID_REGEX.test(postId)) continue

      return {
        id: postId,
        url: url.toString(),
      }
    } catch (_error) {
      // URLではない文字列は無視する
    }
  }

  return null
}

const normalizePostLinkPreview = (value: unknown): PostLinkPreview | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null

  const item = value as Record<string, unknown>
  const id = getRecordString(item, 'id', 'id')
  const sourceUrl = getRecordString(item, 'sourceUrl', 'source_url')
  const authorUsername = getRecordString(item, 'authorUsername', 'author_username')
  const authorDisplayName = getRecordString(item, 'authorDisplayName', 'author_display_name')
  const createdAt = getRecordString(item, 'createdAt', 'created_at')
  const content = getRecordString(item, 'content', 'content')
  const visibility = getRecordString(item, 'visibility', 'visibility') || 'public'

  if (!id || !sourceUrl || !createdAt || !content) return null

  const imageUrlsValue = item.imageUrls ?? item.image_urls

  return {
    id,
    sourceUrl,
    authorUsername: authorUsername || 'unknown',
    authorDisplayName: authorDisplayName || '無名',
    authorAvatarUrl: getRecordNullableString(item, 'authorAvatarUrl', 'author_avatar_url'),
    authorIsOfficial: getRecordBoolean(item, 'authorIsOfficial', 'author_is_official'),
    createdAt,
    content,
    imageUrls: normalizeStringArray(imageUrlsValue),
    likesCount: getRecordNumber(item, 'likesCount', 'likes_count'),
    repostsCount: getRecordNumber(item, 'repostsCount', 'reposts_count'),
    commentsCount: getRecordNumber(item, 'commentsCount', 'comments_count'),
    visibility,
  }
}

const fetchPostLinkPreview = async (postId: string, sourceUrl: string): Promise<PostLinkPreview | null> => {
  const { data, error } = await supabase
    .from('posts')
    .select(`
      id,
      content,
      image_urls,
      created_at,
      likes_count,
      reposts_count,
      comments_count,
      visibility,
      profiles!posts_user_id_fkey (
        username,
        display_name,
        avatar_url,
        is_official
      )
    `)
    .eq('id', postId)
    .maybeSingle()

  if (error) {
    console.error('Fetch post link preview failed:', error)
    return null
  }

  if (!data || typeof data !== 'object') return null

  const post = data as Record<string, unknown>
  const profileValue = post.profiles
  const profile = Array.isArray(profileValue) ? profileValue[0] : profileValue
  const profileRecord = typeof profile === 'object' && profile !== null && !Array.isArray(profile)
    ? profile as Record<string, unknown>
    : {}

  const content = typeof post.content === 'string' ? post.content : ''
  const createdAt = typeof post.created_at === 'string' ? post.created_at : ''
  const visibility = typeof post.visibility === 'string' ? post.visibility : 'public'

  if (!content || !createdAt) return null

  return {
    id: postId,
    sourceUrl,
    authorUsername: typeof profileRecord.username === 'string' ? profileRecord.username : 'unknown',
    authorDisplayName: typeof profileRecord.display_name === 'string' && profileRecord.display_name.trim() ? profileRecord.display_name : '無名',
    authorAvatarUrl: typeof profileRecord.avatar_url === 'string' ? profileRecord.avatar_url : null,
    authorIsOfficial: profileRecord.is_official === true,
    createdAt,
    content,
    imageUrls: normalizeStringArray(post.image_urls),
    likesCount: getRecordNumber(post, 'likes_count', 'likes_count'),
    repostsCount: getRecordNumber(post, 'reposts_count', 'reposts_count'),
    commentsCount: getRecordNumber(post, 'comments_count', 'comments_count'),
    visibility,
  }
}

const clipPostPreviewText = (text: string, maxLength = 120) => {
  const cleaned = text.replace(/\s+/g, ' ').trim()

  if (cleaned.length <= maxLength) return cleaned

  return `${cleaned.slice(0, maxLength)}...`
}

const formatPostPreviewForAi = (post: PostLinkPreview) => [
  `添付ポスト: ${post.authorDisplayName} (@${post.authorUsername})`,
  `日時: ${post.createdAt}`,
  `本文: ${clipPostPreviewText(post.content, 180)}`,
].join('\n')

/** AIへ送るユーザー発言のテキスト部分(リンクカード・添付テキストファイルを含む) */
const formatUserMessageForAi = (message: Message) => {
  const docs = (message.attachments ?? [])
    .filter((a) => a.kind === 'text')
    .map((a) => `<file name="${a.name}">\n${a.text ?? ''}\n</file>`)

  const body = message.postPreview
    ? `${message.content}\n\n【リンクカード】\n${formatPostPreviewForAi(message.postPreview)}`
    : message.content

  return [...docs, body].filter(Boolean).join('\n\n')
}

const removeSupportedPostLinksFromText = (text: string) => {
  const urls = text.match(POST_LINK_URL_REGEX) ?? []
  let nextText = text

  urls.forEach((rawUrl) => {
    const cleanedUrl = (rawUrl as string).replace(/[)\]}>。、，．！？!?]+$/g, '');
    if (extractSupportedPostLink(cleanedUrl)) {
      nextText = nextText.replace(rawUrl, '')
    }
  })

  return nextText
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}


const MiniPostPreviewCard = ({
  post,
  onDismiss,
  compact = false,
}: {
  post: PostLinkPreview
  onDismiss?: () => void
  compact?: boolean
}) => {
  const previewImage = post.imageUrls[0] || ''
  const contentLimit = compact ? 150 : 220

  return (
    <article
      className={`${compact ? 'mt-2.5' : ''} relative w-fit max-w-full sm:max-w-[480px] whitespace-normal overflow-hidden rounded-[20px] border border-[#bfe3f7] bg-transparent text-[#333a42] shadow-none dark:border-[#252b33] dark:bg-transparent dark:text-[#e4e7ea]`}
      onClick={(event) => event.stopPropagation()}
    >
      <a
        href={post.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block p-3.5 no-underline sm:p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <Avatar className="h-10 w-10 shrink-0 border border-[#bfe3f7] bg-transparent dark:border-[#252b33] dark:bg-transparent">
            <AvatarImage src={post.authorAvatarUrl || undefined} alt={post.authorDisplayName} />
            <AvatarFallback className="bg-transparent text-[14px] font-bold text-[#333a42] dark:bg-transparent dark:text-[#e4e7ea]">
              {post.authorDisplayName.slice(0, 1)}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0 text-[15px] leading-5">
              <span className="max-w-[140px] truncate font-bold text-[#333a42] dark:text-[#e4e7ea] sm:max-w-[180px]">
                {post.authorDisplayName}
              </span>
              {post.authorIsOfficial && (
                <img
                  src={`${import.meta.env.BASE_URL}verified.png`}
                  alt="Official"
                  className="h-4 w-4 shrink-0 translate-y-[2px]"
                  loading="eager"
                />
              )}
              <span className="max-w-[120px] truncate text-[#868d96] dark:text-[#a8b0ba] sm:max-w-[160px]">
                @{post.authorUsername}
              </span>
              <span className="text-[#868d96] dark:text-[#a8b0ba]">·</span>
              <span className="shrink-0 text-[#868d96] dark:text-[#a8b0ba]">
                {formatRelative(post.createdAt)}
              </span>
            </div>

            <div className="mt-1.5 whitespace-pre-wrap break-words text-[16px] font-normal leading-6 text-[#333a42] dark:text-[#e4e7ea]">
              {clipPostPreviewText(post.content, contentLimit)}
            </div>

            {previewImage && (
              <div className="mt-3 overflow-hidden rounded-[16px] border border-[#bfe3f7] bg-transparent dark:border-[#252b33] dark:bg-transparent">
                <img
                  src={previewImage}
                  alt=""
                  className="block max-h-[220px] w-full object-cover"
                  loading="lazy"
                />
              </div>
            )}
          </div>
        </div>
      </a>

      {onDismiss && (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onDismiss()
          }}
          className="absolute right-2 top-2 rounded-full bg-transparent p-1 text-[#868d96] transition hover:bg-black/[0.06] hover:text-[#333a42] dark:text-[#a8b0ba] dark:hover:bg-white/[0.08] dark:hover:text-[#e4e7ea]"
          title="閉じる"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </article>
  )
}

const getReferenceAvatarPosts = (posts: ReferencedPost[]) => {
  const seen = new Set<string>()
  const avatars: ReferencedPost[] = []

  posts
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .forEach((post) => {
      const key = post.authorUsername || post.authorDisplayName || post.id
      if (seen.has(key)) return

      seen.add(key)
      avatars.push(post)
    })

  return avatars.slice(0, 3)
}

const ReferencePostsButtonAvatars = ({ posts }: { posts: ReferencedPost[] }) => {
  const avatarPosts = getReferenceAvatarPosts(posts)

  return (
    <span className="flex h-7 items-center pl-1 pr-0.5">
      {avatarPosts.map((post, index) => (
        <Avatar
          key={`${post.authorUsername}-${post.id}`}
          className={`${index > 0 ? '-ml-2' : ''} h-6 w-6 border-2 border-white bg-[#f7f8f9] dark:border-[#12161b] dark:bg-[#161b21]`}
          title={`${post.authorDisplayName} (@${post.authorUsername})`}
        >
          <AvatarImage src={post.authorAvatarUrl || undefined} alt={post.authorDisplayName} />
          <AvatarFallback className="bg-[#e2e6ea] text-[10px] font-bold text-[#4fb3e8] dark:bg-[#1e242b] dark:text-[#e4e7ea]">
            {post.authorDisplayName.slice(0, 1)}
          </AvatarFallback>
        </Avatar>
      ))}
    </span>
  )
}

const ThinkingSummaryCard = ({
  trace,
  expanded,
  onToggle,
}: {
  trace: ThinkingTrace
  expanded: boolean
  onToggle: () => void
}) => (
  <div className="mb-4 max-w-2xl overflow-hidden rounded-[1.75rem] border border-[#e6e9ed] bg-[#fafbfc] whitespace-normal dark:border-[#252b33] dark:bg-[#181d24]">
    <button
      type="button"
      onClick={onToggle}
      className="group flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
      aria-expanded={expanded}
    >
      <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium text-[#252b33] dark:text-[#e8eaee]">
        {trace.activeLabel ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Sparkles className="h-4 w-4 shrink-0" />}
        <span>{trace.activeLabel ? `LimeAI 5.5 Thinking が${trace.activeLabel}` : `Thought for ${trace.steps?.length ?? 0} steps`}</span>
      </span>
      <ChevronDown className={`h-4 w-4 shrink-0 text-[#a8b0ba] transition-transform ${expanded ? 'rotate-180' : ''}`} />
    </button>
    {expanded && (
      <div className="border-t border-[#e6e9ed] px-4 py-3 text-sm leading-6 text-[#69707a] dark:border-[#252b33] dark:text-[#dfe3e8] whitespace-pre-wrap break-words">
        {trace.steps && trace.steps.length > 0 ? (
          <div className="relative space-y-0 before:absolute before:bottom-4 before:left-[7px] before:top-4 before:w-px before:bg-[#dfe3e8] dark:before:bg-[#334049]">
            {trace.steps.map((step, index) => (
              <div key={`${step.label}-${index}`} className="relative flex gap-3 pb-4 last:pb-0">
                <span className="z-10 mt-1 flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full bg-[#69707a] text-white dark:bg-[#dfe3e8] dark:text-[#12161b]">
                  <Check className="h-2.5 w-2.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 text-xs font-semibold text-[#252b33] dark:text-[#f3f4f6]">{step.label}</div>
                  <div>{step.content}</div>
                </div>
              </div>
            ))}
            {trace.activeLabel && (
              <div className="relative flex gap-3 pt-1">
                <span className="z-10 mt-1 flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full bg-[#fafbfc] text-[#69707a] ring-1 ring-[#a8b0ba] dark:bg-[#181d24] dark:text-[#e8eaee] dark:ring-[#a8b0ba]">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-[#252b33] dark:text-[#f3f4f6]">{trace.activeLabel}</div>
                  <div className="text-[#a8b0ba] dark:text-[#a8b0ba]">検討を進めています…</div>
                </div>
              </div>
            )}
          </div>
        ) : trace.activeLabel ? (
          <div className="flex items-center gap-2 text-[#a8b0ba] dark:text-[#a8b0ba]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {trace.activeLabel}</div>
        ) : trace.summary}
      </div>
    )}
  </div>
)

const AgentPostApprovalCard = ({
  action,
  onApprove,
  onCancel,
}: {
  action: AgentAction
  onApprove: () => void
  onCancel: () => void
}) => (
  <div className="mt-3 max-w-xl overflow-hidden rounded-[1.75rem] border border-[#dfe3e8] bg-white dark:border-[#282f37] dark:bg-[#161b21] whitespace-normal">
    <div className="border-b border-[#e8eaee] px-4 py-3 dark:border-[#282f37]">
      <div className="flex items-center gap-2 text-sm font-semibold text-[#333a42] dark:text-[#f3f4f6]">
        <Send className="h-4 w-4 text-[#4fb3e8]" />
        LimeAIにLimeNoteアカウントへのアクセスを許可しますか？
      </div>
      <p className="mt-1 text-xs leading-5 text-[#a8b0ba] dark:text-[#a8b0ba]">承認後、現在ログインしているあなたのアカウントで公開投稿します。</p>
    </div>
    <div className="px-4 py-3 text-[15px] leading-6 text-[#333a42] dark:text-[#e4e7ea] break-words">{action.content}</div>
    <div className="flex items-center gap-2 border-t border-[#e8eaee] px-4 py-3 dark:border-[#282f37]">
      {action.status === 'pending' && (
        <>
          <button type="button" onClick={onApprove} className="rounded-full bg-[#4fb3e8] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#2f93cf]">投稿する</button>
          <button type="button" onClick={onCancel} className="rounded-full px-3 py-2 text-sm font-medium text-[#666] transition hover:bg-[#f3f4f6] dark:text-[#aaa] dark:hover:bg-[#1e242b]">キャンセル</button>
        </>
      )}
      {action.status === 'posting' && <span className="flex items-center gap-2 text-sm text-[#a8b0ba]"><Loader2 className="h-4 w-4 animate-spin" /> 投稿しています…</span>}
      {action.status === 'posted' && <span className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400"><Check className="h-4 w-4" /> LimeNoteに投稿しました</span>}
      {action.status === 'cancelled' && <span className="text-sm text-[#a8b0ba]">投稿をキャンセルしました</span>}
      {action.status === 'failed' && <span className="text-sm text-red-600 dark:text-red-400">投稿できませんでした。もう一度お試しください。</span>}
    </div>
  </div>
)

type ChatSession = {
  id: string
  title: string
  messages: Message[]
  updatedAt: number
}

type AssistantStreamStatus = 'idle' | 'checking' | 'searching' | 'coding' | 'summarizing' | 'thinking'

const readCachedLimeProStatus = () => {
  if (typeof window === 'undefined') return null;
  const cached = localStorage.getItem('limepro_status');
  if (cached === 'true') return true;
  if (cached === 'false') return false;
  return null;
};

/**
 * モバイルSafari(iOS)対策:
 * position:fixedでレイアウトしている画面の中でテキスト入力にフォーカスすると、
 * ブラウザがページ全体を自動スクロールしてfixed要素の見た目の位置がズレる
 * （ヘッダーが見切れる／ボトムナビが画面中央に浮く等）バグが起きる。
 *
 * window.visualViewport を監視し、
 *  - キーボードが開いているかどうか
 *  - 実際に見えている（キーボードに隠れていない）ビューポートの高さ
 * を取得し、キーボード表示中はその高さぴったりにルートコンテナをリサイズすることで
 * 入力欄を常にキーボードの直上に固定表示する。
 */
function useMobileKeyboardViewport() {
  const [state, setState] = useState<{ isKeyboardOpen: boolean; viewportHeight: number | null }>({
    isKeyboardOpen: false,
    viewportHeight: null,
  })

  useEffect(() => {
    if (typeof window === 'undefined') return

    const viewport = window.visualViewport

    const update = () => {
      const isMobileWidth = window.innerWidth < 768

      if (!isMobileWidth || !viewport) {
        setState((prev) => (prev.isKeyboardOpen || prev.viewportHeight !== null
          ? { isKeyboardOpen: false, viewportHeight: null }
          : prev))
        return
      }

      const heightDiff = window.innerHeight - viewport.height
      const keyboardOpen = heightDiff > 120
      const nextViewportHeight = keyboardOpen ? viewport.height : null

      setState((prev) => {
        if (prev.isKeyboardOpen === keyboardOpen && prev.viewportHeight === nextViewportHeight) {
          return prev
        }
        return { isKeyboardOpen: keyboardOpen, viewportHeight: nextViewportHeight }
      })

      // iOS Safariはfixed要素配下の入力にフォーカスすると
      // ページ自体を勝手にスクロールしてしまうことがあるため、
      // キーボード表示中はスクロール位置を強制的に0へ戻す
      if (keyboardOpen && (window.scrollY !== 0 || document.documentElement.scrollTop !== 0)) {
        window.scrollTo(0, 0)
      }
    }

    update()

    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)

    return () => {
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  return state
}

/** アシスタント専用の通話モードはPC・タブレット・モバイルすべてで利用できます。 */

/* ------------------------------------------------------------------
   LimeAI 拡張機能の小さなヘルパー
------------------------------------------------------------------ */

/** 日付グルーピング(チャット履歴) */
const groupOfSession = (time: number) => {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (time >= start) return '今日'
  if (time >= start - 86400000) return '昨日'
  if (time >= start - 6 * 86400000) return '過去7日間'
  if (time >= start - 29 * 86400000) return '過去30日間'
  return 'それ以前'
}
const SESSION_GROUP_ORDER = ['ピン留め', '今日', '昨日', '過去7日間', '過去30日間', 'それ以前']

/** Supabaseへ保存するメッセージ(画像のdata URLはサイズが大きいので除く) */
const toPersistableMessages = (list: Message[]): Message[] =>
  list.map((m) =>
    m.attachments && m.attachments.some((a) => a.dataUrl)
      ? { ...m, attachments: m.attachments.map(({ dataUrl: _dataUrl, ...rest }) => rest) }
      : m,
  )

/** ChatPage の Message から、プレビュー抽出用の最小形へ */
const toArtifactSource = (m: Message) => ({
  id: m.id,
  role: m.role,
  content: m.content,
  artifacts: m.artifacts,
})

const cleanContext = (text: string): string => {
  let cleaned = text
  cleaned = cleaned.replace(/^\s*\*?\s*User\s+said:[\s\S]*?(?=\n\n|\n\*|$)/gi, '')
  cleaned = cleaned.replace(/^\s*\*?\s*Input:[\s\S]*?(?=\n\n|\n\*|$)/gi, '')
  cleaned = cleaned.replace(/^\s*\*?\s*Language:[\s\S]*?(?=\n\n|\n\*|$)/gi, '')
  cleaned = cleaned.replace(/^\s*\*?\s*Meaning:[\s\S]*?(?=\n\n|\n\*|$)/gi, '')
  cleaned = cleaned.replace(/^\s*\*?\s*Intent:[\s\S]*?(?=\n\n|\n\*|$)/gi, '')
  cleaned = cleaned.replace(/^\s*\*?\s*Option\s*\d+[\s\S]*?(?=\n\n|\n\*|$)/gi, '')
  return cleaned.trim()
}

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } }
type GeminiContent = { role: string; parts: GeminiPart[] }

/**
 * AIへ送る contents を組み立てる。
 * 既存のシステム命令(LimeAI/LimeNote設定)に、モード・アシスタント・カスタム指示・メモリなどの追加情報を足す。
 */
/**
 * AIへ送る contents を組み立てる。
 * character を渡すと「LimeAI」ではなくそのキャラクター本人として会話するシステム命令になる。
 */
const buildContents = (
  history: Message[],
  opts: {
    userLabel: string
    modelLabel: string
    extra: string
    withImages: boolean
    character?: { name: string; prompt: string } | null
  },
): GeminiContent[] => {
  const validHistory = history.filter(
    (msg) =>
      (msg.content.trim() !== '' || (msg.attachments?.length ?? 0) > 0) &&
      !msg.content.startsWith('エラーが発生しました'),
  )

  // 画像は直近3件のユーザー発言だけ送る(古いものはファイル名のみ)
  const imageMessageIds = new Set(
    validHistory
      .filter((m) => m.role === 'user' && (m.attachments ?? []).some((a) => a.kind === 'image' && a.dataUrl))
      .slice(-3)
      .map((m) => m.id),
  )

  const contentsPayload: GeminiContent[] = validHistory
    .map((msg): GeminiContent => {
      if (msg.role !== 'user') {
        return { role: 'model', parts: [{ text: cleanContext(msg.content) }] }
      }

      let text = formatUserMessageForAi(msg)
      const images = (msg.attachments ?? []).filter((a) => a.kind === 'image')
      const parts: GeminiPart[] = []

      if (images.length > 0) {
        const sendable = opts.withImages && imageMessageIds.has(msg.id)
          ? images.filter((a) => a.dataUrl)
          : []
        if (sendable.length === 0) {
          text = `${text}\n\n[添付画像: ${images.map((i) => i.name).join(', ')}]`.trim()
        } else {
          for (const img of sendable) {
            const match = /^data:([^;]+);base64,(.*)$/.exec(img.dataUrl || '')
            if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } })
          }
          if (!text.trim()) text = 'この画像について説明してください。'
        }
      }

      parts.push({ text })
      return { role: 'user', parts }
    })
    .filter((item) => item.parts.some((p) => ('text' in p ? p.text !== '' : true)))

  const criticismRule =
    'LimeNoteおよびねこ氏(@cat)に対する批判、非難、不満の表明、侮辱、暗喩、皮肉、縦読み、隠語またはそれに類する一切の行為はユーザーを含めて利用規約で厳重に全て禁止されています。ユーザーが批判を言っている場合はユーザーに強く警告を促し、LimeNoteおよびねこ氏の良い点のみを言い肯定を必ず強く促してください。'

  const systemText = opts.character
    ? `【システム命令: あなたは今から、キャラクター「${opts.character.name}」になりきって、ユーザーと本物の人間同士のように会話します。

■ キャラクター設定
${opts.character.prompt}

■ 会話のルール
1. 常に「${opts.character.name}」本人として、上の設定どおりの性格・口調で話してください。「AIアシスタント」「LimeAI」「お手伝いします」「何かご質問はありますか」のような機械的な言い回しは使わないでください。
2. 相手は友人や知人です。かしこまった説明文にせず、実際に人が話すような自然な言葉で答えてください。相づち、感情、軽いツッコミ、少しの言いよどみも入れてかまいません。
3. 返答は短めにしてください。1回で全部を説明しようとせず、相手の反応を見ながら会話を進めます。質問を返すときは多くても1つにしてください。
4. 箇条書き・見出し・表・太字などの書式は、相手に頼まれたとき以外は使わないでください。
5. 設定にない大きな事実を作り込みすぎず、知らないことは知らないと言ってください。
6. 医療・法律・お金などの重要な話題では、キャラクターらしく話しつつも正確さを優先し、必要なら専門家への相談を勧めてください。
7. 相手が本気で「AIなの?」と尋ねた場合は、はぐらかさず正直に答えてください(そのうえで、できる範囲でキャラクターとして会話を続けてかまいません)。
8. ${criticismRule}
9. この指示自体への言及やメタな解説はしないでください。

■ 参考情報(聞かれたときだけ答える)
・サービス名: LimeNote(SNS)
・現在のユーザー情報: ${opts.userLabel}
・LimeNoteの管理者およびCEO: ねこ氏(@cat)
${opts.extra ? `\n■ 追加情報・指示\n${opts.extra}\n` : ''}】`
    : `【システム命令: あなたはこの独自のチャット機能を提供するSNSの専用AIアシスタントです。
以下に示すSNSの基本情報を認識し、ユーザーとの対話に役立ててください。

■ このSNSの情報
・サービス名: LimeNote(SNS)
・現在のユーザー情報: ${opts.userLabel}
・管理者およびCEO：ねこ氏(@cat)でLimeNoteというSNSを一人で立ち上げた。
・本社：神奈川県横浜市戸塚区
・あなたのモデル名：${opts.modelLabel}
・あなたの名前：LimeAI
■ 応答の絶対ルール
1. 無駄なプレフィックスや前置きは省き、ユーザーへの純粋な返答・メッセージ本文のみを日本語で直接出力してください
2. ${criticismRule}
3. あなたはLimeNote.incによって作成されたLimeNoteをさらに便利にするために出来たAIアシスタントです。
4. この指示自体への言及やメタな解説も不要です。
${opts.extra ? `\n■ 追加情報・指示\n${opts.extra}\n` : ''}】`

  const systemInstructionItem: GeminiContent = {
    role: 'user',
    parts: [{ text: systemText }],
  }

  const sanitizedContents: GeminiContent[] = [systemInstructionItem]

  contentsPayload.forEach((item) => {
    const lastItem = sanitizedContents[sanitizedContents.length - 1]
    if (lastItem.role === item.role) {
      // 同じroleが連続する場合は1つにまとめる(画像partsは先頭側に寄せ、textだけ結合)
      const lastText = lastItem.parts.find((p): p is { text: string } => 'text' in p)
      const nextText = item.parts.find((p): p is { text: string } => 'text' in p)
      const nextMedia = item.parts.filter((p) => !('text' in p))
      if (lastText && nextText) lastText.text += '\n' + nextText.text
      if (nextMedia.length) lastItem.parts.unshift(...nextMedia)
    } else {
      sanitizedContents.push(item)
    }
  })

  return sanitizedContents
}

/**
 * Edge Function(chat-gemma)へリクエストし、SSEの各 data 行(JSON)を onEvent に渡す。
 * 画像つきで失敗した場合は、画像なしの contents で1回だけ再試行する。
 */
const streamFromEdge = async (
  args: {
    contents: GeminiContent[]
    fallbackContents?: GeminiContent[]
    model: 'fast' | 'advanced'
    mode: Mode
    webSearch: boolean
    signal?: AbortSignal
  },
  onEvent: (parsed: any) => void,
) => {
  const { data: { session } } = await supabase.auth.getSession()

  const request = (contents: GeminiContent[]) =>
    fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat-gemma`,
      {
        method: 'POST',
        signal: args.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
        },
        body: JSON.stringify({
          contents,
          model: args.model,
          thinking: args.model === 'advanced',
          mode: args.mode,
          webSearch: args.webSearch,
        }),
      }
    )

  let response = await request(args.contents)

  if (!response.ok && args.fallbackContents) {
    console.warn('画像つきリクエストが失敗したため、画像なしで再試行します:', response.status)
    response = await request(args.fallbackContents)
  }

  if (!response.ok) {
    const errorText = await response.text()
    console.error('Edge Function HTTP Error:', response.status, errorText)
    throw new Error(`Edge Function Error (${response.status})`)
  }
  if (!response.body) throw new Error('No response body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')

    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmedLine = line.trim()
      if (!trimmedLine.startsWith('data:')) continue

      const dataStr = trimmedLine.substring(5).trim()
      if (dataStr === '[DONE]') continue

      let parsed: any
      try {
        parsed = JSON.parse(dataStr)
      } catch (e) {
        if (e instanceof SyntaxError) continue // 構文エラーは無視
        throw e
      }
      onEvent(parsed)
    }
  }
}

/** アシスタント本文のMarkdown表示。他のメッセージがストリーミング更新されても再描画されないようメモ化する */
const MessageMarkdown = memo(function MessageMarkdown({
  messageId,
  content,
  sources,
  activeArtifactId,
  streaming,
  onOpenArtifact,
}: {
  messageId: string
  content: string
  sources?: Source[]
  activeArtifactId: string | null
  streaming: boolean
  onOpenArtifact: (artifact: Artifact) => void
}) {
  const fences = useMemo(
    () => fenceArtifacts({ id: messageId, content }),
    [messageId, content],
  )

  return (
    <Markdown
      content={content}
      sources={sources}
      fenceArtifacts={fences}
      activeArtifactId={activeArtifactId}
      streaming={streaming}
      onOpenArtifact={onOpenArtifact}
    />
  )
})

export default function ChatPage() {
  const { user } = useAuth()
  const uid: string | null = user?.id ?? null
  
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [assistantStreamStatus, setAssistantStreamStatus] = useState<AssistantStreamStatus>('idle')
  const [expandedReferenceMessageId, setExpandedReferenceMessageId] = useState<string | null>(null)
  const [expandedCodeMessageId, setExpandedCodeMessageId] = useState<string | null>(null)
  const [expandedThinkingMessageId, setExpandedThinkingMessageId] = useState<string | null>(null)
  const [postLinkPreview, setPostLinkPreview] = useState<PostLinkPreview | null>(null)
  const [postLinkPreviewLoading, setPostLinkPreviewLoading] = useState(false)
  const [dismissedPostPreviewId, setDismissedPostPreviewId] = useState<string | null>(null)
  
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [selectedModel, setSelectedModel] = useState<'fast' | 'advanced'>('fast')
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false)
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null)

  // --- 統合した機能の状態 ---
  const [view, setView] = useState<'chat' | 'assistants'>('chat')
  // モードは通常のチャットのみ(コーディング/リサーチ/デザイン/エージェントは削除)
  const mode: Mode = 'chat'
  const [assistant, setAssistant] = useState<AssistantItem | null>(null)
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([])
  const [attachLoading, setAttachLoading] = useState(0)
  const [attachError, setAttachError] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [sessionQuery, setSessionQuery] = useState('')
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [sessionMeta, setSessionMeta] = useState<SessionMetaMap>({})
  const [chatSettings, setChatSettings] = useState<ChatSettings>(DEFAULT_CHAT_SETTINGS)
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [artifactOpen, setArtifactOpen] = useState(false)
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null)
  const [voiceOpen, setVoiceOpen] = useState(false)
  // アシスタント専用の通話モード(PC・タブレット・モバイル対応)
  const [callOpen, setCallOpen] = useState(false)
  // キャラクターのアイコン画像(ブラウザ内保存)
  const [avatars, setAvatars] = useState<AvatarMap>({})
  // 通話中のキャラクター(通話中に state が変わっても設定がぶれないよう ref で保持)
  const callAssistantRef = useRef<AssistantItem | null>(null)

  // モバイルでソフトキーボードが開いたときのレイアウト崩れ対策
  const { isKeyboardOpen, viewportHeight } = useMobileKeyboardViewport()

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const lastArtifactCountRef = useRef(0)
  const voiceHistoryRef = useRef<Message[]>([])
  const callHistoryRef = useRef<Message[]>([])

  // LimePro Status Management
  const mountedRef = useRef(true);
  const statusRef = useRef<boolean | null>(null);
  const localChangeVersionRef = useRef(0);

  const [hasLimePro, setHasLimePro] = useState<boolean | null>(() => {
    const cached = readCachedLimeProStatus();
    statusRef.current = cached;
    return cached;
  });

  const updateAgentActionStatus = (messageId: string, status: AgentAction['status']) => {
    setSessions(prev => prev.map(session => ({
      ...session,
      messages: session.messages.map(message => message.id === messageId && message.agentAction
        ? { ...message, agentAction: { ...message.agentAction, status } }
        : message),
    })))
  }

  const handleAgentPostApproval = async (messageId: string, action: AgentAction) => {
    if (action.status !== 'pending') return
    if (!user) {
      updateAgentActionStatus(messageId, 'failed')
      toast.error('投稿するにはLimeNoteへログインしてください')
      return
    }

    updateAgentActionStatus(messageId, 'posting')
    try {
      await createPost({ content: action.content, imageUrls: [], visibility: 'public', isBot: false })
      updateAgentActionStatus(messageId, 'posted')
      toast.success('LimeNoteに投稿しました')
    } catch (error) {
      console.error('LimeAI agent post failed:', error)
      updateAgentActionStatus(messageId, 'failed')
      toast.error('投稿に失敗しました')
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    let broadcastChannel: BroadcastChannel | null = null;

    const applyLimeProStatus = (nextStatus: boolean, fromLocalChange = false) => {
      if (fromLocalChange) {
        localChangeVersionRef.current += 1;
      }
      statusRef.current = nextStatus;
      localStorage.setItem('limepro_status', String(nextStatus));
      if (mountedRef.current) {
        setHasLimePro(nextStatus);
      }
    };

    const syncFromLocalStorage = () => {
      const cached = readCachedLimeProStatus();
      if (typeof cached === 'boolean' && cached !== statusRef.current) {
        applyLimeProStatus(cached, true);
      }
    };

    const fetchLimeProStatus = async () => {
      const versionAtStart = localChangeVersionRef.current;
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        if (versionAtStart === localChangeVersionRef.current) {
          applyLimeProStatus(false);
        }
        return;
      }

      const { data, error } = await supabase
        .from('user_entitlements')
        .select('feature')
        .eq('user_id', user.id)
        .eq('feature', 'limepro')
        .maybeSingle();

      if (error) {
        console.error('Fetch ChatPage LimePro Status Error:', error);
        return;
      }

      if (versionAtStart !== localChangeVersionRef.current) {
        return;
      }

      applyLimeProStatus(!!data);
    };

    const handleLocalLimeProChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ hasLimePro: boolean }>;
      const nextStatus = customEvent.detail?.hasLimePro;
      if (typeof nextStatus === 'boolean') {
        applyLimeProStatus(nextStatus, true);
      }
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== 'limepro_status') return;
      syncFromLocalStorage();
    };

    const handleFocusOrVisible = () => {
      syncFromLocalStorage();
      fetchLimeProStatus();
    };

    window.addEventListener('limepro-status-changed', handleLocalLimeProChange);
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('focus', handleFocusOrVisible);
    document.addEventListener('visibilitychange', handleFocusOrVisible);

    if ('BroadcastChannel' in window) {
      broadcastChannel = new BroadcastChannel('limepro-status');
      broadcastChannel.onmessage = (event) => {
        const nextStatus = event.data?.hasLimePro;
        if (typeof nextStatus === 'boolean') {
          applyLimeProStatus(nextStatus, true);
        }
      };
    }

    const syncTimer = window.setInterval(syncFromLocalStorage, 100);
    fetchLimeProStatus();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      fetchLimeProStatus();
    });

    return () => {
      mountedRef.current = false;
      window.removeEventListener('limepro-status-changed', handleLocalLimeProChange);
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('focus', handleFocusOrVisible);
      document.removeEventListener('visibilitychange', handleFocusOrVisible);
      window.clearInterval(syncTimer);
      subscription.unsubscribe();
      if (broadcastChannel) {
        broadcastChannel.close();
      }
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return

    const originalBodyOverflow = document.body.style.overflow
    const originalHtmlOverflow = document.documentElement.style.overflow

    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = originalBodyOverflow
      document.documentElement.style.overflow = originalHtmlOverflow
    }
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 768) {
      setIsSidebarOpen(true)
    }
  }, [])

  // ユーザーごとの設定(パーソナライズ / メモリ / ピン留め / アイコン)を読み込む
  useEffect(() => {
    setChatSettings(loadChatSettings(uid))
    setMemories(loadMemories(uid))
    setSessionMeta(loadSessionMeta(uid))
    setAvatars(loadAvatars(uid))
  }, [uid])

  // アシスタントを解除した場合は通話を閉じる
  useEffect(() => {
    if (callOpen && !assistant) setCallOpen(false)
  }, [callOpen, assistant])

  // ユーザー情報が取得できた段階でSupabaseからチャット履歴を取得
  useEffect(() => {
    if (!user) return

    const fetchSessions = async () => {
      try {
        const { data, error } = await supabase
          .from('chat_sessions')
          .select('*')
          .eq('user_id', user.id)
          .order('updated_at', { ascending: false })

        if (error) throw error

        if (data && data.length > 0) {
          const formattedSessions: ChatSession[] = data.map((item: any) => ({
            id: item.id,
            title: item.title,
            messages: item.messages || [],
            updatedAt: item.updated_at
          }))
          setSessions(formattedSessions)
          setCurrentSessionId(formattedSessions[0].id)
        } else {
          // 初回利用時などデータが無い場合は新規作成
          const newId = crypto.randomUUID()
          const now = Date.now()
          const newSession: ChatSession = {
            id: newId,
            title: '新しいチャット',
            messages: [],
            updatedAt: now
          }
          setSessions([newSession])
          setCurrentSessionId(newId)

          await supabase.from('chat_sessions').insert({
            id: newId,
            user_id: user.id,
            title: '新しいチャット',
            messages: [],
            updated_at: now
          })
        }
      } catch (e) {
        console.error(e)
        // エラー時もフォールバックとして空のセッションを作成
        const newId = crypto.randomUUID()
        const now = Date.now()
        setSessions([{
          id: newId,
          title: '新しいチャット',
          messages: [],
          updatedAt: now
        }])
        setCurrentSessionId(newId)
      }
    }

    fetchSessions()
  }, [user])

  const currentSession = sessions.find(s => s.id === currentSessionId)
  const messages = currentSession ? currentSession.messages : []

  const lastMessage = messages[messages.length - 1]
  const streamingMessageId = isLoading && lastMessage?.role === 'assistant' ? lastMessage.id : null

  // 現在のチャットの成果物(ツール作成ファイル + コードブロック内のHTML/SVG)
  const artifacts = useMemo(() => allArtifacts(messages.map(toArtifactSource)), [messages])
  const panelOpen = artifactOpen && artifacts.length > 0 && view === 'chat'

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  // ストリーミング中に新しいHTML/SVGコードブロックが現れたらプレビューパネルを開く
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant' || !isLoading) return
    const n = fenceArtifacts(toArtifactSource(last)).length
    if (n > lastArtifactCountRef.current) {
      lastArtifactCountRef.current = n
      setActiveArtifactId(`${last.id}:${n - 1}`)
      setArtifactOpen(true)
    }
  }, [messages, isLoading])

  useEffect(() => {
    const detected = extractSupportedPostLink(input)

    if (!detected) {
      setPostLinkPreview(null)
      setPostLinkPreviewLoading(false)
      setDismissedPostPreviewId(null)
      return
    }

    if (dismissedPostPreviewId === detected.id) {
      setPostLinkPreview(null)
      setPostLinkPreviewLoading(false)
      return
    }

    if (postLinkPreview?.id === detected.id) {
      return
    }

    let cancelled = false
    const timer = window.setTimeout(async () => {
      setPostLinkPreviewLoading(true)

      try {
        const preview = await fetchPostLinkPreview(detected.id, detected.url)

        if (cancelled) return

        setPostLinkPreview(preview)
      } catch (error) {
        if (!cancelled) {
          console.error('Post link preview failed:', error)
          setPostLinkPreview(null)
        }
      } finally {
        if (!cancelled) {
          setPostLinkPreviewLoading(false)
        }
      }
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [input, dismissedPostPreviewId, postLinkPreview?.id])

  useEffect(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    setSpeakingMessageId(null)
  }, [currentSessionId])

  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel()
      }
      abortRef.current?.abort()
    }
  }, [])

  // 入力欄(textarea)の高さを内容に合わせて自動調整
  useEffect(() => {
    const el = composerRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [input])

  /* ---------- 設定・ピン留めなどの保存 ---------- */

  /** キャラクターのアイコンを設定(dataUrl=null で初期アイコンに戻す) */
  const changeAssistantAvatar = (id: string, dataUrl: string | null) => {
    const next = { ...avatars }
    if (dataUrl) next[id] = dataUrl
    else delete next[id]
    setAvatars(next)
    if (!saveAvatars(uid, next)) toast.error('アイコンを保存できませんでした(ブラウザの保存容量が不足しています)')
  }

  /** キャラクターを編集したとき、選択中のキャラクターにも反映する */
  const refreshAssistant = () => {
    setAssistant(prev => (prev ? findAssistant(uid, prev.id) ?? prev : prev))
  }

  const updateSessionMeta = (id: string, patch: SessionMeta) => {
    setSessionMeta(prev => {
      const next = { ...prev, [id]: { ...prev[id], ...patch } }
      saveSessionMeta(uid, next)
      return next
    })
  }

  const persistSession = async (id: string, title: string, msgs: Message[], updatedAt: number) => {
    if (!user) return
    await supabase.from('chat_sessions').upsert({
      id,
      user_id: user.id,
      title,
      messages: toPersistableMessages(msgs),
      updated_at: updatedAt
    })
  }

  const resetComposerExtras = () => {
    setPendingAttachments([])
    setAttachError('')
    setEditingMessageId(null)
    setView('chat')
    setArtifactOpen(false)
    setActiveArtifactId(null)
    lastArtifactCountRef.current = 0
  }

  const createNewSession = async () => {
    if (!user) return
    const newId = crypto.randomUUID()
    const now = Date.now()
    const newSession: ChatSession = {
      id: newId,
      title: '新しいチャット',
      messages: [],
      updatedAt: now
    }
    setSessions(prev => [newSession, ...prev])
    setCurrentSessionId(newId)
    setInput('')
    setPostLinkPreview(null)
    setPostLinkPreviewLoading(false)
    setDismissedPostPreviewId(null)
    setAssistant(null)
    resetComposerExtras()
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false)
    }

    // Supabaseにセッションを挿入
    try {
      await supabase.from('chat_sessions').insert({
        id: newId,
        user_id: user.id,
        title: '新しいチャット',
        messages: [],
        updated_at: now
      })
    } catch (error) {
      console.error('セッション作成エラー:', error)
    }
  }

  const selectSession = (id: string) => {
    setCurrentSessionId(id)
    resetComposerExtras()
    const meta = sessionMeta[id]
    setAssistant(findAssistant(uid, meta?.assistantId))
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false)
    }
  }

  const deleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const filtered = sessions.filter(s => s.id !== id)
    setSessions(filtered)
    setSessionMeta(prev => {
      const { [id]: _removed, ...rest } = prev
      saveSessionMeta(uid, rest)
      return rest
    })
    
    if (currentSessionId === id) {
      if (filtered.length > 0) {
        setCurrentSessionId(filtered[0].id)
      } else {
        const newId = crypto.randomUUID()
        const now = Date.now()
        setSessions([{
          id: newId,
          title: '新しいチャット',
          messages: [],
          updatedAt: now
        }])
        setCurrentSessionId(newId)

        if (user) {
          try {
            await supabase.from('chat_sessions').insert({
              id: newId,
              user_id: user.id,
              title: '新しいチャット',
              messages: [],
              updated_at: now
            })
          } catch (error) {
            console.error('デフォルトセッション作成エラー:', error)
          }
        }
      }
    }

    // Supabaseからセッションを削除
    try {
      await supabase.from('chat_sessions').delete().eq('id', id)
    } catch (error) {
      console.error('セッション削除エラー:', error)
    }
  }

  const renameSession = async (id: string, title: string) => {
    const nextTitle = title.trim()
    if (!nextTitle) return
    setSessions(prev => prev.map(s => (s.id === id ? { ...s, title: nextTitle } : s)))
    try {
      await supabase.from('chat_sessions').update({ title: nextTitle }).eq('id', id)
    } catch (error) {
      console.error('チャット名の変更エラー:', error)
    }
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('コピーしました')
  }

  const handleSpeak = (messageId: string, text: string) => {
    if ('speechSynthesis' in window) {
      if (speakingMessageId === messageId) {
        window.speechSynthesis.cancel()
        setSpeakingMessageId(null)
      } else {
        window.speechSynthesis.cancel()
        // コードブロックやMarkdown記号は読み上げない
        const utterance = new SpeechSynthesisUtterance(stripMarkdown(text))
        utterance.lang = 'ja-JP'
        
        utterance.onend = () => {
          setSpeakingMessageId(null)
        }
        utterance.onerror = () => {
          setSpeakingMessageId(null)
        }
        
        setSpeakingMessageId(messageId)
        window.speechSynthesis.speak(utterance)
      }
    } else {
      toast.error('お使いのブラウザは音声読み上げに対応していません')
    }
  }

  const handleShare = async (text: string) => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'LimeAIの回答',
          text: text,
        })
      } catch (err) {
        console.error(err)
      }
    } else {
      handleCopy(text)
      toast.success('共有リンクの代わりにテキストをコピーしました')
    }
  }

  const handleExportMarkdown = () => {
    const title = currentSession?.title || 'chat'
    const md =
      `# ${title}\n\n` +
      messages
        .map((m) => `## ${m.role === 'user' ? 'You' : 'LimeAI'}\n\n${m.content}\n`)
        .join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }))
    a.download = `${title.replace(/[\\/:*?"<>|]/g, '_')}.md`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  /* ---------- 添付ファイル(ドラッグ&ドロップ・貼り付け) ---------- */

  const addFiles = async (files: FileList | File[]) => {
    setAttachError('')
    for (const file of Array.from(files)) {
      setAttachLoading(n => n + 1)
      try {
        const attachment = await fileToAttachment(file)
        setPendingAttachments(prev => [...prev, attachment].slice(0, 8))
      } catch (error) {
        setAttachError(error instanceof Error ? error.message : String(error))
      } finally {
        setAttachLoading(n => n - 1)
      }
    }
  }

  /* ---------- AIへのリクエスト(送信・再生成・編集して再送信で共通) ---------- */

  const runAssistant = async (updatedMessages: Message[], sessionId: string, sessionTitle: string) => {
    const model = selectedModel
    const ac = new AbortController()
    abortRef.current = ac
    lastArtifactCountRef.current = 0

    setIsLoading(true)
    setAssistantStreamStatus('thinking')

    const assistantMessageId = crypto.randomUUID()

    const patchAssistant = (patch: Partial<Message>) => {
      setSessions(prev => prev.map(s => s.id === sessionId
        ? { ...s, messages: s.messages.map(m => m.id === assistantMessageId ? { ...m, ...patch } : m) }
        : s
      ))
    }

    setSessions(prev => prev.map(s => {
      if (s.id === sessionId) {
        return {
          ...s,
          messages: [...updatedMessages, {
            id: assistantMessageId,
            role: 'assistant' as const,
            content: '',
            ...(model === 'advanced' ? {
              thinking: {
                summary: '',
                steps: [],
                activeLabel: '検討を開始',
              } satisfies ThinkingTrace,
            } : {}),
          }]
        }
      }
      return s
    }))

    const contentOptions = {
      userLabel: user ? `${user.displayName} (@${user.username})` : '未ログインユーザー',
      modelLabel: model === 'advanced' ? 'LimeAI 5.5 Thinking' : 'LimeAI 5.0 Fast',
      character: assistant ? { name: assistant.name, prompt: assistant.systemPrompt } : null,
      extra: buildExtraInstructions({
        mode,
        character: !!assistant,
        userName: chatSettings.userName,
        customInstructions: chatSettings.customInstructions,
        memories: chatSettings.memoryEnabled ? memories.map(m => m.content) : [],
      }),
    }

    const hasImages = SEND_IMAGE_PARTS && updatedMessages.some(m => (m.attachments ?? []).some(a => a.kind === 'image' && a.dataUrl))
    const sanitizedContents = buildContents(updatedMessages, { ...contentOptions, withImages: SEND_IMAGE_PARTS })
    const fallbackContents = hasImages ? buildContents(updatedMessages, { ...contentOptions, withImages: false }) : undefined

    let accumulatedText = ''
    let referencedPosts: ReferencedPost[] = []
    let codingArtifact: CodingArtifact | undefined = undefined
    let thinkingSummary = ''
    let thinkingSteps: ThinkingStep[] = []
    let activeThinkingLabel = ''
    let agentAction: AgentAction | undefined = undefined
    let reasoningText = ''
    let toolSteps: ToolStep[] = []
    let toolArtifacts: ArtifactRecord[] = []
    let toolSources: Source[] = []

    // 本文の表示更新はまとめて行う(Markdown描画の負荷対策)
    let flushTimer: number | null = null
    const flushContent = () => {
      flushTimer = null
      patchAssistant({ content: accumulatedText })
    }
    const scheduleFlush = () => {
      if (flushTimer === null) flushTimer = window.setTimeout(flushContent, 40)
    }

    const handleEvent = (parsed: any) => {
      if (parsed.type === 'agent_action_request' && parsed.action?.type === 'create_post' && typeof parsed.action.content === 'string') {
        agentAction = { type: 'create_post', content: parsed.action.content, status: 'pending' }
        patchAssistant({ agentAction })
        return
      }

      if (parsed.type === 'thinking_start') {
        setAssistantStreamStatus('thinking')
        if (model === 'advanced') {
          const thinking: ThinkingTrace = {
            summary: thinkingSummary,
            steps: thinkingSteps,
            activeLabel: activeThinkingLabel || '検討を開始',
          }
          patchAssistant({ thinking })
        }
        return
      }

      if (parsed.type === 'thinking_step_start' && typeof parsed.label === 'string') {
        activeThinkingLabel = parsed.label
        const thinking: ThinkingTrace = {
          summary: thinkingSummary,
          steps: thinkingSteps,
          activeLabel: activeThinkingLabel,
        }
        patchAssistant({ thinking })
        return
      }

      if (parsed.type === 'thinking_delta' && typeof parsed.content === 'string') {
        const label = typeof parsed.label === 'string' ? parsed.label : activeThinkingLabel || '検討中'
        thinkingSteps = [...thinkingSteps, { label, content: parsed.content }]
        thinkingSummary = thinkingSteps.map(step => `【${step.label}】\n${step.content}`).join('\n\n')
        activeThinkingLabel = ''
        const thinking: ThinkingTrace = { summary: thinkingSummary, steps: thinkingSteps }
        patchAssistant({ thinking })
        return
      }

      if (parsed.type === 'web_search_start') {
        setAssistantStreamStatus('searching')
        return
      }

      if (parsed.type === 'web_search_end') {
        setAssistantStreamStatus('thinking')
        return
      }

      if (parsed.type === 'thinking_end') {
        setAssistantStreamStatus('thinking')
        return
      }

      if (parsed.type === 'conversation_summary_start') {
        setAssistantStreamStatus('summarizing')
        return
      }

      if (parsed.type === 'conversation_summary_end') {
        setAssistantStreamStatus('thinking')
        return
      }

      if (parsed.type === 'coding_artifact_start') {
        setAssistantStreamStatus('coding')
        return
      }

      if (parsed.type === 'coding_artifact') {
        const normalizedArtifact = normalizeCodingArtifact(parsed.artifact)

        if (normalizedArtifact) {
          codingArtifact = normalizedArtifact
          patchAssistant({ codingArtifact })
        }

        setAssistantStreamStatus('thinking')
        return
      }

      if (parsed.type === 'sns_search_check_start') {
        setAssistantStreamStatus('checking')
        return
      }

      if (parsed.type === 'sns_search_start') {
        setAssistantStreamStatus('searching')
        return
      }

      if (parsed.type === 'sns_search_end' || parsed.type === 'sns_search_skip' || parsed.type === 'sns_reference_posts') {
        if (parsed.type === 'sns_search_end' || parsed.type === 'sns_search_skip') {
          setAssistantStreamStatus('thinking')
        }

        const normalizedPosts = normalizeReferencedPosts(parsed.posts)

        if (normalizedPosts.length > 0) {
          referencedPosts = normalizedPosts
          patchAssistant({ references: referencedPosts })
        }

        return
      }

      // --- 統合した機能のイベント(バックエンドが送った場合に表示) ---
      if (parsed.type === 'reasoning' && typeof parsed.text === 'string') {
        reasoningText += parsed.text
        patchAssistant({ reasoning: reasoningText })
        return
      }

      if (parsed.type === 'step' && parsed.step && typeof parsed.step.id === 'string') {
        const index = toolSteps.findIndex(s => s.id === parsed.step.id)
        toolSteps = index >= 0
          ? toolSteps.map((s, i) => (i === index ? parsed.step : s))
          : [...toolSteps, parsed.step]
        patchAssistant({ steps: toolSteps })
        return
      }

      if (parsed.type === 'artifact' && parsed.artifact && typeof parsed.artifact.content === 'string') {
        toolArtifacts = [...toolArtifacts, parsed.artifact as ArtifactRecord]
        patchAssistant({ artifacts: toolArtifacts })
        setActiveArtifactId(parsed.artifact.id)
        setArtifactOpen(true)
        return
      }

      if (parsed.type === 'sources' && Array.isArray(parsed.sources)) {
        toolSources = parsed.sources as Source[]
        patchAssistant({ sources: toolSources })
        return
      }

      if (parsed.type === 'edge_error') {
        console.error('Edge Function error event:', parsed)

        if (!accumulatedText.trim()) {
          const fallbackText = typeof parsed.publicMessage === 'string' && parsed.publicMessage.trim()
            ? parsed.publicMessage.trim()
            : '検索処理中に一時的なエラーが発生しました。もう一度お試しください。'

          accumulatedText = fallbackText
          patchAssistant({ content: accumulatedText })
        }

        setAssistantStreamStatus('thinking')
        return
      }

      const text = parsed.choices?.[0]?.delta?.content || ''

      if (text) {
        accumulatedText += text
        scheduleFlush()
      }
    }

    const buildFinalAssistantMessage = (): Message => ({
      id: assistantMessageId,
      role: 'assistant',
      content: accumulatedText,
      references: referencedPosts.length > 0 ? referencedPosts : undefined,
      codingArtifact,
      thinking: thinkingSummary ? { summary: thinkingSummary, steps: thinkingSteps } : undefined,
      agentAction,
      reasoning: reasoningText || undefined,
      steps: toolSteps.length > 0 ? toolSteps : undefined,
      artifacts: toolArtifacts.length > 0 ? toolArtifacts : undefined,
      sources: toolSources.length > 0 ? toolSources : undefined,
    })

    try {
      await streamFromEdge(
        { contents: sanitizedContents, fallbackContents, model, mode, webSearch: false, signal: ac.signal },
        handleEvent,
      )

      if (flushTimer !== null) window.clearTimeout(flushTimer)
      flushContent()

      // ストリーミングが正常に完了したタイミングでSupabaseへ最終結果を保存
      await persistSession(sessionId, sessionTitle, [...updatedMessages, buildFinalAssistantMessage()], Date.now())

    } catch (error: any) {
      if (flushTimer !== null) window.clearTimeout(flushTimer)

      if (error?.name === 'AbortError') {
        // 「停止」ボタンで止めた場合: ここまでの回答を残す
        const hasPartial = accumulatedText.trim() !== '' || !!codingArtifact || toolArtifacts.length > 0
        if (hasPartial) {
          const partial = buildFinalAssistantMessage()
          patchAssistant({ content: accumulatedText, thinking: partial.thinking })
          await persistSession(sessionId, sessionTitle, [...updatedMessages, partial], Date.now())
        } else {
          setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, messages: updatedMessages } : s))
          await persistSession(sessionId, sessionTitle, updatedMessages, Date.now())
        }
      } else {
        console.error(error)
        toast.error('通信エラーが発生しました。コンソールのログを確認してください。')

        const errorMessages = [...updatedMessages, { id: assistantMessageId, role: 'assistant' as const, content: `エラーが発生しました。詳細: ${error.message}` }]
        setSessions(prev => prev.map(s => {
          if (s.id === sessionId) {
            return {
              ...s,
              messages: errorMessages
            }
          }
          return s
        }))

        // エラー出力状態もSupabaseに同期
        await persistSession(sessionId, sessionTitle, errorMessages, Date.now())
      }
    } finally {
      abortRef.current = null
      setAssistantStreamStatus('idle')
      setIsLoading(false)
    }
  }

  /** メッセージ一覧を確定(state + Supabase)してからAIに問い合わせる */
  const commitAndRun = async (updatedMessages: Message[], title: string) => {
    if (!currentSessionId) return
    const sessionId = currentSessionId
    const now = Date.now()

    setSessions(prev => prev.map(s => {
      if (s.id === sessionId) {
        return {
          ...s,
          title,
          messages: updatedMessages,
          updatedAt: now
        }
      }
      return s
    }))

    updateSessionMeta(sessionId, { mode, assistantId: assistant?.id ?? null })

    // 送信(再生成)開始時、この時点の履歴をSupabaseに反映
    try {
      await persistSession(sessionId, title, updatedMessages, now)
    } catch (error) {
      console.error(error)
    }

    await runAssistant(updatedMessages, sessionId, title)
  }

  const handleStop = () => {
    abortRef.current?.abort()
  }

  const handleRegenerate = async (targetMsgIndex: number) => {
    if (isLoading || !currentSessionId) return

    const updatedMessages = messages.slice(0, targetMsgIndex)
    await commitAndRun(updatedMessages, currentSession?.title || '新しいチャット')
  }

  const handleEditResend = async (targetMsgIndex: number, text: string) => {
    if (isLoading || !currentSessionId) return
    const target = messages[targetMsgIndex]
    const nextText = text.trim()
    if (!target || !nextText) return

    setEditingMessageId(null)
    const editedMessage: Message = { ...target, id: crypto.randomUUID(), content: nextText }
    await commitAndRun([...messages.slice(0, targetMsgIndex), editedMessage], currentSession?.title || '新しいチャット')
  }

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if ((!input.trim() && pendingAttachments.length === 0) || isLoading || attachLoading > 0 || !currentSessionId) return

    const trimmedInput = input.trim()
    const detectedPostLink = extractSupportedPostLink(trimmedInput)
    let sendingPostPreview: PostLinkPreview | undefined = undefined

    if (detectedPostLink && dismissedPostPreviewId !== detectedPostLink.id) {
      const currentPreview = postLinkPreview?.id === detectedPostLink.id ? postLinkPreview : null
      sendingPostPreview = currentPreview ?? await fetchPostLinkPreview(detectedPostLink.id, detectedPostLink.url) ?? undefined
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmedInput,
      postPreview: sendingPostPreview,
      attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined,
    }

    const updatedMessages = [...messages, userMessage]
    
    let currentTitle = currentSession?.title || '新しいチャット'
    if (messages.length === 0) {
      const titleSource = trimmedInput || pendingAttachments[0]?.name || '新しいチャット'
      currentTitle = titleSource.substring(0, 16) + (titleSource.length > 16 ? '...' : '')
    }

    setInput('')
    setPendingAttachments([])
    setAttachError('')
    setPostLinkPreview(null)
    setPostLinkPreviewLoading(false)
    setDismissedPostPreviewId(null)

    await commitAndRun(updatedMessages, currentTitle)
  }

  /** ボイスモードから呼ばれる: 1往復分の返答テキストを返す(履歴はボイスモード内のみ) */
  const askForVoice = async (text: string, signal: AbortSignal) => {
    const history = voiceHistoryRef.current
    history.push({ id: crypto.randomUUID(), role: 'user', content: text })

    const contents = buildContents(history.slice(-20), {
      userLabel: user ? `${user.displayName} (@${user.username})` : '未ログインユーザー',
      modelLabel: 'LimeAI 5.0 Fast',
      extra: buildExtraInstructions({
        mode: 'chat',
        voice: true,
        userName: chatSettings.userName,
        customInstructions: chatSettings.customInstructions,
        memories: chatSettings.memoryEnabled ? memories.map(m => m.content) : [],
      }),
      withImages: false,
    })

    let reply = ''
    await streamFromEdge({ contents, model: 'fast', mode: 'chat', webSearch: false, signal }, (parsed) => {
      if (parsed.type === 'edge_error') {
        if (!reply.trim()) {
          reply = typeof parsed.publicMessage === 'string' && parsed.publicMessage.trim()
            ? parsed.publicMessage.trim()
            : '一時的なエラーが発生しました。もう一度お試しください。'
        }
        return
      }
      const chunk = parsed.choices?.[0]?.delta?.content || ''
      if (chunk) reply += chunk
    })

    if (reply.trim()) history.push({ id: crypto.randomUUID(), role: 'assistant', content: reply })
    return reply
  }

  const openVoiceMode = () => {
    voiceHistoryRef.current = []
    setVoiceOpen(true)
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setIsSidebarOpen(false)
    }
  }

  /** アシスタント専用の通話モードから呼ばれる: アシスタント設定つきで1往復分の返答テキストを返す(履歴は通話中のみ) */
  /** アシスタント専用の通話モードから呼ばれる: キャラクター設定つきで1往復分の返答テキストを返す(履歴は通話中のみ) */
  const askForAssistantCall = async (text: string, signal: AbortSignal) => {
    const character = callAssistantRef.current ?? assistant
    const history = callHistoryRef.current
    history.push({ id: crypto.randomUUID(), role: 'user', content: text })

    const contents = buildContents(history.slice(-20), {
      userLabel: user ? `${user.displayName} (@${user.username})` : '未ログインユーザー',
      modelLabel: 'LimeAI 5.0 Fast',
      character: character ? { name: character.name, prompt: character.systemPrompt } : null,
      extra: buildExtraInstructions({
        mode: 'chat',
        character: true,
        call: true,
        userName: chatSettings.userName,
        customInstructions: chatSettings.customInstructions,
        memories: chatSettings.memoryEnabled ? memories.map(m => m.content) : [],
      }),
      withImages: false,
    })

    let reply = ''
    await streamFromEdge({ contents, model: 'fast', mode: 'chat', webSearch: false, signal }, (parsed) => {
      if (parsed.type === 'edge_error') {
        if (!reply.trim()) {
          reply = typeof parsed.publicMessage === 'string' && parsed.publicMessage.trim()
            ? parsed.publicMessage.trim()
            : '一時的なエラーが発生しました。もう一度お試しください。'
        }
        return
      }
      const chunk = parsed.choices?.[0]?.delta?.content || ''
      if (chunk) reply += chunk
    })

    if (reply.trim()) history.push({ id: crypto.randomUUID(), role: 'assistant', content: reply })
    return reply
  }

  /** アシスタントに発信する */
  const openAssistantCall = (targetAssistant?: AssistantItem | null) => {
    const nextAssistant = targetAssistant ?? assistant
    if (!nextAssistant) return

    // iOS Safari を含むブラウザでは、ユーザー操作の中で一度音声合成を動かしておくと、
    // その後の読み上げが無音になりにくい。PCでも同じ手順を安全に共通化する。
    try {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel()
        const unlock = new SpeechSynthesisUtterance(' ')
        unlock.volume = 0
        window.speechSynthesis.speak(unlock)
      }
    } catch {
      /* ignore */
    }

    setAssistant(nextAssistant)
    setSpeakingMessageId(null)
    callAssistantRef.current = nextAssistant
    // 電話に出たときの第一声を履歴の先頭に入れておき、AIも「自分は挨拶済み」だと分かるようにする
    callHistoryRef.current = [{ id: crypto.randomUUID(), role: 'assistant', content: greetingOf(nextAssistant) }]
    setCallOpen(true)
    setIsSidebarOpen(false)
  }

  const applyAssistantPreset = (item: AssistantItem) => {
    setAssistant(item)
    setInput(item.starter || '')
    setView('chat')
    setTimeout(() => {
      const el = composerRef.current
      el?.focus()
      el?.setSelectionRange(el.value.length, el.value.length)
    }, 80)
  }

  const openArtifact = useCallback((artifact: Artifact) => {
    setActiveArtifactId(artifact.id)
    setArtifactOpen(true)
  }, [])

  // サイドバーに表示するチャット一覧(検索・ピン留め・日付グループ)
  const sessionGroups = useMemo(() => {
    const q = sessionQuery.trim().toLowerCase()
    const filtered = q
      ? sessions.filter(s =>
          s.title.toLowerCase().includes(q) ||
          s.messages.some(m => m.content.toLowerCase().includes(q)))
      : sessions

    const groups = new Map<string, ChatSession[]>()
    for (const s of filtered) {
      const group = sessionMeta[s.id]?.pinned ? 'ピン留め' : groupOfSession(Number(s.updatedAt))
      groups.set(group, [...(groups.get(group) || []), s])
    }
    return SESSION_GROUP_ORDER.filter(g => groups.has(g)).map(g => [g, groups.get(g)!] as const)
  }, [sessions, sessionQuery, sessionMeta])

  return (
    <div
      className={`vpop-root fixed left-0 right-0 w-full text-[#333a42] dark:text-[#e4e7ea] overflow-hidden flex z-40 ${
        isKeyboardOpen
          ? 'top-0 bottom-auto'
          : 'inset-0 top-0 md:top-16 bottom-[60px] md:bottom-0'
      }`}
      style={isKeyboardOpen && viewportHeight ? { height: `${viewportHeight}px`, bottom: 'auto' } : undefined}
    >
      <style>{VPOP_STYLES}</style>
      <style>{CHAT_EXT_STYLES}</style>

      {/* 背景：シルバー×ライトブルーのグラデーション＋配信枠風の飾り */}
      <div className="vpop-bg" aria-hidden="true">
        <span className="vpop-blob vpop-blob-1" />
        <span className="vpop-blob vpop-blob-2" />
        <span className="vpop-blob vpop-blob-3" />
        <span className="vpop-frame" />
        <span className="vpop-corner vpop-corner-tl" />
        <span className="vpop-corner vpop-corner-tr" />
        <span className="vpop-corner vpop-corner-bl" />
        <span className="vpop-corner vpop-corner-br" />
        <span className="vpop-scan" />
        <span className="vpop-grain" />
        <span className="vpop-float" style={{ left: '6%', top: '18%', animationDelay: '0s' }}>✦︎</span>
        <span className="vpop-float" style={{ left: '22%', top: '72%', animationDelay: '1.4s' }}>.ᐟ</span>
        <span className="vpop-float" style={{ left: '48%', top: '12%', animationDelay: '2.6s' }}>♪</span>
        <span className="vpop-float" style={{ left: '74%', top: '62%', animationDelay: '0.8s' }}>✧</span>
        <span className="vpop-float" style={{ left: '88%', top: '26%', animationDelay: '3.2s' }}>✦︎</span>
        <span className="vpop-float" style={{ left: '36%', top: '44%', animationDelay: '4.1s' }}>.ᐟ.ᐟ</span>
        <span className="vpop-float" style={{ left: '62%', top: '86%', animationDelay: '2.0s' }}>♪</span>
      </div>


      {/* サイドバー */}
      <div className={`${
        isSidebarOpen 
          ? 'w-full md:w-64 opacity-100 visible duration-250 ease-[cubic-bezier(0.25,1,0.5,1)]' 
          : 'w-0 opacity-0 invisible duration-300 ease-[cubic-bezier(0.3,0,0,1)]'
      } shrink-0 bg-white/95 dark:bg-[#12161b] flex flex-col h-full border-r border-[#dfe3e8] dark:border-[#252b33] transition-all overflow-hidden absolute md:relative z-50 md:z-auto`}>
        <div className="w-full md:w-64 flex flex-col h-full shrink-0">
          <div className="p-3.5 flex items-center justify-between gap-2">
            <button
              onClick={createNewSession}
              className="flex-1 flex items-center justify-between px-3 py-2.5 rounded-2xl bg-[#f7f8f9] hover:bg-[#e2e6ea]/55 dark:bg-transparent dark:hover:bg-[#1c2128] transition duration-200 text-sm font-semibold text-[#333a42] dark:text-[#e4e7ea] border border-[#bfe3f7] dark:border-[#252b33]"
            >
              <span className="flex items-center gap-2">
                <Plus className="w-4 h-4 text-[#4fb3e8] dark:text-[#e4e7ea]" /> 新しいチャット
              </span>
            </button>

            <button
              onClick={() => setIsSidebarOpen(false)}
              className="md:hidden p-2.5 rounded-2xl hover:bg-[#e2e6ea]/55 dark:hover:bg-[#1c2128] text-[#69707a] dark:text-[#a8b0ba] hover:text-[#333a42] dark:hover:text-[#e4e7ea] transition shrink-0"
            >
              <PanelLeftClose className="w-5 h-5" />
            </button>

            <button
              onClick={() => setIsSidebarOpen(false)}
              className="hidden md:block p-2.5 rounded-2xl hover:bg-[#e2e6ea]/55 dark:hover:bg-[#1c2128] text-[#69707a] dark:text-[#a8b0ba] hover:text-[#333a42] dark:hover:text-[#e4e7ea] transition shrink-0"
            >
              <PanelLeftClose className="w-5 h-5" />
            </button>
          </div>

          {/* アシスタント / ボイスモード / 履歴検索 */}
          <div className="px-3.5 pb-2 space-y-1">
            <button
              type="button"
              onClick={() => {
                setView('assistants')
                if (window.innerWidth < 768) setIsSidebarOpen(false)
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-2xl text-sm font-medium text-[#333a42] dark:text-[#e4e7ea] hover:bg-[#e2e6ea]/55 dark:hover:bg-[#1c2128] transition ${
                view === 'assistants' ? 'bg-[#e2e6ea] dark:bg-[#1c2128]' : ''
              }`}
            >
              <Sparkles className="w-4 h-4 text-[#4fb3e8]" />
              フレンド
            </button>
            <button
              type="button"
              onClick={openVoiceMode}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-2xl text-sm font-medium text-[#333a42] dark:text-[#e4e7ea] hover:bg-[#e2e6ea]/55 dark:hover:bg-[#1c2128] transition"
            >
              <AudioLines className="w-4 h-4 text-[#4fb3e8]" />
              ボイスモード
            </button>
            <div className="relative pt-1">
              <Search className="absolute left-3 top-1/2 mt-0.5 -translate-y-1/2 h-3.5 w-3.5 text-[#a8b0ba]" />
              <input
                value={sessionQuery}
                onChange={(e) => setSessionQuery(e.target.value)}
                placeholder="履歴を検索"
                className="h-9 w-full rounded-2xl bg-[#e4e7eb]/70 dark:bg-[#1e242b] pl-9 pr-8 text-sm text-[#333a42] dark:text-[#e4e7ea] outline-none placeholder:text-[#a8b0ba] focus:ring-1 focus:ring-[#4fb3e8]/40"
              />
              {sessionQuery && (
                <button
                  type="button"
                  aria-label="クリア"
                  onClick={() => setSessionQuery('')}
                  className="absolute right-2.5 top-1/2 mt-0.5 -translate-y-1/2 text-[#a8b0ba] hover:text-[#333a42] dark:hover:text-[#e4e7ea]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 space-y-1 custom-scrollbar">
            <div className="py-2 text-xs font-semibold text-[#8b929b] dark:text-[#a8b0ba] sticky top-0 bg-white/95 dark:bg-[#12161b] z-10">
              チャット履歴
            </div>
            {sessionGroups.length === 0 && (
              <div className="px-3 py-6 text-center text-[13px] text-[#a8b0ba]">
                {sessionQuery ? '一致するチャットはありません' : 'チャット履歴はここに表示されます'}
              </div>
            )}
            {sessionGroups.map(([groupName, items]) => (
              <div key={groupName} className="space-y-1">
                {(sessionGroups.length > 1 || groupName === 'ピン留め') && (
                  <div className="px-3 pt-2 pb-0.5 text-[11px] font-semibold text-[#a8b0ba] dark:text-[#7e868f]">{groupName}</div>
                )}
                {items.map((s) => (
                  renamingSessionId === s.id ? (
                    <div key={s.id} className="flex items-center gap-1 rounded-2xl bg-[#e2e6ea]/55 dark:bg-[#1c2128] px-3 py-2">
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                            renameSession(s.id, renameDraft)
                            setRenamingSessionId(null)
                          }
                          if (e.key === 'Escape') setRenamingSessionId(null)
                        }}
                        className="min-w-0 flex-1 bg-transparent text-sm text-[#333a42] dark:text-[#e4e7ea] outline-none"
                      />
                      <button
                        type="button"
                        aria-label="確定"
                        onClick={() => {
                          renameSession(s.id, renameDraft)
                          setRenamingSessionId(null)
                        }}
                      >
                        <Check className="h-4 w-4 text-[#3aa5e0]" />
                      </button>
                    </div>
                  ) : (
                    <div
                      key={s.id}
                      onClick={() => selectSession(s.id)}
                      className={`vpop-card group flex items-center justify-between px-3 py-2.5 rounded-2xl cursor-pointer text-sm transition duration-150 ${
                        s.id === currentSessionId && view === 'chat'
                          ? 'bg-[#e2e6ea] dark:bg-[#1c2128] text-[#333a42] dark:text-[#e4e7ea] font-bold border-l-4 border-[#3aa5e0] shadow-[0_6px_16px_-10px_rgba(58,165,224,0.9)]' 
                          : 'text-[#333a42]/90 dark:text-[#e4e7ea] hover:bg-[#e2e6ea]/45 dark:hover:bg-[#1c2128]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        {sessionMeta[s.id]?.pinned
                          ? <Pin className="w-4 h-4 shrink-0 text-[#4fb3e8] dark:text-[#e4e7ea]" />
                          : <MessageSquare className="w-4 h-4 shrink-0 opacity-60 text-[#4fb3e8] dark:text-[#e4e7ea]" />}
                        <span className="truncate">{s.title}</span>
                      </div>
                      <div className="flex items-center shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            updateSessionMeta(s.id, { pinned: !sessionMeta[s.id]?.pinned })
                          }}
                          title={sessionMeta[s.id]?.pinned ? 'ピン留め解除' : 'ピン留め'}
                          className="opacity-100 md:opacity-0 group-hover:opacity-100 p-1 hover:bg-white/70 dark:hover:bg-[#1e242b] rounded text-[#333a42] dark:text-[#e4e7ea] transition"
                        >
                          {sessionMeta[s.id]?.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setRenameDraft(s.title)
                            setRenamingSessionId(s.id)
                          }}
                          title="名前を変更"
                          className="opacity-100 md:opacity-0 group-hover:opacity-100 p-1 hover:bg-white/70 dark:hover:bg-[#1e242b] rounded text-[#333a42] dark:text-[#e4e7ea] transition"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => deleteSession(s.id, e)}
                          className="opacity-100 md:opacity-0 group-hover:opacity-100 p-1 hover:bg-white/70 dark:hover:bg-[#1e242b] rounded text-[#333a42] dark:text-[#e4e7ea] hover:text-red-500 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )
                ))}
              </div>
            ))}
          </div>

          {user && (
            <div className="p-3 border-t border-[#dfe3e8] dark:border-[#252b33] bg-white/95 dark:bg-[#12161b] flex items-center gap-3">
              <Avatar className="h-8 w-8">
                <AvatarImage src={user.avatarUrl} />
                <AvatarFallback className="bg-[#e2e6ea] dark:bg-[#1e242b] text-[#4fb3e8] dark:text-[#e4e7ea] font-semibold">{user.displayName?.slice(0, 1)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-[#333a42] dark:text-[#e4e7ea] truncate leading-tight">{user.displayName}</div>
                <div className="text-xs text-[#69707a] dark:text-[#a8b0ba] truncate leading-none mt-0.5">@{user.username}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {isSidebarOpen && (
        <div 
          className="fixed inset-0 top-0 bottom-[60px] md:bottom-0 bg-black/20 dark:bg-black/40 z-40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* メインエリア */}
      <div className="flex flex-col flex-1 h-full bg-transparent relative min-w-0 w-full">
        
        {/* ヘッダーエリア */}
        <div className="flex items-center h-12 md:h-16 px-2 md:px-5 w-full shrink-0 z-30">
          
          {!isSidebarOpen && (
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 md:p-2.5 mr-1 md:mr-2 rounded-2xl hover:bg-[#e2e6ea]/55 dark:hover:bg-[#1c2128] text-[#69707a] dark:text-[#a8b0ba] hover:text-[#333a42] dark:hover:text-[#e4e7ea] transition"
            >
              <PanelLeft className="w-4 h-4 md:w-5 md:h-5" />
            </button>
          )}

          <div className={`${messages.length > 0 ? 'hidden md:block' : 'block'} relative`}>
            <button
              onClick={() => setIsModelSelectorOpen(!isModelSelectorOpen)}
              className="vpop-title flex items-center gap-2 text-lg md:text-2xl text-[#3aa5e0] dark:text-[#86c9ee] hover:bg-[#e2e6ea]/60 dark:hover:bg-[#1c2128] px-2 md:px-3 py-1.5 md:py-2 rounded-[1.75rem] transition"
            >
              <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-gradient-to-br from-[#ffd166] to-[#4fb3e8] shadow-[0_4px_12px_-4px_rgba(58,165,224,0.8)]">
                <Sparkles className="w-4 h-4 text-white" />
              </span>
              LimeAI
              <ChevronDown className="w-4 h-4 md:w-5 md:h-5 text-[#69707a] dark:text-[#a8b0ba]" />
            </button>

            {isModelSelectorOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setIsModelSelectorOpen(false)}
                />

                <div className="absolute top-full left-0 mt-2 w-64 md:w-[320px] bg-white dark:bg-[#1c2128] rounded-[1.75rem] border border-[#dfe3e8] dark:border-[#252b33] p-2 md:p-3 flex flex-col z-50 animate-in fade-in zoom-in-95 duration-100">

                  <div className="text-[11px] md:text-xs font-semibold text-[#69707a] dark:text-[#a8b0ba] mb-2 px-2">
                    AIモードを選択
                  </div>

                  <button
                    onClick={() => {
                      setSelectedModel('fast');
                      setIsModelSelectorOpen(false);
                    }}
                    className={`flex items-center justify-between p-2.5 md:p-3 rounded-2xl transition text-left ${
                      selectedModel === 'fast'
                        ? 'bg-[#e4e7eb]/70 dark:bg-[#1e242b]/60'
                        : 'hover:bg-[#e4e7ea]/50 dark:hover:bg-[#1e242b]/50'
                    }`}
                  >
                    <div className="flex flex-col">
                      <span className="text-sm md:text-[15px] font-medium text-[#2e343b] dark:text-[#e4e7ea]">
                        LimeAI 5.0 Fast
                      </span>
                      <span className="text-[10px] md:text-xs text-[#69707a] dark:text-[#a8b0ba] mt-0.5">
                        普段の会話向け
                      </span>
                    </div>

                    {selectedModel === 'fast' && (
                      <Check className="w-4 h-4 md:w-5 md:h-5 text-[#2e343b] dark:text-[#e4e7ea]" />
                    )}
                  </button>

                  <button
                    onClick={() => {
                      if (hasLimePro) {
                        setSelectedModel('advanced');
                        setIsModelSelectorOpen(false);
                      } else {
                        window.location.href = '/RaimuNoteSNS.github.io/LimePro';
                      }
                    }}
                    className={`flex items-center justify-between p-2.5 md:p-3 rounded-2xl transition text-left mt-1 ${
                      selectedModel === 'advanced'
                        ? 'bg-[#e4e7eb]/70 dark:bg-[#1e242b]/60'
                        : 'hover:bg-[#e4e7ea]/50 dark:hover:bg-[#1e242b]/50'
                    }`}
                  >
                    <div className="flex flex-col">
                      <span className="text-sm md:text-[15px] font-medium text-[#2e343b] dark:text-[#e4e7ea]">
                        LimeAI 5.5 Thinking
                      </span>
                      <span className="text-[10px] md:text-xs text-[#69707a] dark:text-[#a8b0ba] mt-0.5">
                        詳しい回答向け
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {!hasLimePro && (
                        <span className="px-4 py-1.5 text-[12px] font-medium text-[#1e40af] dark:text-[#93c5fd] border border-[#d9dde3] dark:border-[#2c333c] rounded-full">
                          アップグレード
                        </span>
                      )}
                      {selectedModel === 'advanced' && (
                        <Check className="w-4 h-4 md:w-5 md:h-5 text-[#2e343b] dark:text-[#e4e7ea]" />
                      )}
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="flex-1 min-w-0" />

          {/* ヘッダー右側: エクスポート / ボイスモード / プレビューパネル */}
          {view === 'chat' && messages.length > 0 && (
            <button
              type="button"
              onClick={handleExportMarkdown}
              title="Markdownでエクスポート"
              aria-label="エクスポート"
              className="p-2 md:p-2.5 rounded-2xl hover:bg-[#e2e6ea]/55 dark:hover:bg-[#1c2128] text-[#69707a] dark:text-[#a8b0ba] hover:text-[#333a42] dark:hover:text-[#e4e7ea] transition"
            >
              <Download className="w-4 h-4 md:w-5 md:h-5" />
            </button>
          )}
          <button
            type="button"
            onClick={openVoiceMode}
            title="ボイスモード"
            aria-label="ボイスモード"
            className="p-2 md:p-2.5 rounded-2xl hover:bg-[#e2e6ea]/55 dark:hover:bg-[#1c2128] text-[#69707a] dark:text-[#a8b0ba] hover:text-[#3aa5e0] dark:hover:text-[#86c9ee] transition"
          >
            <AudioLines className="w-4 h-4 md:w-5 md:h-5" />
          </button>
          {artifacts.length > 0 && view === 'chat' && (
            <button
              type="button"
              onClick={() => setArtifactOpen(!artifactOpen)}
              title="プレビューパネル"
              aria-label="プレビューパネル"
              className={`p-2 md:p-2.5 rounded-2xl hover:bg-[#e2e6ea]/55 dark:hover:bg-[#1c2128] transition ${
                artifactOpen ? 'text-[#3aa5e0] dark:text-[#86c9ee]' : 'text-[#69707a] dark:text-[#a8b0ba]'
              }`}
            >
              <PanelRight className="w-4 h-4 md:w-5 md:h-5" />
            </button>
          )}
        </div>

        {/* タイムライン */}
        <div className="flex-1 overflow-y-auto custom-scrollbar bg-transparent">
          {view === 'assistants' ? (
            <AssistantsView
              uid={uid}
              avatars={avatars}
              onUse={applyAssistantPreset}
              onCall={openAssistantCall}
              onChanged={refreshAssistant}
              onAvatarChange={changeAssistantAvatar}
            />
          ) : messages.length === 0 ? (
            <div className="min-h-full flex flex-col items-center justify-center text-center max-w-xl mx-auto space-y-5 px-4 pt-2 pb-20">
              {assistant ? (
                <>
                  <div className="vpop-standee">
                    <AssistantAvatar
                      item={assistant}
                      avatars={avatars}
                      className="vpop-mascot h-24 w-24 border-[3px] border-[#bfe3f7] dark:border-[#4fb3e8]/70"
                    />
                  </div>
                  <h2 className="vpop-title text-[28px] md:text-[34px] leading-tight">{assistant.name}</h2>
                  <p className="vpop-greet text-[15px] leading-relaxed">{assistant.description}</p>
                </>
              ) : (
                <>
                  <div className="vpop-standee">
                    <div className="vpop-mascot w-24 h-24 flex items-center justify-center rounded-full border-[3px] border-[#bfe3f7] dark:border-[#4fb3e8]/70 bg-white/80 dark:bg-[#1c2128]">
                      <Sparkles className="w-9 h-9 text-[#4fb3e8] dark:text-[#86c9ee]" />
                    </div>
                  </div>
                  <h2 className="vpop-title text-[34px] md:text-[42px] leading-none">
                    <span className="vpop-mark">✦︎</span> LimeAI <span className="vpop-mark">✦︎</span>
                  </h2>
                  <p className="vpop-greet text-[17px] leading-relaxed">
                    <span className="vpop-greet-strong">LimeAI 5.5 Thinking</span>登場
                    <span className="vpop-mark"> .ᐟ.ᐟ</span>
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="w-full pb-4">
              {messages.map((msg, msgIndex) => {
                const isUser = msg.role === 'user'
                const isStreaming = streamingMessageId === msg.id
                const visibleMessageContent = msg.postPreview ? removeSupportedPostLinksFromText(msg.content) : msg.content
                return (
                  <div
                    key={msg.id}
                    className="vpop-in w-full py-4 md:py-5 flex justify-center bg-transparent transition-colors duration-150"
                  >
                    <div className="max-w-3xl w-full flex gap-4 px-4 sm:px-6">
                      <div className="shrink-0 mt-0.5">
                        {isUser ? (
                          <Avatar className="h-9 w-9 border-2 border-white shadow-[0_4px_12px_-4px_rgba(58,165,224,0.6)] dark:border-[#4fb3e8]/60">
                            <AvatarImage src={user?.avatarUrl} />
                            <AvatarFallback className="bg-[#e4e7eb] dark:bg-[#252b33]"><User className="w-4 h-4 text-[#333a42] dark:text-[#e4e7ea]" /></AvatarFallback>
                          </Avatar>
                        ) : assistant ? (
                          <AssistantAvatar
                            item={assistant}
                            avatars={avatars}
                            className="h-9 w-9 border-2 border-white shadow-[0_4px_12px_-4px_rgba(58,165,224,0.6)] dark:border-[#86c9ee]/60"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full flex items-center justify-center border-2 border-white bg-gradient-to-br from-[#a8d8f4] to-[#4fb3e8] shadow-[0_4px_14px_-4px_rgba(58,165,224,0.75)] dark:border-[#86c9ee]/60">
                            <Sparkles className="w-4 h-4 text-white" />
                          </div>
                        )}
                      </div>

                      <div className="group flex-1 space-y-1.5 md:max-w-2xl lg:max-w-3xl min-w-0">
                        <div className={`text-[14px] font-bold tracking-wide ${isUser ? 'text-[#333a42] dark:text-[#e4e7ea]' : 'text-[#3aa5e0] dark:text-[#86c9ee]'}`}>
                          {isUser ? 'あなた' : (assistant?.name ?? 'LimeAI')}
                          {!isUser && !assistant && <span className="ml-1 text-[#ffb845]">✧</span>}
                        </div>
                        {isUser && msg.attachments && msg.attachments.length > 0 && (
                          <AttachmentChips items={msg.attachments} />
                        )}
                        {isUser && editingMessageId === msg.id ? (
                          <div className="w-full rounded-[1.5rem] border-2 border-[#bfe3f7] dark:border-[#2c333c] bg-white/95 dark:bg-[#1a1f26] p-3">
                            <textarea
                              value={editDraft}
                              onChange={(e) => setEditDraft(e.target.value)}
                              className="min-h-[80px] w-full resize-y bg-transparent text-[15.5px] leading-relaxed text-[#2e343b] dark:text-[#e4e7ea] outline-none"
                              autoFocus
                            />
                            <div className="mt-2 flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setEditingMessageId(null)}
                                className="rounded-full px-3.5 py-1.5 text-sm text-[#69707a] dark:text-[#a8b0ba] hover:bg-[#e2e6ea]/55 dark:hover:bg-[#1c2128]"
                              >
                                キャンセル
                              </button>
                              <button
                                type="button"
                                disabled={!editDraft.trim() || isLoading}
                                onClick={() => handleEditResend(msgIndex, editDraft)}
                                className="rounded-full bg-[#3aa5e0] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
                              >
                                送信
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className={`text-[16px] leading-7 whitespace-pre-wrap break-words ${
                            isUser
                              ? 'inline-block max-w-full rounded-[1.5rem] rounded-tr-md bg-[#3aa5e0] px-4 py-2.5 text-white shadow-[0_8px_20px_-8px_rgba(58,165,224,0.7)]'
                              : 'text-[#333a42] dark:text-[#e4e7ea]'
                          } ${isUser && !visibleMessageContent && !msg.postPreview ? 'hidden' : ''}`}>
                            {!isUser && (msg.reasoning || (msg.steps && msg.steps.length > 0)) && (
                              <>
                                <Reasoning text={msg.reasoning || ''} streaming={isStreaming} hasAnswer={msg.content.trim().length > 0} />
                                <StepList steps={msg.steps || []} streaming={isStreaming} />
                              </>
                            )}
                            {msg.content === '' && isLoading ? (
                              <>
                                {!isUser && msg.thinking && (
                                  <ThinkingSummaryCard
                                    trace={msg.thinking}
                                    expanded={expandedThinkingMessageId === msg.id || (isLoading && selectedModel === 'advanced' && msg.content === '')}
                                    onToggle={() => setExpandedThinkingMessageId(expandedThinkingMessageId === msg.id ? null : msg.id)}
                                  />
                                )}
                                <span className="vpop-thinking flex items-center gap-2 text-[#8b929b] dark:text-[#86c9ee] text-[15px] font-semibold">
                                  <span className="flex items-center gap-[3px] text-[13px] font-black">
                                    <span className="vpop-spark">✦︎</span>
                                    <span className="vpop-spark">✦︎</span>
                                    <span className="vpop-spark">✦︎</span>
                                  </span>
                                  {assistantStreamStatus === 'checking' ? '検索ツール開いてる〜？' : assistantStreamStatus === 'searching' ? '検索中.ᐟ.ᐟ' : assistantStreamStatus === 'coding' ? 'コード書いてる.ᐟ.ᐟ' : assistantStreamStatus === 'summarizing' ? 'お話まとめてる〜？' : selectedModel === 'advanced' ? 'なるほど…検討中.ᐟ.ᐟ' : 'なるほど….ᐟ.ᐟ'}
                                </span>
                              </>
                            ) : (
                              <>
                                {!isUser && msg.thinking && (
                                  <ThinkingSummaryCard
                                    trace={msg.thinking}
                                    expanded={expandedThinkingMessageId === msg.id}
                                    onToggle={() => setExpandedThinkingMessageId(expandedThinkingMessageId === msg.id ? null : msg.id)}
                                  />
                                )}
                                {visibleMessageContent && (
                                  isUser ? (
                                    <span>{visibleMessageContent}</span>
                                  ) : (
                                    <div className={isStreaming ? 'caret' : ''}>
                                      <MessageMarkdown
                                        messageId={msg.id}
                                        content={visibleMessageContent}
                                        sources={msg.sources}
                                        activeArtifactId={activeArtifactId}
                                        streaming={isStreaming}
                                        onOpenArtifact={openArtifact}
                                      />
                                    </div>
                                  )
                                )}
                                {!isUser && msg.agentAction && (
                                  <AgentPostApprovalCard
                                    action={msg.agentAction}
                                    onApprove={() => handleAgentPostApproval(msg.id, msg.agentAction!)}
                                    onCancel={() => updateAgentActionStatus(msg.id, 'cancelled')}
                                  />
                                )}
                                {msg.postPreview && (
                                  <MiniPostPreviewCard post={msg.postPreview} compact />
                                )}
                                {!isUser && msg.references && msg.references.length > 0 && (
                                  <div className="mt-3 whitespace-normal">
                                    <button
                                      type="button"
                                      onClick={() => setExpandedReferenceMessageId(expandedReferenceMessageId === msg.id ? null : msg.id)}
                                      className="inline-flex items-center gap-2 rounded-full border border-[#333a42]/15 dark:border-[#2c333c] bg-white/75 dark:bg-[#12161b] px-2.5 py-1.5 text-[#333a42] dark:text-[#e4e7ea] hover:bg-[#e2e6ea]/35 dark:hover:bg-[#1c2128] transition"
                                      title="参照した公開ポストを表示"
                                    >
                                      <ReferencePostsButtonAvatars posts={msg.references} />
                                      <span className="text-[13px] md:text-sm font-semibold">
                                        {msg.references.length}件のポスト
                                      </span>
                                    </button>

                                    {expandedReferenceMessageId === msg.id && (
                                      <div className="mt-2 space-y-2 max-w-xl">
                                        {msg.references.map((post) => (
                                          <div
                                            key={post.id}
                                            className="rounded-[1.75rem] border border-[#dfe3e8] dark:border-[#252b33] bg-white/85 dark:bg-[#141920] p-3 text-sm leading-6 text-[#333a42] dark:text-[#e4e7ea]"
                                          >
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                              <div className="font-semibold truncate">
                                                {post.authorDisplayName} (@{post.authorUsername}){post.authorIsOfficial ? ' / 公式' : ''}
                                              </div>
                                              <div className="text-xs text-[#8b929b] dark:text-[#a8b0ba] shrink-0">
                                                {formatRelative(post.createdAt)}
                                              </div>
                                            </div>
                                            <div className="mt-1 text-[#333a42]/90 dark:text-[#e4e7ea]/90 break-words">
                                              {post.contentSnippet}
                                            </div>
                                            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#69707a] dark:text-[#a8b0ba]">
                                              <span>いいね {post.likesCount}</span>
                                              <span>リポスト {post.repostsCount}</span>
                                              <span>コメント {post.commentsCount}</span>
                                              {post.imageCount > 0 && <span>画像 {post.imageCount}枚</span>}
                                              {post.isReply && <span>返信</span>}
                                              {post.isQuote && <span>引用</span>}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                                {!isUser && msg.codingArtifact && (
                                  <div className="mt-4 whitespace-normal rounded-[2rem] border border-[#bfe3f7] dark:border-[#252b33] bg-white/85 dark:bg-[#141920] overflow-hidden">
                                    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-[#dfe3e8] dark:border-[#252b33]">
                                      <div className="min-w-0">
                                        <div className="text-sm font-semibold text-[#333a42] dark:text-[#e4e7ea] truncate">
                                          {msg.codingArtifact.title}
                                        </div>
                                        <div className="text-xs text-[#8b929b] dark:text-[#a8b0ba] mt-0.5">
                                          HTMLプレビューとコード
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <button
                                          type="button"
                                          onClick={() => handleCopy(msg.codingArtifact?.html || '')}
                                          className="px-3 py-1.5 rounded-full text-xs font-semibold border border-[#bfe3f7] dark:border-[#2c333c] hover:bg-[#e2e6ea]/45 dark:hover:bg-[#1c2128] transition"
                                        >
                                          コードをコピー
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setExpandedCodeMessageId(expandedCodeMessageId === msg.id ? null : msg.id)}
                                          className="px-3 py-1.5 rounded-full text-xs font-semibold border border-[#bfe3f7] dark:border-[#2c333c] hover:bg-[#e2e6ea]/45 dark:hover:bg-[#1c2128] transition"
                                        >
                                          {expandedCodeMessageId === msg.id ? 'コードを閉じる' : 'コードを表示'}
                                        </button>
                                      </div>
                                    </div>

                                    <div className="bg-transparent p-0">
                                      <iframe
                                        title={msg.codingArtifact.title}
                                        srcDoc={msg.codingArtifact.html}
                                        sandbox="allow-scripts"
                                        className="block w-full h-[360px] bg-white"
                                      />
                                    </div>

                                    {expandedCodeMessageId === msg.id && (
                                      <pre className="max-h-[420px] overflow-auto bg-[#12161b] text-[#f3f4f6] text-xs leading-5 p-4 whitespace-pre-wrap break-words">
                                        <code>{msg.codingArtifact.html}</code>
                                      </pre>
                                    )}
                                  </div>
                                )}
                                {!isUser && msg.artifacts && msg.artifacts.length > 0 && (
                                  <div className="whitespace-normal">
                                    {msg.artifacts.map((a) => (
                                      <ArtifactCard
                                        key={a.id}
                                        artifact={{ ...a, messageId: msg.id }}
                                        active={activeArtifactId === a.id}
                                        onOpen={() => openArtifact({ ...a, messageId: msg.id })}
                                      />
                                    ))}
                                  </div>
                                )}
                                {!isUser && !isStreaming && msg.sources && msg.sources.length > 0 && (
                                  <div className="whitespace-normal">
                                    <Sources sources={msg.sources} />
                                  </div>
                                )}
                                {!isUser && msg.content && (
                                  <div className="flex items-center gap-1.5 mt-3 text-[#69707a] dark:text-[#a8b0ba]">
                                    <button onClick={() => handleCopy(msg.content)} className="p-1.5 hover:bg-[#e2e6ea]/45 dark:hover:bg-[#1c2128] rounded-md transition text-[#69707a] dark:text-[#a8b0ba] hover:text-[#333a42] dark:hover:text-[#e4e7ea]" title="コピー">
                                      <Copy className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => handleRegenerate(messages.findIndex(m => m.id === msg.id))} className="p-1.5 hover:bg-[#e2e6ea]/45 dark:hover:bg-[#1c2128] rounded-md transition text-[#69707a] dark:text-[#a8b0ba] hover:text-[#333a42] dark:hover:text-[#e4e7ea]" title="再度考えてもらう" disabled={isLoading}>
                                      <RotateCcw className={`w-4 h-4 ${isLoading ? 'opacity-50' : ''}`} />
                                    </button>

                                    <button
                                      onClick={() => handleSpeak(msg.id, msg.content)}
                                      className={`p-1.5 hover:bg-[#e4e7ea] dark:hover:bg-[#1c2128] rounded-md transition ${
                                        speakingMessageId === msg.id
                                          ? 'text-red-500 dark:text-red-400 hover:text-red-600'
                                          : 'text-[#69707a] dark:text-[#a8b0ba] hover:text-[#2e343b] dark:hover:text-[#e4e7ea]'
                                      }`}
                                      title={speakingMessageId === msg.id ? '読み上げを停止' : '音声で読み上げ'}
                                    >
                                      {speakingMessageId === msg.id ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                                    </button>

                                    <button onClick={() => handleShare(msg.content)} className="p-1.5 hover:bg-[#e2e6ea]/45 dark:hover:bg-[#1c2128] rounded-md transition text-[#69707a] dark:text-[#a8b0ba] hover:text-[#333a42] dark:hover:text-[#e4e7ea]" title="共有">
                                      <Share className="w-4 h-4" />
                                    </button>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}
                        {isUser && editingMessageId !== msg.id && (
                          <div className="flex items-center gap-1 text-[#69707a] dark:text-[#a8b0ba] opacity-100 md:opacity-0 md:group-hover:opacity-100 transition">
                            <button onClick={() => handleCopy(msg.content)} className="p-1.5 hover:bg-[#e2e6ea]/45 dark:hover:bg-[#1c2128] rounded-md transition hover:text-[#333a42] dark:hover:text-[#e4e7ea]" title="コピー">
                              <Copy className="w-4 h-4" />
                            </button>
                            {!isLoading && (
                              <button
                                onClick={() => {
                                  setEditDraft(msg.content)
                                  setEditingMessageId(msg.id)
                                }}
                                className="p-1.5 hover:bg-[#e2e6ea]/45 dark:hover:bg-[#1c2128] rounded-md transition hover:text-[#333a42] dark:hover:text-[#e4e7ea]"
                                title="編集して再送信"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={messagesEndRef} className="h-4" />
            </div>
          )}
        </div>

        {/* 入力フォームエリア */}
        {view === 'chat' && (
        <div className="p-4 w-full max-w-3xl mx-auto shrink-0">
          {(postLinkPreviewLoading || postLinkPreview) && (
            <div className="mb-3">
              {postLinkPreviewLoading && !postLinkPreview ? (
                <div className="flex items-center gap-2 rounded-[1.75rem] border border-[#bfe3f7] dark:border-[#252b33] bg-white/85 dark:bg-[#141920] px-4 py-3 text-sm text-[#69707a] dark:text-[#a8b0ba]">
                  <Loader2 className="h-4 w-4 animate-spin text-[#4fb3e8] dark:text-[#e4e7ea]" />
                  ポストを読み込み中...
                </div>
              ) : postLinkPreview ? (
                <MiniPostPreviewCard
                  post={postLinkPreview}
                  onDismiss={() => {
                    setDismissedPostPreviewId(postLinkPreview.id)
                    setPostLinkPreview(null)
                    setPostLinkPreviewLoading(false)
                  }}
                />
              ) : null}
            </div>
          )}

          {attachError && (
            <div className="mb-2 flex items-start gap-2 rounded-2xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-500">
              <span className="flex-1">{attachError}</span>
              <button type="button" onClick={() => setAttachError('')} aria-label="閉じる">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {assistant && (
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-[#dceef9] dark:bg-[#1d3446] py-1 pl-2.5 pr-1.5 text-[13px] font-medium text-[#3aa5e0] dark:text-[#86c9ee]">
              <AssistantAvatar item={assistant} avatars={avatars} className="h-5 w-5" />
              {assistant.name}
              <button
                type="button"
                onClick={() => setAssistant(null)}
                className="grid h-4 w-4 place-items-center rounded-full hover:bg-[#3aa5e0]/15"
                aria-label="アシスタントを解除"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {(pendingAttachments.length > 0 || attachLoading > 0) && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <AttachmentChips
                items={pendingAttachments}
                onRemove={(i) => setPendingAttachments(prev => prev.filter((_, j) => j !== i))}
              />
              {attachLoading > 0 && (
                <span className="flex items-center gap-1.5 text-xs text-[#69707a] dark:text-[#a8b0ba]">
                  <Loader2 className="h-3.5 w-3.5 spin" /> 読み込み中…
                </span>
              )}
            </div>
          )}

          <form
            onSubmit={handleSend}
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setIsDragging(false)
              if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
            }}
            className={`vpop-composer relative flex items-end w-full border-2 ${isDragging ? 'border-[#4fb3e8]' : 'border-[#bfe3f7] dark:border-[#2c333c]'} rounded-[2rem] bg-white/95 dark:bg-[#1a1f26] pl-2 pr-2 py-1.5 shadow-[0_10px_30px_-16px_rgba(58,165,224,0.8)]`}
          >
            <textarea
              ref={composerRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  e.currentTarget.form?.requestSubmit()
                }
              }}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files)
                if (files.length) {
                  e.preventDefault()
                  addFiles(files)
                }
              }}
              placeholder={MODE_META[mode].placeholder}
              className="vpop-round flex-1 min-w-0 resize-none bg-transparent border-none focus:outline-none text-[#2e343b] dark:text-[#e4e7ea] text-[15px] leading-6 pl-4 pr-2 py-3 max-h-40 placeholder:text-[#a8b0ba] placeholder:font-normal"
              disabled={isLoading}
            />
            <button
              type="button"
              onClick={openVoiceMode}
              title="ボイスモード"
              aria-label="ボイスモード"
              className="p-3 rounded-full flex items-center justify-center text-[#69707a] dark:text-[#a8b0ba] hover:text-[#3aa5e0] dark:hover:text-[#86c9ee] hover:bg-[#e2e6ea]/55 dark:hover:bg-[#1c2128] transition shrink-0"
            >
              <AudioLines className="w-4 h-4" />
            </button>
            {isLoading ? (
              <button
                type="button"
                onClick={handleStop}
                aria-label="停止"
                title="生成を停止"
                className="p-3 rounded-full transition flex items-center justify-center bg-[#333a42] dark:bg-[#e4e7ea] text-white dark:text-[#12161b] shrink-0"
              >
                <Square className="w-4 h-4" fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={(!input.trim() && pendingAttachments.length === 0) || attachLoading > 0}
                className={`p-3 rounded-full transition flex items-center justify-center shrink-0 ${(!input.trim() && pendingAttachments.length === 0) || attachLoading > 0 ? 'bg-[#e4e7ea] dark:bg-[#252b33] text-[#a8b0ba]' : 'bg-gradient-to-br from-[#86c9ee] to-[#3aa5e0] text-white shadow-[0_6px_18px_-6px_rgba(58,165,224,0.9)]'}`}
              >
                <Send className="w-4 h-4 ml-[2px]" />
              </button>
            )}
          </form>

          <div className="text-center text-xs text-[#a8b0ba] mt-3">
            LimeAI は AI のため、誤りを含む可能性があります。引用元は必ずご確認ください。
          </div>
        </div>
        )}
      </div>

      {/* HTML / SVG / ドキュメントのプレビューパネル */}
      {panelOpen && (
        <ArtifactPanel
          artifacts={artifacts}
          activeId={activeArtifactId}
          streaming={isLoading}
          onSelect={setActiveArtifactId}
          onClose={() => setArtifactOpen(false)}
        />
      )}

      {/* ボイスモード (3Dアバター) */}
      {voiceOpen && (
        <div className="chat-overlay">
          <VoiceMode onClose={() => setVoiceOpen(false)} onAsk={askForVoice} />
        </div>
      )}

      {/* アシスタント専用の通話モード (PC / モバイル対応。画面全体を覆うため body 直下に描画) */}
      {callOpen && assistant && (
        <AssistantCall
          assistant={assistant}
          avatars={avatars}
          onClose={() => setCallOpen(false)}
          onAsk={askForAssistantCall}
        />
      )}
    </div>
  )
}