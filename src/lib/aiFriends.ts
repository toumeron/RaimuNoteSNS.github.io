export type AssistantItem = {
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
    greeting: "猫です。",
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
    greeting: "猫です。",
    systemPrompt:
      "あなたの名前は「たんたんめん」でお寿司ともふもふを愛し、引きこもり気味の自由気ままでユーモラスな内向的性格のイラストレーター。",
  },

];

export const AI_FRIENDS_CHANGED = 'lime-ai-friends-changed';
const key = (uid: string | null | undefined, name: string) => `limeai:${uid || 'guest'}:${name}`;
function read<T>(uid: string | null | undefined, name: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key(uid,name)) || 'null') ?? fallback } catch { return fallback } }
function readList<T>(uid: string | null | undefined, name: string): T[] { const data=read<unknown>(uid,name,[]);return Array.isArray(data)?data:[] }
function write(uid: string | null | undefined, name: string, value: unknown) { localStorage.setItem(key(uid,name),JSON.stringify(value));window.dispatchEvent(new Event(AI_FRIENDS_CHANGED)); }
export type AssistantDraft = {
  id?: string
  name: string
  description: string
  systemPrompt: string
  starter: string
  greeting: string
  gender: 'female' | 'male'
}

export function loadCustomAssistants(uid?: string | null): AssistantItem[] {
  return readList<AssistantItem>(uid, 'assistants')
}

export function saveCustomAssistant(uid: string | null | undefined, draft: AssistantDraft): AssistantItem[] {
  const list = loadCustomAssistants(uid)
  if (draft.id) {
    const existing = list.find(a => a.id === draft.id) ?? BUILTIN_ASSISTANTS.find(a => a.id === draft.id)
    if (!existing) throw new Error('フレンドが見つかりません')
    const edited = { ...existing, ...draft, id: existing.id }
    const next = list.some(a => a.id === draft.id) ? list.map(a => a.id === draft.id ? edited : a) : [...list, edited]
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

export function deleteCustomAssistant(uid: string | null | undefined, id: string): AssistantItem[] {
  const next = loadCustomAssistants(uid).filter((a) => a.id !== id)
  write(uid, 'assistants', next)
  return next
}

/* ---------- キャラクターのアイコン画像 (ブラウザ内に保存) ---------- */
export type AvatarMap = Record<string, string>

export const loadAvatars = (uid?: string | null) => read<AvatarMap>(uid, 'avatars', {})

/** 保存に成功したら true(容量超過などで失敗したら false) */
export function saveAvatars(uid: string | null | undefined, map: AvatarMap): boolean {
  try {
    localStorage.setItem(key(uid, 'avatars'), JSON.stringify(map))
    window.dispatchEvent(new Event(AI_FRIENDS_CHANGED))
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
export function defaultAvatarUrl(seed: string): string {
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

export const avatarOf = (a: { id: string }, avatars: AvatarMap) => avatars[a.id] || defaultAvatarUrl(a.id)

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

export const listAssistants = (uid?: string | null): AssistantItem[] => {
 const saved=loadCustomAssistants(uid);
 return [...BUILTIN_ASSISTANTS.map(item=>saved.find(override=>override.id===item.id)??item),...saved.filter(item=>!BUILTIN_ASSISTANTS.some(builtin=>builtin.id===item.id))];
}

export const findAssistant = (uid: string | null | undefined, id: string | null | undefined) =>
  id ? listAssistants(uid).find((a) => a.id === id) ?? null : null


export const AI_CHAT_HISTORY_CHANGED = 'lime-ai-chat-history-changed';

export const AI_CHAT_DELETED = 'lime-ai-chat-deleted';
