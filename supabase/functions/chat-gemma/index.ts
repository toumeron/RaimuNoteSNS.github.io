import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const encoder = new TextEncoder()

const RECENT_CHAT_MESSAGE_LIMIT = 2
const SUMMARY_TRIGGER_CHARS = 1200
const SUMMARY_INPUT_MAX_CHARS = 1500
const SUMMARY_MAX_CHARS = 150
const ANSWER_MAX_TOKENS = 520

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
const FAST_MODEL = "openai/gpt-oss-20b"
const ADVANCED_MODEL = "openai/gpt-oss-120b"
const SUMMARY_MODEL = FAST_MODEL

type ClientContent = {
  role: "user" | "model"
  parts?: { text?: string }[]
}

type GroqRole = "system" | "user" | "assistant" | "tool"

type GroqToolCall = {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

type GroqMessage = {
  role: GroqRole
  content?: string | null
  tool_call_id?: string
  tool_calls?: GroqToolCall[]
}

type GroqChoiceMessage = {
  role?: string
  content?: string | null
  tool_calls?: unknown
}

type GroqChoice = {
  message?: GroqChoiceMessage
}

type GroqChatResponse = {
  choices?: GroqChoice[]
}

type SearchMode = "search" | "latest" | "popular"
type SearchTimeRangeKind = "none" | "today" | "yesterday" | "recent"

type SearchToolArgs = {
  query: string
  userText: string
  terms: string[]
  mode: SearchMode
  authorUsername: string | null
  hashtag: string | null
  timeRange: SearchTimeRangeKind
  limit: number
}

type HtmlPreviewToolArgs = {
  title: string
  html: string
}

type DbProfile = {
  id?: string
  username?: string | null
  display_name?: string | null
  avatar_url?: string | null
  bio?: string | null
  is_official?: boolean | null
  bot_enabled?: boolean | null
  prefecture?: string | null
  city?: string | null
}

type DbPost = {
  id: string
  user_id: string
  content: string
  image_urls: string[] | null
  created_at: string
  likes_count: number | null
  client_name: string | null
  visibility: string
  parent_id: string | null
  is_quote: boolean | null
  reposts_count: number | null
  is_bot: boolean | null
  comments_count: number | null
  source_twitter: boolean | null
  prefecture: string | null
  city: string | null
  profiles?: DbProfile | DbProfile[] | null
}

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

type SearchResult = {
  context: string
  references: ReferencedPost[]
}

type ToolExecutionResult = {
  toolMessage: GroqMessage
  references?: ReferencedPost[]
  searchContext?: string
  hasSearchTool?: boolean
  hasCodingTool?: boolean
}

type PostQueryResult = {
  data: unknown[] | null
  error: unknown
}

type PostQuery = PromiseLike<PostQueryResult> & {
  gte(column: string, value: string): PostQuery
  lt(column: string, value: string): PostQuery
  or(filters: string): PostQuery
  ilike(column: string, pattern: string): PostQuery
  order(column: string, options?: { ascending?: boolean }): PostQuery
  limit(count: number): PostQuery
  in(column: string, values: readonly string[]): PostQuery
}

const POST_SELECT = `
  id,
  user_id,
  content,
  image_urls,
  created_at,
  likes_count,
  client_name,
  visibility,
  parent_id,
  is_quote,
  reposts_count,
  is_bot,
  comments_count,
  source_twitter,
  prefecture,
  city
`

const PROFILE_SELECT = `
  id,
  username,
  display_name,
  avatar_url,
  bio,
  is_official,
  bot_enabled,
  prefecture,
  city
`


const searchTool = {
  type: "function",
  function: {
    name: "search_limenote_public_posts",
    description:
      "LimeNoteのvisibility=publicの投稿本文を検索する。最新のユーザー発話が、LimeNote内の公開投稿、特定ユーザーの投稿、ハッシュタグ、SNS上の反応、投稿を情報源にした回答を明確に求めている場合だけ使う。通常会話、挨拶、雑談、翻訳、一般説明、数学、前の検索話題を引き継がない単独発話では使わない。検索条件はユーザーの意図から判断し、固定語の有無だけで決めない。全体を見る質問ではauthorUsernameをnullにし、公式アカウントと一般アカウントを同じ扱いにする。期間指定が本当に検索条件として求められている場合だけtimeRangeを指定する。@ユーザー名がある場合はauthorUsernameにその値だけを入れ、queryやtermsを別の言葉へ言い換えない。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
        terms: { type: "array", items: { type: "string" } },
        mode: { type: "string", enum: ["search", "latest", "popular"] },
        authorUsername: { type: ["string", "null"] },
        hashtag: { type: ["string", "null"] },
        timeRange: { type: "string", enum: ["none", "today", "yesterday", "recent"] },
        limit: { type: "integer", minimum: 1, maximum: 5 },
      },
      required: ["query", "terms", "mode", "authorUsername", "hashtag", "timeRange", "limit"],
    },
  },
} as const

const htmlPreviewTool = {
  type: "function",
  function: {
    name: "create_html_preview",
    description:
      "簡単なWebサイト、HTMLページ、プレビュー付きコードを作る依頼の時に使う。HTMLは単体で動く完全なHTMLにする。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        html: { type: "string" },
      },
      required: ["title", "html"],
    },
  },
} as const

function sse(controller: ReadableStreamDefaultController<Uint8Array>, payload: unknown) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
}

function sseText(controller: ReadableStreamDefaultController<Uint8Array>, text: string) {
  if (!text) return
  sse(controller, { choices: [{ delta: { content: text } }] })
}

function sseDone(controller: ReadableStreamDefaultController<Uint8Array>) {
  controller.enqueue(encoder.encode("data: [DONE]\n\n"))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getText(item: ClientContent) {
  return item.parts?.map((part) => part.text ?? "").join("\n").trim() ?? ""
}

function removeSystemBlock(text: string) {
  return text.replace(/【システム命令:[\s\S]*?】/g, " ").trim()
}

function parseBody(value: unknown) {
  if (!isRecord(value)) return { contents: [] as ClientContent[], model: "fast" as "fast" | "advanced" }
  const contents = Array.isArray(value.contents)
    ? value.contents.filter((item): item is ClientContent => {
      if (!isRecord(item)) return false
      return item.role === "user" || item.role === "model"
    })
    : []
  const model = value.model === "advanced" ? "advanced" : "fast"
  return { contents, model }
}

function getLatestUserText(contents: ClientContent[]) {
  for (let index = contents.length - 1; index >= 0; index--) {
    const item = contents[index]
    if (item.role !== "user") continue
    const text = removeSystemBlock(getText(item))
    if (text) return text
  }
  return ""
}


function getPreviousUserText(contents: ClientContent[], latestUserText: string) {
  let skippedLatest = false

  for (let index = contents.length - 1; index >= 0; index--) {
    const item = contents[index]
    if (item.role !== "user") continue

    const text = removeSystemBlock(getText(item))
    if (!text) continue

    if (!skippedLatest && text === latestUserText) {
      skippedLatest = true
      continue
    }

    return text
  }

  return ""
}

function extractHashtag(text: string) {
  const match = text.match(/[#＃]([\p{L}\p{N}_ー-]{1,64})/u)
  return match?.[1] ?? null
}

function hasSearchableSignal(text: string) {
  if (extractExplicitUsername(text)) return true
  if (extractHashtag(text)) return true

  const terms = extractSearchTargetTerms(text)
    .filter((term) => !SEARCH_STOP_TERMS.has(term))
    .filter((term) => /[\p{L}\p{N}]/u.test(term))

  return terms.length > 0
}

function hasExplicitSearchDirective(text: string) {
  return /(調べて|調べろ|調査して|検索して|探して|確認して|調べ直して|検索し直して|ソース|根拠|公開投稿|投稿で|投稿から|ポストで|ポストから)/u.test(text)
}

function hasIdentityQuestion(text: string) {
  return /(とは|って誰|ってだれ|って何|ってなに|何者|誰ですか|だれですか|何ですか|なにですか|どんな人|どういう人)/u.test(text)
}

function hasTimelineInfoQuestion(text: string) {
  const normalized = normalizeSearchText(text)
  if (!/(ニュース|最新情報|最新投稿|新しい投稿|近況|話題|トレンド|公開投稿|ポスト|投稿|タイムライン)/u.test(normalized)) return false
  return /(は|を|について|教えて|調べて|検索して|探して|確認して|まとめて|ある|ありますか|何|なに|どれ|知りたい|[？?])/.test(normalized)
}

function shouldForcePublicPostSearch(latestUserText: string, contents: ClientContent[]) {
  const latest = latestUserText.trim()
  if (!latest) return false
  if (extractExplicitUsername(latest) || extractHashtag(latest)) return true

  const previousUserText = getPreviousUserText(contents, latest)

  if (hasTimelineInfoQuestion(latest)) return true

  if (hasExplicitSearchDirective(latest)) {
    const latestTerms = extractSearchTargetTerms(latest)
    if (isGenericTimelineSearchRequest(latest, latestTerms, normalizeAuthorUsername(extractExplicitUsername(latest)), extractHashtag(latest))) return true
    return hasSearchableSignal(latest) || hasSearchableSignal(previousUserText) || hasTimelineInfoQuestion(previousUserText)
  }

  if (hasIdentityQuestion(latest)) {
    return hasSearchableSignal(latest)
  }

  return false
}

function hasHtmlPreviewTarget(text: string) {
  const normalized = normalizeSearchText(text).toLowerCase()
  return /(html|webサイト|ウェブサイト|サイト|ホームページ|ランディングページ|lp|ページ|ui|画面|フォーム|カード|プロフィール|ポートフォリオ|プレビュー|デモ|アプリ)/iu.test(normalized)
}

function hasHtmlCreationRequest(text: string) {
  const normalized = normalizeSearchText(text).toLowerCase()
  const asksToCreate = /(作成|制作|生成|作って|つくって|作れ|作る|作りたい|作ってください|つくってください|実装|コード|コーディング|html化|ページ化|サイト化)/iu.test(normalized)
  return hasHtmlPreviewTarget(normalized) && asksToCreate
}

function isContinuationHtmlCreationRequest(text: string) {
  const normalized = normalizeSearchText(text).toLowerCase()
  return /^(作って|つくって|作成して|制作して|生成して|実装して|コードにして|お願い|やって|それで|続けて|はい|ok|お願いしました)$/iu.test(normalized)
}

function shouldForceHtmlPreview(latestUserText: string, contents: ClientContent[]) {
  const latest = latestUserText.trim()
  if (!latest) return false

  if (hasHtmlCreationRequest(latest)) return true

  const previousUserText = getPreviousUserText(contents, latest)
  return isContinuationHtmlCreationRequest(latest) && hasHtmlPreviewTarget(previousUserText)
}

function getDirectSearchSeedText(latestUserText: string, contents: ClientContent[]) {
  if (hasSearchableSignal(latestUserText)) return latestUserText

  const previousUserText = getPreviousUserText(contents, latestUserText)
  if (hasSearchableSignal(previousUserText)) return `${previousUserText}\n${latestUserText}`

  return latestUserText
}

function isGenericTimelineSearchRequest(text: string, terms: string[], authorUsername: string | null, hashtag: string | null) {
  if (authorUsername || hashtag) return false
  if (terms.length > 0) return false

  return /(最新情報|最新の情報|最新投稿|最近の投稿|新しい投稿|公開投稿|ポスト|投稿|タイムライン|話題|トレンド|ニュース|近況)/u.test(text)
}

function isGenericTimelineNoiseTerm(term: string) {
  const meaningful = normalizeTerm(term)
    .replace(/(今日|本日|昨日|ニュース|最新|最新情報|情報|公開投稿|投稿|ポスト|タイムライン|話題|トレンド|近況|の|は|を|について|教えて|調べて|検索して|探して|確認して)/gu, "")
    .trim()

  return meaningful.length < 2
}

function shouldUseGenericTimelineSearch(text: string, terms: string[], authorUsername: string | null, hashtag: string | null) {
  if (authorUsername || hashtag) return false
  if (!hasTimelineInfoQuestion(text)) return false
  return terms.length === 0 || terms.every(isGenericTimelineNoiseTerm)
}

function inferDirectSearchMode(seedText: string, terms: string[], authorUsername: string | null, hashtag: string | null): SearchMode {
  if (/人気|伸びて|バズ|反応が多い|いいねが多い/u.test(seedText)) return "popular"
  if (isGenericTimelineSearchRequest(seedText, terms, authorUsername, hashtag)) return "latest"
  return "search"
}

function inferDirectTimeRange(seedText: string, mode: SearchMode, terms: string[], authorUsername: string | null, hashtag: string | null): SearchTimeRangeKind {
  if (mode !== "latest" && terms.length > 0) return "none"
  if (!authorUsername && !hashtag && /(今日の|本日の|今日投稿|本日投稿|今日の公開投稿|本日の公開投稿|今日のニュース|本日のニュース)/u.test(seedText)) return "today"
  if (!authorUsername && !hashtag && /(昨日の|昨日投稿|昨日の公開投稿|昨日のニュース)/u.test(seedText)) return "yesterday"
  return "none"
}

function buildDirectSearchArgs(latestUserText: string, contents: ClientContent[]): SearchToolArgs {
  const seedText = getDirectSearchSeedText(latestUserText, contents)
  const authorUsername = normalizeAuthorUsername(extractExplicitUsername(seedText))
  const hashtag = extractHashtag(seedText)
  const rawTerms = authorUsername
    ? []
    : extractSearchTargetTerms(seedText).slice(0, 10)
  const terms = shouldUseGenericTimelineSearch(seedText, rawTerms, authorUsername, hashtag) ? [] : rawTerms
  const mode = inferDirectSearchMode(seedText, terms, authorUsername, hashtag)

  return {
    query: seedText,
    userText: seedText,
    terms,
    mode,
    authorUsername,
    hashtag: hashtag ? normalizeTerm(hashtag) : null,
    timeRange: inferDirectTimeRange(seedText, mode, terms, authorUsername, hashtag),
    limit: 5,
  }
}

function limitText(text: string, maxChars: number) {
  const cleaned = text.trim()
  if (cleaned.length <= maxChars) return cleaned
  return `${cleaned.slice(0, maxChars).trimEnd()}…`
}

function roleLabel(role: "user" | "model") {
  return role === "user" ? "ユーザー" : "LimeAI"
}

function splitContents(contents: ClientContent[]) {
  const systemTexts: string[] = []
  const chatItems: ClientContent[] = []

  for (const item of contents) {
    const text = getText(item)
    if (!text) continue
    if (text.includes("【システム命令:")) {
      systemTexts.push(text)
    } else {
      chatItems.push(item)
    }
  }

  const olderCount = Math.max(0, chatItems.length - RECENT_CHAT_MESSAGE_LIMIT)
  return {
    systemTexts,
    olderItems: chatItems.slice(0, olderCount),
    recentItems: chatItems.slice(olderCount),
  }
}

function countChars(items: ClientContent[]) {
  return items.reduce((sum, item) => sum + getText(item).length, 0)
}

async function callGroqJson(groqApiKey: string, body: unknown): Promise<GroqChatResponse> {
  const response = await fetch(GROQ_CHAT_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${groqApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Groq ${response.status}: ${detail}`)
  }

  return await response.json() as GroqChatResponse
}

async function summarizeOldChat(groqApiKey: string, olderItems: ClientContent[]) {
  if (olderItems.length === 0 || countChars(olderItems) < SUMMARY_TRIGGER_CHARS) return ""

  const history = olderItems
    .map((item) => `${roleLabel(item.role)}: ${getText(item)}`)
    .join("\n")
    .slice(-SUMMARY_INPUT_MAX_CHARS)

  if (!history.trim()) return ""

  try {
    const data = await callGroqJson(groqApiKey, {
      model: SUMMARY_MODEL,
      messages: [
        { role: "system", content: `会話履歴を${SUMMARY_MAX_CHARS}字以内で要約してください。重要な依頼、決定事項、未解決の点だけ残してください。` },
        { role: "user", content: history },
      ],
      stream: false,
      temperature: 0.1,
      max_completion_tokens: 120,
    })

    return limitText(data.choices?.[0]?.message?.content ?? "", SUMMARY_MAX_CHARS)
  } catch (error) {
    console.error("summarizeOldChat failed:", error)
    return ""
  }
}

async function buildBaseMessages(
  groqApiKey: string,
  contents: ClientContent[],
  controller: ReadableStreamDefaultController<Uint8Array>,
) {
  const { systemTexts, olderItems, recentItems } = splitContents(contents)
  const messages: GroqMessage[] = []

  messages.push({
    role: "system",
    content: [
      "あなたはLimeAIです。日本語で直接答えます。",
      `現在日時は${toJstDateLabel()}です。`,
      "回答は短く自然にします。",
      "最新のユーザー発話を最優先します。最新発話が単独で完結している場合、過去の検索話題を勝手に続けません。",
      "LimeNoteの公開投稿を情報源にする必要がある場合だけ search_limenote_public_posts を使います。通常会話では使いません。",
      "公開投稿を全体的に見る質問では authorUsername を null にします。@ユーザー名や明確な指名がある時だけ authorUsername を入れます。",
      "@ユーザー名が書かれている場合は、そのusernameだけを完全一致で扱い、別の語句に置き換えて検索してはいけません。",
      "検索結果を使う時は、本文と投稿日時を確認してから答えます。",
      "検索結果では公式アカウントと一般アカウントの投稿本文を同じ重みで読みます。公式かどうかを信頼度や順位の根拠にしてはいけません。",
      "ユーザーがWebサイト、HTMLページ、プレビュー付きコードの作成を求めた時は、画面表示用のHTMLプレビューを作成します。",
      "ツールを使う必要がない時は、最新発話にそのまま返答します。",
    ].join("\n"),
  })

  for (const text of systemTexts) {
    messages.push({ role: "system", content: limitText(text, 1200) })
  }

  if (olderItems.length > 0 && countChars(olderItems) >= SUMMARY_TRIGGER_CHARS) {
    sse(controller, { type: "conversation_summary_start" })
    const summary = await summarizeOldChat(groqApiKey, olderItems)
    if (summary) messages.push({ role: "system", content: `これまでの会話要約:\n${summary}` })
    sse(controller, { type: "conversation_summary_end", used: Boolean(summary), chars: summary.length })
  }

  for (const item of recentItems) {
    const text = getText(item)
    if (!text) continue
    messages.push({ role: item.role === "model" ? "assistant" : "user", content: text })
  }

  return messages
}

function getToolCalls(value: unknown): GroqToolCall[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isRecord)
    .map((item) => {
      const fn = isRecord(item.function) ? item.function : null
      const id = typeof item.id === "string" ? item.id : ""
      const name = typeof fn?.name === "string" ? fn.name : ""
      const args = typeof fn?.arguments === "string" ? fn.arguments : "{}"
      if (!id || item.type !== "function" || !name) return null
      return { id, type: "function", function: { name, arguments: args } } satisfies GroqToolCall
    })
    .filter((item): item is GroqToolCall => item !== null)
}


type ToolIntentAction = "chat" | "search" | "html" | "search_and_html"

type ToolIntentDecision = {
  action: ToolIntentAction
  reason: string
}

function extractJsonObject(text: string) {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  return text.slice(start, end + 1)
}

function normalizeToolIntent(value: unknown): ToolIntentDecision {
  if (!isRecord(value)) return { action: "chat", reason: "invalid_router_output" }

  const actionValue = typeof value.action === "string" ? value.action : "chat"
  const action: ToolIntentAction = actionValue === "search" || actionValue === "html" || actionValue === "search_and_html"
    ? actionValue
    : "chat"

  const reason = typeof value.reason === "string" ? value.reason.slice(0, 120) : ""
  return { action, reason }
}

function buildRouterContext(contents: ClientContent[]) {
  const rows: string[] = []

  for (const item of contents) {
    const text = removeSystemBlock(getText(item))
    if (!text) continue

    rows.push(`${roleLabel(item.role)}: ${limitText(text, 260)}`)
  }

  return rows.slice(-4).join("\n")
}

async function classifyToolIntent(
  groqApiKey: string,
  latestUserText: string,
  routerContext: string,
): Promise<ToolIntentDecision> {
  const latest = latestUserText.trim()
  if (!latest) return { action: "chat", reason: "empty_latest_message" }

  try {
    const data = await callGroqJson(groqApiKey, {
      model: SUMMARY_MODEL,
      messages: [
        {
          role: "system",
          content: [
            "あなたはLimeAIの内部ルーターです。最新のユーザー発話を中心に、ツールが必要か意味で判断します。",
            "固定ワードの有無で判定してはいけません。発話が何を求めているかで判断してください。",
            "直近文脈は、代名詞・指摘・『調べてない』などの追及が何を指すかを補う時だけ使います。最新発話が挨拶や雑談として完結している場合は、直近文脈を引き継がずchatにします。",
            "LimeNote内の公開投稿、特定ユーザーの投稿、ハッシュタグ、SNS上での言及・反応、LimeNote内の人物・呼称・役職・出来事を公開投稿から確認して答える必要がある場合はsearchを選びます。",
            "未知または曖昧な固有名詞・アカウント名・人物名・役職について『とは』『誰』『何者』『どういう人』のように尋ねている場合、LimeNote内の公開情報確認が必要なのでsearchを選びます。",
            "ユーザーが『調べてない』『ソースは』『投稿では』『公開投稿では』のように、前の回答の根拠確認を求めている場合は、直近文脈の対象でsearchを選びます。",
            "WebページやHTMLプレビューの作成が必要な場合だけhtmlを選びます。",
            "挨拶、気分、雑談、感想、翻訳、一般的な相談、明らかに投稿確認が不要な通常会話はchatを選びます。",
            "出力はJSONだけにしてください。",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            "次の形式だけで返してください:",
            "{\"action\":\"chat|search|html|search_and_html\",\"reason\":\"短い理由\"}",
            "",
            "判定例:",
            "こんにちは! => chat",
            "今日は眠い => chat",
            "ありがとう => chat",
            "かがみいし社長とは? => search",
            "ねこまっまって誰? => search",
            "調べてないですね => search（直近文脈の対象を公開投稿で確認する）",
            "LimeNoteでミセスの投稿を探して => search",
            "@catの最新投稿は? => search",
            "今日の公開投稿をまとめて => search",
            "HTMLで自己紹介カードを作って => html",
            "",
            `直近文脈:\n${routerContext || "なし"}`,
            "",
            `最新のユーザー発話: ${latest}`,
          ].join("\n"),
        },
      ],
      stream: false,
      temperature: 0,
      max_completion_tokens: 80
    })

    const content = data.choices?.[0]?.message?.content ?? ""
    const jsonText = extractJsonObject(content)
    if (!jsonText) return { action: "chat", reason: "router_no_json" }

    const parsed: unknown = JSON.parse(jsonText)
    return normalizeToolIntent(parsed)
  } catch (error) {
    console.error("classifyToolIntent failed:", error)
    return { action: "chat", reason: "router_failed" }
  }
}

function toolsForIntent(action: ToolIntentAction) {
  switch (action) {
    case "search":
      return [searchTool]
    case "html":
      return [htmlPreviewTool]
    case "search_and_html":
      return [searchTool, htmlPreviewTool]
    case "chat":
    default:
      return []
  }
}

function toolChoiceForIntent(action: ToolIntentAction): unknown {
  if (action === "search") {
    return { type: "function", function: { name: "search_limenote_public_posts" } }
  }

  if (action === "html") {
    return { type: "function", function: { name: "create_html_preview" } }
  }

  return "auto"
}

function toolInstructionForIntent(action: ToolIntentAction) {
  switch (action) {
    case "search":
      return "内部ルーターは、最新発話に公開投稿検索が必要だと判定しました。search_limenote_public_postsを使い、結果に基づいて短く答えてください。"
    case "html":
      return "内部ルーターは、最新発話にHTMLプレビュー作成が必要だと判定しました。create_html_previewを使ってください。"
    case "search_and_html":
      return "内部ルーターは、公開投稿検索とHTMLプレビュー作成の両方が必要だと判定しました。必要なツールだけを使ってください。"
    case "chat":
    default:
      return "内部ルーターは、最新発話にツールは不要だと判定しました。公開投稿や過去の検索結果には触れず、最新発話に自然に返答してください。"
  }
}

function parseJsonArgs(text: string) {
  try {
    const parsed: unknown = JSON.parse(text || "{}")
    return isRecord(parsed) ? parsed : {}
  } catch (_error) {
    return {}
  }
}

function normalizeTerm(term: string) {
  return term
    .replace(/^[@#＃]/, "")
    .replace(/[,%()*"'\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function safeTerms(values: string[]) {
  return [...new Set(values.map(normalizeTerm).filter((term) => term.length >= 1))].slice(0, 10)
}

function getJstDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)

  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00"

  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
  }
}

function toJstDateLabel(date = new Date()) {
  const parts = getJstDateParts(date)
  return `${parts.year}年${parts.month}月${parts.day}日 ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")} JST`
}

function startOfJstDayUtcIso(offsetDays = 0) {
  const parts = getJstDateParts()
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offsetDays, -9, 0, 0, 0)).toISOString()
}

type SearchTimeRange = {
  startIso: string
  endIso?: string
  label: string
  strict: boolean
  kind: "today" | "yesterday" | "recent"
}

function getSearchTimeRange(args: SearchToolArgs): SearchTimeRange | null {
  switch (args.timeRange) {
    case "today":
      return {
        startIso: startOfJstDayUtcIso(0),
        endIso: startOfJstDayUtcIso(1),
        label: `今日（${toJstDateLabel()} 時点）の公開投稿`,
        strict: true,
        kind: "today",
      }
    case "yesterday":
      return {
        startIso: startOfJstDayUtcIso(-1),
        endIso: startOfJstDayUtcIso(0),
        label: "昨日の公開投稿",
        strict: true,
        kind: "yesterday",
      }
    case "recent":
      return {
        startIso: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        label: "直近7日以内の公開投稿",
        strict: false,
        kind: "recent",
      }
    case "none":
    default:
      return null
  }
}

function applyTimeRange(query: PostQuery, range: SearchTimeRange | null): PostQuery {
  if (!range) return query

  let nextQuery = query.gte("created_at", range.startIso)
  if (range.endIso) nextQuery = nextQuery.lt("created_at", range.endIso)

  return nextQuery
}

function elapsedLabel(createdAt: string) {
  const created = new Date(createdAt).getTime()
  if (!Number.isFinite(created)) return createdAt

  const diffMs = Date.now() - created
  const absMs = Math.abs(diffMs)
  const minutes = Math.floor(absMs / 60000)
  const hours = Math.floor(absMs / 36e5)
  const days = Math.floor(absMs / 86400000)

  if (minutes < 1) return diffMs >= 0 ? "たった今" : "未来の投稿"
  if (minutes < 60) return diffMs >= 0 ? `${minutes}分前` : `${minutes}分後`
  if (hours < 24) return diffMs >= 0 ? `${hours}時間前` : `${hours}時間後`
  if (days < 31) return diffMs >= 0 ? `${days}日前` : `${days}日後`

  const months = Math.floor(days / 30)
  return diffMs >= 0 ? `${months}ヶ月前` : `${months}ヶ月後`
}


function extractExplicitUsername(text: string) {
  const match = text.match(/@([a-zA-Z0-9_]{1,32})/)
  return match?.[1] ?? null
}

function normalizeAuthorUsername(value: string | null) {
  if (!value) return null
  const trimmed = normalizeTerm(value).replace(/^@+/, '').trim()
  const match = trimmed.match(/[a-zA-Z0-9_]{1,32}/)
  return match?.[0] ?? null
}

function parseSearchArgs(text: string, latestUserText: string): SearchToolArgs {
  const record = parseJsonArgs(text)
  const rawTerms = Array.isArray(record.terms)
    ? record.terms.filter((item): item is string => typeof item === "string")
    : []
  const mode: SearchMode = record.mode === "latest" || record.mode === "popular" || record.mode === "search"
    ? record.mode
    : "search"
  const limit = typeof record.limit === "number" && Number.isFinite(record.limit)
    ? Math.min(Math.max(Math.trunc(record.limit), 1), 5)
    : 3

  const toolQuery = typeof record.query === "string" && record.query.trim()
    ? record.query.trim()
    : latestUserText

  const explicitMention = extractExplicitUsername(latestUserText) ?? extractExplicitUsername(toolQuery)
  const modelAuthor = typeof record.authorUsername === "string" && record.authorUsername.trim()
    ? normalizeAuthorUsername(record.authorUsername)
    : null

  const authorUsername = normalizeAuthorUsername(explicitMention ?? modelAuthor)

  const timeRange: SearchTimeRangeKind = record.timeRange === "today" || record.timeRange === "yesterday" || record.timeRange === "recent"
    ? record.timeRange
    : "none"

  return {
    query: toolQuery,
    userText: latestUserText,
    terms: rawTerms,
    mode,
    authorUsername,
    hashtag: typeof record.hashtag === "string" && record.hashtag.trim() ? normalizeTerm(record.hashtag) : null,
    timeRange,
    limit,
  }
}

function parseHtmlArgs(text: string, latestUserText: string): HtmlPreviewToolArgs {
  const record = parseJsonArgs(text)
  const title = typeof record.title === "string" && record.title.trim() ? record.title.trim().slice(0, 80) : "HTMLプレビュー"
  const html = typeof record.html === "string" && record.html.trim()
    ? record.html.trim()
    : `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title></head><body><main><h1>${latestUserText.replace(/[<>&]/g, "")}</h1></main></body></html>`
  const fullHtml = html.toLowerCase().includes("<html") ? html : `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title></head><body>${html}</body></html>`
  return { title, html: fullHtml.slice(0, 24000) }
}

function cleanGeneratedCodeFence(text: string) {
  const trimmed = text.trim()
  const fenceMatch = trimmed.match(/^```(?:html|json)?\n([\s\S]*?)\n```$/i)
  return fenceMatch?.[1]?.trim() ?? trimmed
}

function normalizeHtmlDocument(html: string, title: string) {
  const cleaned = cleanGeneratedCodeFence(html).trim()
  const bounded = cleaned.slice(0, 24000)

  if (/<html[\s>]/i.test(bounded)) {
    return bounded.toLowerCase().startsWith("<!doctype") ? bounded : `<!doctype html>\n${bounded}`
  }

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title.replace(/[<>&"]/g, "")}</title>
</head>
<body>
${bounded}
</body>
</html>`
}

function parseGeneratedHtmlArtifact(content: string, latestUserText: string): HtmlPreviewToolArgs | null {
  const cleaned = cleanGeneratedCodeFence(content)
  const jsonText = extractJsonObject(cleaned)

  if (jsonText) {
    try {
      const parsed: unknown = JSON.parse(jsonText)
      if (isRecord(parsed) && typeof parsed.html === "string" && parsed.html.trim()) {
        const title = typeof parsed.title === "string" && parsed.title.trim()
          ? parsed.title.trim().slice(0, 80)
          : "HTMLプレビュー"
        return { title, html: normalizeHtmlDocument(parsed.html, title) }
      }
    } catch (error) {
      console.error("parse generated html json failed:", error)
    }
  }

  if (/<(?:!doctype|html|head|body|main|section|div|style|script)[\s>]/i.test(cleaned)) {
    const title = latestUserText.replace(/\s+/g, " ").trim().slice(0, 40) || "HTMLプレビュー"
    return { title, html: normalizeHtmlDocument(cleaned, title) }
  }

  return null
}

async function generateHtmlPreviewArtifact(
  groqApiKey: string,
  model: string,
  latestUserText: string,
  routerContext: string,
  searchContext: string | null,
): Promise<HtmlPreviewToolArgs> {
  const response = await callGroqJson(groqApiKey, {
    model,
    messages: [
      {
        role: "system",
        content: [
          "あなたはHTMLプレビュー生成専用です。",
          "ユーザーの依頼に合わせて、単体で表示できる完全なHTMLを作成してください。",
          "外部ライブラリや外部画像に依存しないでください。CSSは<style>内に含めます。",
          "回答はJSONだけにしてください。説明文、Markdown、コードフェンス、関数呼び出し形式は禁止です。",
          "形式は必ず {\"title\":\"短いタイトル\",\"html\":\"<!doctype html>...\"} です。",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          routerContext ? `直近文脈:\n${routerContext}` : "直近文脈: なし",
          searchContext ? `参考情報:\n${searchContext}` : "参考情報: なし",
          `最新のユーザー発話: ${latestUserText}`,
        ].join("\n\n"),
      },
    ],
    stream: false,
    temperature: 0.45,
    max_completion_tokens: 3600,
  })

  const content = response.choices?.[0]?.message?.content ?? ""
  const artifact = parseGeneratedHtmlArtifact(content, latestUserText)
  if (!artifact) throw new Error("HTML artifact was not generated")
  return artifact
}

async function executeDirectHtml(
  groqApiKey: string,
  model: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  latestUserText: string,
  routerContext: string,
  searchContext: string | null = null,
) {
  sse(controller, { type: "coding_artifact_start" })

  try {
    const args = await generateHtmlPreviewArtifact(groqApiKey, model, latestUserText, routerContext, searchContext)
    const artifact = { title: args.title, language: "html", html: args.html }
    sse(controller, { type: "coding_artifact", artifact })
    sseText(controller, `${args.title}を作成しました。`)
  } catch (error) {
    console.error("direct html generation failed:", error)
    sseText(controller, "HTMLプレビューの生成中にエラーが発生しました。もう一度お試しください。")
  }

  sseDone(controller)
}

function createSearchSupabaseClient(): SupabaseClient | null {
  const url = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (!url || !serviceRoleKey) {
    console.error("Search requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
    return null
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}


function getProfile(post: DbPost): DbProfile | null {
  const profile = post.profiles
  if (Array.isArray(profile)) return profile[0] ?? null
  return profile ?? null
}

function makeSnippet(text: string, maxLength = 180) {
  const cleaned = text.replace(/\s+/g, " ").trim()
  if (cleaned.length <= maxLength) return cleaned
  return `${cleaned.slice(0, maxLength)}…`
}

function toReferencePost(post: DbPost): ReferencedPost {
  const profile = getProfile(post)
  const imageCount = Array.isArray(post.image_urls) ? post.image_urls.length : 0
  return {
    id: post.id,
    authorUsername: profile?.username || "unknown",
    authorDisplayName: profile?.display_name || "無名",
    authorAvatarUrl: profile?.avatar_url || null,
    authorIsOfficial: profile?.is_official === true,
    createdAt: post.created_at,
    contentSnippet: makeSnippet(post.content, 220),
    likesCount: Number(post.likes_count ?? 0),
    repostsCount: Number(post.reposts_count ?? 0),
    commentsCount: Number(post.comments_count ?? 0),
    imageCount,
    isQuote: post.is_quote === true,
    isReply: typeof post.parent_id === "string" && post.parent_id.length > 0,
    isBot: post.is_bot === true || profile?.bot_enabled === true,
    clientName: post.client_name,
    sourceTwitter: post.source_twitter === true,
    prefecture: post.prefecture,
    city: post.city,
  }
}

function formatPostsForTool(posts: DbPost[], range: SearchTimeRange | null) {
  const header = [
    `現在日時(JST): ${toJstDateLabel()}`,
    range ? `検索期間: ${range.label}` : "検索期間: 指定なし",
    range ? "注記: 期間指定がある検索結果です。投稿日時を確認して回答してください。" : "注記: 投稿日時を確認して回答してください。",
  ].join("\n")

  if (posts.length === 0) {
    return `${header}\n\n公開投稿は見つかりませんでした。`
  }

  const body = posts
    .slice(0, 5)
    .map((post, index) => {
      const profile = getProfile(post)
      const content = makeSnippet(post.content, 260)
      return [
        `${index + 1}. 投稿者:${profile?.display_name || "無名"}(@${profile?.username || "unknown"})`,
        `投稿日時:${post.created_at}（${elapsedLabel(post.created_at)}）`,
        `本文:${content || "本文なし"}`,
      ].join("\n")
    })
    .join("\n\n")

  return `${header}\n\n${body}`
}


function normalizeSearchText(text: string) {
  return text
    .replace(/[！？!?。、，,.「」『』【】\[\]（）()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

const SEARCH_STOP_TERMS = new Set([
  "とは", "って", "なに", "何", "誰", "だれ", "何者", "どんな", "ですか", "ますか",
  "教えて", "について", "とは何", "とはなに", "調べて", "調べろ", "検索", "公開", "投稿", "ポスト",
  "情報", "結果", "ソース", "今日", "本日", "昨日", "最新", "ニュース", "話題", "まとめ", "LimeNote", "LimeAI",
  "ちゃんと", "もう一度", "再度", "詳しく", "ください", "お願いします", "アカウント", "ユーザー", "公開投稿", "という",
])

const ROLE_HINT_TERMS = new Set(["社長", "CEO", "管理者", "代表", "会長", "公式", "アカウント"])
const ROLE_HINT_PATTERN = /(社長|CEO|管理者|代表|会長|公式|アカウント)/gu

const SEARCH_DIRECTIVE_PATTERN = /(調べてください|調べて|調べろ|調査して|検索して|探して|確認して|調べ直して|検索し直して|ちゃんと調べろ|ちゃんと調べて|詳しく調べて|教えてください|教えて|お願いします|お願い)/gu
function trimQuestionSuffix(term: string) {
  let next = normalizeTerm(term)
    .replace(/[？?！!。,.、，:：;；「」『』（）()\[\]【】]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  next = next
    .replace(/(について教えて|について調べて|というアカウント|というユーザー|という人|という人物)$/u, "")
    .replace(/(とは誰|とはだれ|とは何|とはなに|とは|って何|ってなに|って誰|ってだれ|は誰|はだれ|は何|はなに|何者|って|について)$/u, "")
    .replace(/(ですか|ますか|でしょうか|してください|して|ください)$/u, "")
    .trim()

  return next
}

function splitCompoundSearchTerm(term: string) {
  const cleaned = trimQuestionSuffix(term)
  if (!cleaned) return [] as string[]

  const terms = new Set<string>()
  terms.add(cleaned)

  for (const match of cleaned.matchAll(ROLE_HINT_PATTERN)) {
    const role = match[0]
    const index = match.index ?? -1
    if (index > 0) {
      const before = cleaned.slice(0, index).trim()
      if (before) terms.add(before)
    }
    const after = cleaned.slice(index + role.length).trim()
    if (after) terms.add(after)
    terms.add(role)
  }

  for (const chunk of cleaned.split(/[\s・\/／|｜]+/u)) {
    const item = trimQuestionSuffix(chunk)
    if (item) terms.add(item)
  }

  return [...terms]
}

function extractSearchTargetTerms(text: string) {
  const normalized = normalizeSearchText(text)
  const targets = new Set<string>()

  for (const match of normalized.matchAll(/(?:^|[\s「『])([^「」『』]{2,64}?)(?:とは|って誰|ってだれ|って何|ってなに|は誰|はだれ|は何|はなに|何者|について|というアカウント|というユーザー|という人|という人物)/gu)) {
    const target = trimQuestionSuffix((match[1] ?? "").replace(SEARCH_DIRECTIVE_PATTERN, " "))
    if (target) targets.add(target)
  }

  const cleaned = normalized
    .replace(/@[a-zA-Z0-9_]+/g, " ")
    .replace(/[#＃][\p{L}\p{N}_ー-]+/gu, " ")
    .replace(SEARCH_DIRECTIVE_PATTERN, " ")
    .replace(/(誰ですか|だれですか|何ですか|なにですか|誰|だれ|何者|なにもの|とは|って|について|ですか|ますか|でしょうか)/gu, " ")
    .replace(/(という|アカウント|ユーザー|公開投稿|投稿|ポスト|情報|結果|ソース)/gu, " ")
    .replace(/(ちゃんと|もう一度|再度|詳しく|ください|お願いします|お願い|は？|は\?)/gu, " ")
    .replace(/\s+/g, " ")
    .trim()

  for (const chunk of cleaned.split(/[\s・\/／|｜]+/u)) {
    const item = trimQuestionSuffix(chunk)
    if (item && /[\p{L}\p{N}]/u.test(item)) targets.add(item)
  }

  const expanded = [...targets].flatMap((value) => splitCompoundSearchTerm(value))

  return safeTerms(expanded)
    .map((term) => trimQuestionSuffix(term))
    .filter((term) => term.length >= 2)
    .filter((term) => !SEARCH_STOP_TERMS.has(term))
}

function cleanSearchTerms(values: string[]) {
  const expanded = values.flatMap((value) => splitCompoundSearchTerm(value))
  return safeTerms(expanded)
    .map((term) => trimQuestionSuffix(term))
    .filter((term) => term.length >= 2)
    .filter((term) => !SEARCH_STOP_TERMS.has(term))
}

function expandSearchTerms(args: SearchToolArgs) {
  if (args.authorUsername) {
    return [args.authorUsername]
  }

  const baseTerms = [
    ...args.terms,
    ...extractSearchTargetTerms(args.query),
    ...extractSearchTargetTerms(args.userText),
    args.hashtag ?? "",
  ]

  return cleanSearchTerms(baseTerms).slice(0, 12)
}

function getPrimaryEntityTerms(args: SearchToolArgs, terms: string[]) {
  if (args.authorUsername || args.hashtag) return [] as string[]

  const fromLatestText = extractSearchTargetTerms(args.userText)
  const source = fromLatestText.length > 0 ? fromLatestText : terms

  const primary = source
    .filter((term) => !ROLE_HINT_TERMS.has(term))
    .filter((term) => !SEARCH_STOP_TERMS.has(term))
    .filter((term) => /[\p{L}\p{N}]/u.test(term))
    .filter((term) => term.length >= 2)

  return [...new Set(primary)].slice(0, 4)
}

function postMatchesAnyTerm(post: DbPost, terms: string[]) {
  if (terms.length === 0) return true
  const profile = getProfile(post)
  const target = [
    post.content,
    post.client_name ?? "",
    post.prefecture ?? "",
    post.city ?? "",
    profile?.username ?? "",
    profile?.display_name ?? "",
    profile?.bio ?? "",
  ].join(" ").toLowerCase()

  return terms.some((term) => target.includes(normalizeTerm(term).toLowerCase()))
}

function applyPrimaryEntityFilter(posts: DbPost[], primaryTerms: string[], enabled: boolean) {
  if (!enabled || primaryTerms.length === 0) return posts
  return posts.filter((post) => postMatchesAnyTerm(post, primaryTerms))
}

function isTimelineMode(args: SearchToolArgs) {
  return !args.authorUsername && !args.hashtag && (args.mode === "latest" || args.mode === "popular" || args.timeRange !== "none")
}

function shouldUseAuthorFilter(args: SearchToolArgs) {
  return Boolean(normalizeAuthorUsername(args.authorUsername))
}

function publicPostsQuery(supabase: SupabaseClient): PostQuery {
  return supabase
    .from("posts")
    .select(POST_SELECT)
    .eq("visibility", "public") as unknown as PostQuery
}

async function safeSelectPosts(query: PromiseLike<{ data: unknown[] | null; error: unknown }>, label: string) {
  try {
    const { data, error } = await query
    if (error) {
      console.error(`${label} error:`, error)
      return [] as DbPost[]
    }
    return (data ?? [])
      .map((item) => normalizeDbPost(item))
      .filter((post): post is DbPost => post !== null)
  } catch (error) {
    console.error(`${label} crash:`, error)
    return [] as DbPost[]
  }
}

function normalizeDbPost(value: unknown): DbPost | null {
  if (!isRecord(value)) return null

  const id = typeof value.id === "string" ? value.id : ""
  const userId = typeof value.user_id === "string" ? value.user_id : ""
  const createdAt = typeof value.created_at === "string" ? value.created_at : ""
  const visibility = typeof value.visibility === "string" ? value.visibility : ""
  const rawContent = value.content
  const content = typeof rawContent === "string" ? rawContent : rawContent == null ? "" : String(rawContent)

  if (!id || !userId || !createdAt || visibility !== "public") return null

  return {
    id,
    user_id: userId,
    content,
    image_urls: Array.isArray(value.image_urls) ? value.image_urls.filter((item): item is string => typeof item === "string") : null,
    created_at: createdAt,
    likes_count: typeof value.likes_count === "number" ? value.likes_count : Number(value.likes_count ?? 0),
    client_name: typeof value.client_name === "string" ? value.client_name : null,
    visibility,
    parent_id: typeof value.parent_id === "string" ? value.parent_id : null,
    is_quote: value.is_quote === true,
    reposts_count: typeof value.reposts_count === "number" ? value.reposts_count : Number(value.reposts_count ?? 0),
    is_bot: value.is_bot === true,
    comments_count: typeof value.comments_count === "number" ? value.comments_count : Number(value.comments_count ?? 0),
    source_twitter: value.source_twitter === true,
    prefecture: typeof value.prefecture === "string" ? value.prefecture : null,
    city: typeof value.city === "string" ? value.city : null,
    profiles: isRecord(value.profiles) || Array.isArray(value.profiles) ? value.profiles as DbProfile | DbProfile[] : null,
  }
}

async function attachProfiles(supabase: SupabaseClient, posts: DbPost[]) {
  const userIds = [...new Set(posts.map((post) => post.user_id).filter(Boolean))]
  if (userIds.length === 0) return posts

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select(PROFILE_SELECT)
      .in("id", userIds)

    if (error) {
      console.error("attachProfiles error:", error)
      return posts
    }

    const profileMap = new Map<string, DbProfile>()
    for (const item of (data ?? []) as unknown as DbProfile[]) {
      if (item.id) profileMap.set(item.id, item)
    }

    return posts.map((post) => ({
      ...post,
      profiles: profileMap.get(post.user_id) ?? post.profiles ?? null,
    }))
  } catch (error) {
    console.error("attachProfiles crash:", error)
    return posts
  }
}


async function safeSelectProfiles(query: PromiseLike<{ data: unknown[] | null; error: unknown }>, label: string) {
  try {
    const { data, error } = await query
    if (error) {
      console.error(`${label} error:`, error)
      return [] as DbProfile[]
    }
    return (data ?? []).filter((item): item is DbProfile => isRecord(item)) as DbProfile[]
  } catch (error) {
    console.error(`${label} crash:`, error)
    return [] as DbProfile[]
  }
}

function termsForDatabaseSearch(terms: string[]) {
  return cleanSearchTerms(terms)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .filter((term) => !/[\s,()]/u.test(term))
    .slice(0, 8)
}

async function searchProfiles(supabase: SupabaseClient, terms: string[]) {
  const filtered = termsForDatabaseSearch(terms)
  if (filtered.length === 0) return [] as DbProfile[]

  const profiles: DbProfile[] = []

  for (const term of filtered) {
    const pattern = `%${term}%`
    profiles.push(...await safeSelectProfiles(
      supabase.from("profiles").select(PROFILE_SELECT).ilike("username", pattern).limit(10),
      `searchProfiles username ${term}`,
    ))
    profiles.push(...await safeSelectProfiles(
      supabase.from("profiles").select(PROFILE_SELECT).ilike("display_name", pattern).limit(10),
      `searchProfiles display_name ${term}`,
    ))
    profiles.push(...await safeSelectProfiles(
      supabase.from("profiles").select(PROFILE_SELECT).ilike("bio", pattern).limit(10),
      `searchProfiles bio ${term}`,
    ))
  }

  return uniqueProfiles(profiles)
}


function uniqueProfiles(values: DbProfile[]) {
  const map = new Map<string, DbProfile>()
  for (const profile of values) {
    if (!profile.id) continue
    map.set(profile.id, profile)
  }
  return [...map.values()]
}

async function findExactAuthorProfiles(supabase: SupabaseClient, authorUsername: string | null) {
  const username = normalizeAuthorUsername(authorUsername)
  if (!username) return [] as DbProfile[]

  const profiles: DbProfile[] = []

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select(PROFILE_SELECT)
      .ilike("username", username)
      .limit(10)

    if (error) {
      console.error("findExactAuthorProfiles username error:", error)
    } else {
      profiles.push(...((data ?? []) as unknown as DbProfile[]))
    }
  } catch (error) {
    console.error("findExactAuthorProfiles username crash:", error)
  }

  return uniqueProfiles(
    profiles.filter((profile) => (profile.username ?? "").toLowerCase() === username.toLowerCase()),
  )
}

async function searchByContent(supabase: SupabaseClient, terms: string[], range: SearchTimeRange | null) {
  const filtered = termsForDatabaseSearch(terms)
  if (filtered.length === 0) return [] as DbPost[]

  const posts: DbPost[] = []
  for (const term of filtered) {
    const pattern = `%${term}%`
    posts.push(...await safeSelectPosts(
      applyTimeRange(publicPostsQuery(supabase), range).ilike("content", pattern).order("created_at", { ascending: false }).limit(30),
      `searchByContent content ${term}`,
    ))
    posts.push(...await safeSelectPosts(
      applyTimeRange(publicPostsQuery(supabase), range).ilike("client_name", pattern).order("created_at", { ascending: false }).limit(12),
      `searchByContent client_name ${term}`,
    ))
    posts.push(...await safeSelectPosts(
      applyTimeRange(publicPostsQuery(supabase), range).ilike("prefecture", pattern).order("created_at", { ascending: false }).limit(12),
      `searchByContent prefecture ${term}`,
    ))
    posts.push(...await safeSelectPosts(
      applyTimeRange(publicPostsQuery(supabase), range).ilike("city", pattern).order("created_at", { ascending: false }).limit(12),
      `searchByContent city ${term}`,
    ))
  }

  return uniquePosts(posts)
}

function uniquePosts(posts: DbPost[]) {
  const map = new Map<string, DbPost>()
  for (const post of posts) {
    if (post.id) map.set(post.id, post)
  }
  return [...map.values()]
}

async function searchByAuthors(supabase: SupabaseClient, authorIds: string[], range: SearchTimeRange | null) {
  if (authorIds.length === 0) return [] as DbPost[]
  return await safeSelectPosts(
    applyTimeRange(publicPostsQuery(supabase), range).in("user_id", authorIds).order("created_at", { ascending: false }).limit(30),
    "searchByAuthors",
  )
}

async function latestPosts(supabase: SupabaseClient, authorIds: string[], rowLimit = 60, range: SearchTimeRange | null = null) {
  let query: PostQuery = applyTimeRange(publicPostsQuery(supabase), range)
  query = query.order("created_at", { ascending: false }).limit(rowLimit)
  if (authorIds.length > 0) query = query.in("user_id", authorIds)
  return await safeSelectPosts(query, "latestPosts")
}

async function popularPosts(supabase: SupabaseClient, authorIds: string[], rowLimit = 60, range: SearchTimeRange | null = null) {
  let query: PostQuery = applyTimeRange(publicPostsQuery(supabase), range)
  query = query.order("likes_count", { ascending: false }).order("reposts_count", { ascending: false }).order("comments_count", { ascending: false }).limit(rowLimit)
  if (authorIds.length > 0) query = query.in("user_id", authorIds)
  return await safeSelectPosts(query, "popularPosts")
}

async function searchByHashtag(supabase: SupabaseClient, hashtag: string | null, terms: string[], range: SearchTimeRange | null) {
  const tags = termsForDatabaseSearch([hashtag ?? "", ...terms])
  if (tags.length === 0) return [] as DbPost[]

  try {
    const hashtagRows: { id?: string }[] = []
    for (const tag of tags) {
      const { data, error } = await supabase.from("hashtags").select("id, tag").ilike("tag", `%${tag}%`).limit(10)
      if (error) {
        console.error("searchByHashtag hashtags error:", error)
      } else {
        hashtagRows.push(...((data ?? []) as { id?: string }[]))
      }
    }

    const ids = [...new Set(hashtagRows.map((item) => item.id).filter((id): id is string => Boolean(id)))]
    if (ids.length === 0) return []
    const { data: links, error: linkError } = await supabase.from("post_hashtags").select("post_id").in("hashtag_id", ids).limit(50)
    if (linkError) {
      console.error("searchByHashtag links error:", linkError)
      return []
    }
    const postIds = [...new Set(((links ?? []) as { post_id?: string }[]).map((item) => item.post_id).filter((id): id is string => Boolean(id)))]
    if (postIds.length === 0) return []
    return await safeSelectPosts(
      applyTimeRange(publicPostsQuery(supabase), range).in("id", postIds).limit(50),
      "searchByHashtag posts",
    )
  } catch (error) {
    console.error("searchByHashtag crash:", error)
    return []
  }
}


function scorePost(post: DbPost, terms: string[], mode: SearchMode, includeProfileScore: boolean) {
  const profile = getProfile(post)
  const contentText = `${post.content} ${post.client_name ?? ""} ${post.prefecture ?? ""} ${post.city ?? ""}`.toLowerCase()
  const profileText = `${profile?.username ?? ""} ${profile?.display_name ?? ""} ${profile?.bio ?? ""}`.toLowerCase()
  let score = 0

  for (const term of terms) {
    const lowered = normalizeTerm(term).toLowerCase()
    if (!lowered) continue

    const weight = Math.min(Math.max(lowered.length, 2), 8)
    if (contentText.includes(lowered)) score += 8 + weight * 3

    if (includeProfileScore) {
      if (profileText.includes(lowered)) score += 6 + weight * 4
      if ((profile?.username ?? "").toLowerCase() === lowered) score += 24
      if ((profile?.display_name ?? "").toLowerCase().includes(lowered)) score += 14
    }
  }

  const likes = Number(post.likes_count ?? 0)
  const reposts = Number(post.reposts_count ?? 0)
  const comments = Number(post.comments_count ?? 0)
  score += Math.log1p(likes) + Math.log1p(reposts) + Math.log1p(comments)

  const ageHours = Math.max(1, (Date.now() - new Date(post.created_at).getTime()) / 36e5)
  if (mode === "latest" || mode === "search") score += Math.max(0, 168 - ageHours) / 6
  if (mode === "popular") score += likes * 0.03 + reposts * 0.05 + comments * 0.04

  return score
}

function rankPosts(posts: DbPost[], terms: string[], mode: SearchMode, limit: number, options?: { genericTimeline?: boolean }) {
  const map = new Map<string, DbPost>()
  for (const post of posts) {
    if (!post?.id || post.visibility !== "public" || !post.content?.trim()) continue
    map.set(post.id, post)
  }

  const take = Math.min(Math.max(limit, 1), 5)
  const scoringTerms = options?.genericTimeline ? [] : terms
  const sorted = [...map.values()]
    .map((post) => ({ post, score: scorePost(post, scoringTerms, mode, options?.genericTimeline !== true) }))
    .sort((a, b) => {
      if (options?.genericTimeline && mode !== "popular") {
        return new Date(b.post.created_at).getTime() - new Date(a.post.created_at).getTime()
      }
      return b.score - a.score
    })

  const candidates = sorted.map((item) => item.post)

  if (!options?.genericTimeline) {
    return candidates.slice(0, take)
  }

  const selected: DbPost[] = []
  const authorCounts = new Map<string, number>()
  const perAuthorLimit = 1

  for (const post of candidates) {
    const authorKey = post.user_id || "unknown"
    const count = authorCounts.get(authorKey) ?? 0
    if (count >= perAuthorLimit) continue

    selected.push(post)
    authorCounts.set(authorKey, count + 1)
    if (selected.length >= take) break
  }

  if (selected.length < take) {
    for (const post of candidates) {
      if (selected.some((item) => item.id === post.id)) continue
      selected.push(post)
      if (selected.length >= take) break
    }
  }

  return selected
}


function formatExactAuthorNoResult(authorUsername: string, profiles: DbProfile[], range: SearchTimeRange | null) {
  const header = [
    `現在日時(JST): ${toJstDateLabel()}`,
    range ? `検索期間: ${range.label}` : "検索期間: 指定なし",
    `指定ユーザー: @${authorUsername}`,
  ].join("\n")

  if (profiles.length === 0) {
    return `${header}\n\n@${authorUsername} に完全一致するアカウントは見つかりませんでした。別の語句では検索していません。`
  }

  const profileLines = profiles.map((profile) => [
    `アカウント:${profile.display_name || "無名"}(@${profile.username || authorUsername})`,
    profile.bio ? `プロフィール:${profile.bio}` : "プロフィール:記載なし",
  ].join("\n")).join("\n\n")

  return `${header}\n\n${profileLines}\n\nこのアカウントの公開投稿は見つかりませんでした。別の語句では検索していません。`
}


function formatProfileOnlyResult(queryTerms: string[], profiles: DbProfile[], range: SearchTimeRange | null) {
  const header = [
    `現在日時(JST): ${toJstDateLabel()}`,
    range ? `検索期間: ${range.label}` : "検索期間: 指定なし",
    `検索対象:${queryTerms.join(" / ") || "指定なし"}`,
  ].join("\n")

  if (profiles.length === 0) {
    return `${header}\n\n該当する公開投稿は見つかりませんでした。`
  }

  const profileLines = profiles.slice(0, 5).map((profile) => [
    `アカウント:${profile.display_name || "無名"}(@${profile.username || "unknown"})`,
    profile.bio ? `プロフィール:${profile.bio}` : "プロフィール:記載なし",
  ].join("\n")).join("\n\n")

  return `${header}\n\n${profileLines}\n\n一致するアカウントは見つかりましたが、この条件で参照できる公開投稿は見つかりませんでした。上のプロフィール情報だけを根拠に答えてください。`
}

function formatStrictRangeFallback(primaryContext: string, fallbackPosts: DbPost[], fallbackReferences: ReferencedPost[]) {
  const fallbackContext = fallbackPosts.length > 0
    ? formatPostsForTool(fallbackPosts, null)
    : "直近の公開投稿も見つかりませんでした。"

  return {
    context: [
      primaryContext,
      "",
      "指定期間内の公開投稿は見つかりませんでした。以下は参考用の直近公開投稿です。これらを指定期間内の情報として断定しないでください。",
      fallbackContext,
    ].join("\n"),
    references: fallbackReferences,
  }
}

async function searchLimeNotePublicPosts(_req: Request, args: SearchToolArgs): Promise<SearchResult> {
  const supabase = createSearchSupabaseClient()
  if (!supabase) {
    return {
      context: "検索にはSUPABASE_SERVICE_ROLE_KEYの設定が必要です。公開投稿だけを対象に検索します。",
      references: [],
    }
  }

  const terms = expandSearchTerms(args)
  const timeRange = getSearchTimeRange(args)
  const noSpecificTarget = !args.authorUsername && !args.hashtag && terms.length === 0
  const effectiveMode: SearchMode = noSpecificTarget
    ? "latest"
    : (timeRange?.kind === "today" || timeRange?.kind === "yesterday") && args.mode === "search"
      ? "latest"
      : args.mode
  const timelineMode = isTimelineMode({ ...args, mode: effectiveMode }) || noSpecificTarget
  const effectiveAuthorUsername = shouldUseAuthorFilter(args) ? normalizeAuthorUsername(args.authorUsername) : null

  if (effectiveAuthorUsername) {
    const exactProfiles = await findExactAuthorProfiles(supabase, effectiveAuthorUsername)
    const exactAuthorIds = exactProfiles.map((profile) => profile.id).filter((id): id is string => Boolean(id))

    if (exactAuthorIds.length === 0) {
      return {
        context: formatExactAuthorNoResult(effectiveAuthorUsername, [], timeRange),
        references: [],
      }
    }

    const authorPosts = effectiveMode === "popular"
      ? await popularPosts(supabase, exactAuthorIds, 60, timeRange)
      : await latestPosts(supabase, exactAuthorIds, 60, timeRange)

    const postsWithProfiles = await attachProfiles(supabase, authorPosts)
    const ranked = rankPosts(postsWithProfiles, [], effectiveMode, args.limit, { genericTimeline: false })

    if (ranked.length === 0) {
      return {
        context: formatExactAuthorNoResult(effectiveAuthorUsername, exactProfiles, timeRange),
        references: [],
      }
    }

    return {
      context: formatPostsForTool(ranked, timeRange),
      references: ranked.map(toReferencePost),
    }
  }

  const primaryTerms = getPrimaryEntityTerms(args, terms)
  const matchedProfiles = !timelineMode && primaryTerms.length > 0
    ? await searchProfiles(supabase, primaryTerms)
    : []
  const authorIds = [...new Set(matchedProfiles.map((profile) => profile.id).filter((id): id is string => Boolean(id)))]
  const searchTerms = timelineMode ? [] : primaryTerms.length > 0 ? primaryTerms : terms

  const contentPostsPromise = searchByContent(supabase, searchTerms, timeRange)
  const authorPostsPromise = searchByAuthors(supabase, authorIds, timeRange)
  const hashtagPostsPromise = searchByHashtag(supabase, args.hashtag, terms, timeRange)

  let posts: DbPost[] = []

  if (effectiveMode === "latest") {
    const [latestGlobal, latestAuthor, content, author, hashtag] = await Promise.all([
      latestPosts(supabase, [], timelineMode ? 120 : 60, timeRange),
      authorIds.length > 0 ? latestPosts(supabase, authorIds, 40, timeRange) : Promise.resolve([] as DbPost[]),
      contentPostsPromise,
      authorPostsPromise,
      hashtagPostsPromise,
    ])
    posts = [...latestGlobal, ...latestAuthor, ...content, ...author, ...hashtag]
  } else if (effectiveMode === "popular") {
    const [popularGlobal, popularAuthor, content, author, hashtag] = await Promise.all([
      popularPosts(supabase, [], timelineMode ? 120 : 60, timeRange),
      authorIds.length > 0 ? popularPosts(supabase, authorIds, 40, timeRange) : Promise.resolve([] as DbPost[]),
      contentPostsPromise,
      authorPostsPromise,
      hashtagPostsPromise,
    ])
    posts = [...popularGlobal, ...popularAuthor, ...content, ...author, ...hashtag]
  } else if (timelineMode) {
    const [latestGlobal, popularGlobal, content, author, hashtag] = await Promise.all([
      latestPosts(supabase, [], 120, timeRange),
      popularPosts(supabase, [], 120, timeRange),
      contentPostsPromise,
      authorPostsPromise,
      hashtagPostsPromise,
    ])
    posts = [...latestGlobal, ...popularGlobal, ...content, ...author, ...hashtag]
  } else {
    const [content, author, hashtag] = await Promise.all([contentPostsPromise, authorPostsPromise, hashtagPostsPromise])
    posts = [...content, ...author, ...hashtag]
  }

  if (posts.length === 0 && timeRange?.strict) {
    const fallbackPosts = await attachProfiles(supabase, await latestPosts(supabase, [], 20, null))
    const fallbackRanked = rankPosts(fallbackPosts, [], "latest", args.limit, { genericTimeline: true })
    return formatStrictRangeFallback(
      formatPostsForTool([], timeRange),
      fallbackRanked,
      fallbackRanked.map(toReferencePost),
    )
  }

  if (posts.length === 0 && (effectiveMode === "latest" || effectiveMode === "popular")) {
    posts = effectiveMode === "latest" ? await latestPosts(supabase, [], 80, null) : await popularPosts(supabase, [], 80, null)
  }

  posts = await attachProfiles(supabase, posts)
  posts = applyPrimaryEntityFilter(posts, primaryTerms, !timelineMode)

  const ranked = rankPosts(posts, terms, effectiveMode, args.limit, { genericTimeline: timelineMode })

  if (ranked.length === 0 && matchedProfiles.length > 0) {
    return {
      context: formatProfileOnlyResult(primaryTerms, matchedProfiles, timeRange),
      references: [],
    }
  }

  return {
    context: formatPostsForTool(ranked, timeRange),
    references: ranked.map(toReferencePost),
  }
}



async function executeDirectSearch(
  req: Request,
  controller: ReadableStreamDefaultController<Uint8Array>,
  args: SearchToolArgs,
): Promise<ToolExecutionResult> {
  sse(controller, { type: "sns_search_start" })

  try {
    const result = await searchLimeNotePublicPosts(req, args)
    sse(controller, { type: "sns_search_end", posts: result.references })
    if (result.references.length > 0) sse(controller, { type: "sns_reference_posts", posts: result.references })

    return {
      hasSearchTool: true,
      references: result.references,
      searchContext: result.context,
      toolMessage: {
        role: "system",
        content: result.context,
      },
    }
  } catch (error) {
    console.error("direct search_limenote_public_posts failed:", error)
    sse(controller, { type: "sns_search_end", posts: [] })

    return {
      hasSearchTool: true,
      references: [],
      searchContext: "公開投稿の検索中に一時的なエラーが発生しました。",
      toolMessage: {
        role: "system",
        content: "公開投稿の検索中に一時的なエラーが発生しました。",
      },
    }
  }
}

async function executeToolCall(
  req: Request,
  controller: ReadableStreamDefaultController<Uint8Array>,
  toolCall: GroqToolCall,
  latestUserText: string,
): Promise<ToolExecutionResult> {
  if (toolCall.function.name === "create_html_preview") {
    const args = parseHtmlArgs(toolCall.function.arguments, latestUserText)
    const artifact = { title: args.title, language: "html", html: args.html }
    sse(controller, { type: "coding_artifact_start" })
    sse(controller, { type: "coding_artifact", artifact })
    return {
      hasCodingTool: true,
      toolMessage: {
        role: "tool",
        tool_call_id: toolCall.id,
        content: `HTMLプレビューを作成しました。タイトル: ${args.title}`,
      },
    }
  }

  if (toolCall.function.name === "search_limenote_public_posts") {
    const args = parseSearchArgs(toolCall.function.arguments, latestUserText)
    sse(controller, { type: "sns_search_start" })

    try {
      const result = await searchLimeNotePublicPosts(req, args)
      sse(controller, { type: "sns_search_end", posts: result.references })
      if (result.references.length > 0) sse(controller, { type: "sns_reference_posts", posts: result.references })
      return {
        hasSearchTool: true,
        references: result.references,
        searchContext: result.context,
        toolMessage: {
          role: "tool",
          tool_call_id: toolCall.id,
          content: result.context,
        },
      }
    } catch (error) {
      console.error("search_limenote_public_posts failed:", error)
      sse(controller, { type: "sns_search_end", posts: [] })
      return {
        hasSearchTool: true,
        references: [],
        searchContext: "公開投稿の検索中に一時的なエラーが発生しました。",
        toolMessage: {
          role: "tool",
          tool_call_id: toolCall.id,
          content: "公開投稿の検索中に一時的なエラーが発生しました。検索結果なしとして回答してください。",
        },
      }
    }
  }

  return {
    toolMessage: {
      role: "tool",
      tool_call_id: toolCall.id,
      content: "このツールは利用できません。",
    },
  }
}

function uniqueReferencedPosts(results: ToolExecutionResult[]) {
  const map = new Map<string, ReferencedPost>()
  for (const result of results) {
    for (const post of result.references ?? []) {
      if (!map.has(post.id)) map.set(post.id, post)
    }
  }
  return [...map.values()]
}

function hasUsableSearchEvidence(result: ToolExecutionResult) {
  if ((result.references ?? []).length > 0) return true
  const context = result.searchContext ?? ""
  return /アカウント:|プロフィール:|表示名:|ユーザー名:|自己紹介:/.test(context)
}

function shouldAvoidGeneralKnowledgeFallback(text: string) {
  const normalized = text.trim()
  return /@[A-Za-z0-9_]+/.test(normalized) || /LimeNote|LimeAI|ライムノート|ねこ氏|ねこさん/.test(normalized)
}

function generalKnowledgeFallbackInstruction(latestUserText: string) {
  const avoidFallback = shouldAvoidGeneralKnowledgeFallback(latestUserText)

  return [
    "公開投稿検索では、この質問に使える投稿本文やプロフィール情報が得られませんでした。",
    avoidFallback
      ? "ただし、これはLimeNote内の未確認情報または@ユーザー名指定を含む質問です。公開投稿・プロフィールで確認できない内容を推測で断定しないでください。"
      : "検索結果がないこと自体はユーザーに説明しません。一般知識で答えられる質問なら、そのまま普通に直接答えてください。",
    "『公開投稿からは根拠を取得できませんでした』『検索結果が見つかりませんでした』『一般知識で答えられる内容は通常回答として続けてください』のようなメタ説明を出してはいけません。",
    "回答は短く自然な日本語にします。",
  ].join("\n")
}

function buildSearchFallbackAnswer(results: ToolExecutionResult[], latestUserText: string) {
  const posts = uniqueReferencedPosts(results).slice(0, 5)
  if (posts.length === 0) {
    return shouldAvoidGeneralKnowledgeFallback(latestUserText)
      ? "確認できる公開情報がありませんでした。"
      : "通常の知識で回答できる内容なら、そのまま質問に答えてください。"
  }

  const asksDefinition = /とは|って何|ってなに|何ですか|なにですか|教えて/.test(latestUserText)
  const first = posts[0]

  if (posts.length === 1) {
    const base = `${first.authorDisplayName}(@${first.authorUsername})の公開投稿では「${first.contentSnippet}」と書かれています。`
    return asksDefinition
      ? `${base} この投稿だけでは断定的な説明はできませんが、公開投稿の検索結果としてはこの内容が見つかっています。`
      : base
  }

  const lines = posts
    .slice(0, 3)
    .map((post) => `・${post.authorDisplayName}(@${post.authorUsername}): ${post.contentSnippet}`)
    .join("\n")

  return `公開投稿では次の内容が見つかりました。\n${lines}`
}

async function streamGroq(
  groqApiKey: string,
  body: unknown,
  controller: ReadableStreamDefaultController<Uint8Array>,
) {
  const response = await fetch(GROQ_CHAT_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${groqApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Groq stream ${response.status}: ${detail}`)
  }

  if (!response.body) throw new Error("No Groq stream body")
  const reader = response.body.getReader()
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (value) controller.enqueue(value)
  }
}

async function handleChatStream(req: Request, controller: ReadableStreamDefaultController<Uint8Array>) {
  const body = parseBody(await req.json())
  if (body.contents.length === 0) {
    sseText(controller, "メッセージを受け取れませんでした。")
    sseDone(controller)
    return
  }

  const groqApiKey = Deno.env.get("GROQ_API_KEY")
  if (!groqApiKey) {
    sseText(controller, "GROQ_API_KEY が設定されていません。")
    sseDone(controller)
    return
  }

  const model = body.model === "advanced" ? ADVANCED_MODEL : FAST_MODEL
  const latestUserText = getLatestUserText(body.contents)
  const routerContext = buildRouterContext(body.contents)
  const baseMessages = await buildBaseMessages(groqApiKey, body.contents, controller)
  const routerDecision = await classifyToolIntent(groqApiKey, latestUserText, routerContext)
  const forceHtmlPreview = shouldForceHtmlPreview(latestUserText, body.contents)
  const forcePublicPostSearch = shouldForcePublicPostSearch(latestUserText, body.contents)
  const toolIntent: ToolIntentDecision = forceHtmlPreview
    ? {
      action: routerDecision.action === "search" || forcePublicPostSearch ? "search_and_html" : "html",
      reason: "explicit_html_preview_request",
    }
    : routerDecision.action === "chat" && forcePublicPostSearch
      ? { action: "search", reason: "explicit_or_identity_search_request" }
      : routerDecision
  const availableTools = toolsForIntent(toolIntent.action)
  const allowedToolNames = new Set<string>(availableTools.map((tool) => tool.function.name))


  if (toolIntent.action === "html") {
    await executeDirectHtml(groqApiKey, model, controller, latestUserText, routerContext)
    return
  }

  if (toolIntent.action === "search_and_html") {
    const directSearchArgs = buildDirectSearchArgs(latestUserText, body.contents)
    const directSearchResult = await executeDirectSearch(req, controller, directSearchArgs)
    await executeDirectHtml(groqApiKey, model, controller, latestUserText, routerContext, directSearchResult.searchContext ?? null)
    return
  }

  if (toolIntent.action === "search") {
    const directSearchArgs = buildDirectSearchArgs(latestUserText, body.contents)
    const directSearchResult = await executeDirectSearch(req, controller, directSearchArgs)
    const hasReferences = (directSearchResult.references ?? []).length > 0
    const hasProfileEvidence = /アカウント:|プロフィール:|表示名:|ユーザー名:|自己紹介:/.test(directSearchResult.searchContext ?? "")
    const hasEvidence = hasUsableSearchEvidence(directSearchResult)

    if (!hasEvidence) {
      try {
        await streamGroq(groqApiKey, {
          model,
          messages: [
            ...baseMessages,
            { role: "system", content: generalKnowledgeFallbackInstruction(latestUserText) },
          ],
          stream: true,
          temperature: 0.55,
          max_completion_tokens: ANSWER_MAX_TOKENS,
        }, controller)
      } catch (error) {
        console.error("general fallback Groq stream failed:", error)
        sseText(controller, buildSearchFallbackAnswer([directSearchResult], latestUserText))
        sseDone(controller)
      }

      return
    }

    const finalInstruction = [
      "公開投稿の検索結果がある場合は、その本文と投稿日時を確認して短く答えます。",
      "投稿者の認証状態や公式表示は、回答可否・順位・信頼度の根拠にしません。公式以外の公開投稿も同じ公開投稿として扱います。",
      "@ユーザー名の検索では別の語句へ言い換えず、そのユーザーの結果だけを使います。",
      "検索結果ヘッダーの現在日時や検索期間だけを回答本文にしてはいけません。投稿本文またはプロフィール情報がある場合はその内容を答えます。",
      "期間指定がある検索で期間外の直近投稿が参考として渡された場合は、指定期間内の情報として断定しません。",
      "ユーザーの質問をそのまま聞き返すだけで終わってはいけません。検索結果がある場合は必ず中身を要約します。",
      hasReferences
        ? "公開投稿の本文を根拠に答えます。"
        : hasProfileEvidence
          ? "公開投稿本文がなくてもプロフィール情報がある場合は、そのプロフィール情報だけを根拠に答えます。"
          : "一般知識で答えられる質問なら、検索結果がないことを説明せず通常知識で直接答えます。",
    ].join("\n")

    try {
      await streamGroq(groqApiKey, {
        model,
        messages: [
          ...baseMessages,
          { role: "system", content: `検索結果:\n${directSearchResult.searchContext ?? ""}` },
          { role: "system", content: finalInstruction },
        ],
        stream: true,
        temperature: 0.35,
        max_completion_tokens: ANSWER_MAX_TOKENS,
      }, controller)
    } catch (error) {
      console.error("direct search final Groq stream failed:", error)
      sseText(controller, buildSearchFallbackAnswer([directSearchResult], latestUserText))
      sseDone(controller)
    }

    return
  }


  if (availableTools.length === 0) {
    await streamGroq(groqApiKey, {
      model,
      messages: [
        ...baseMessages,
        { role: "system", content: toolInstructionForIntent("chat") },
      ],
      stream: true,
      temperature: 0.6,
      max_completion_tokens: ANSWER_MAX_TOKENS,
    }, controller)
    return
  }

  let firstMessage: GroqChoiceMessage | undefined

  try {
    const firstResponse = await callGroqJson(groqApiKey, {
      model,
      messages: [
        ...baseMessages,
        {
          role: "system",
          content: [
            toolInstructionForIntent(toolIntent.action),
            `内部ルーター判定: ${toolIntent.action} / ${toolIntent.reason}`,
            "ツール引数は最新のユーザー発話の意図から作成してください。過去の検索話題を勝手に引き継がないでください。",
          ].join("\n"),
        },
      ],
      tools: availableTools,
      tool_choice: toolChoiceForIntent(toolIntent.action),
      stream: false,
      temperature: 0.2,
      max_completion_tokens: 2600,
    })
    firstMessage = firstResponse.choices?.[0]?.message
  } catch (error) {
    console.error("first Groq call failed:", error)
    await streamGroq(groqApiKey, {
      model,
      messages: baseMessages,
      stream: true,
      temperature: 0.6,
      max_completion_tokens: ANSWER_MAX_TOKENS,
    }, controller)
    return
  }

  const toolCalls = getToolCalls(firstMessage?.tool_calls)
    .filter((toolCall) => allowedToolNames.has(toolCall.function.name))
    .slice(0, 4)

  if (toolCalls.length === 0) {
    sseText(controller, firstMessage?.content || "回答を生成できませんでした。")
    sseDone(controller)
    return
  }

  const toolResults: ToolExecutionResult[] = []
  for (const toolCall of toolCalls) {
    toolResults.push(await executeToolCall(req, controller, toolCall, latestUserText))
  }

  const hasSearchTool = toolResults.some((result) => result.hasSearchTool)
  const hasCodingTool = toolResults.some((result) => result.hasCodingTool)
  const hasSearchEvidence = toolResults.some((result) => result.hasSearchTool && hasUsableSearchEvidence(result))

  const finalInstruction = [
    hasSearchTool && hasSearchEvidence ? "公開投稿の検索結果がある時は、投稿本文を主情報として読み、投稿日時は必要な時だけ確認します。検索結果ヘッダーの現在日時や検索期間だけを回答にしてはいけません。投稿者の認証状態や公式表示は、回答可否・順位・信頼度の根拠にしません。公式以外の公開投稿も同じ公開投稿として扱います。@ユーザー名の検索では別の語句へ言い換えず、そのユーザーの結果だけを使います。投稿番号、内部ラベル、取得中という表現は使いません。" : "",
    hasSearchTool && !hasSearchEvidence ? generalKnowledgeFallbackInstruction(latestUserText) : "",
    hasCodingTool ? "HTMLプレビューは画面に表示済みです。回答では作成したことを短く伝え、コード全文は貼りません。" : "",
    "回答は短くまとめます。",
  ].filter(Boolean).join("\n")

  const toolContextMessages: GroqMessage[] = toolResults
    .filter((result) => !result.hasSearchTool || hasUsableSearchEvidence(result))
    .map((result, index) => ({
      role: "system" as const,
      content: `ツール結果${index + 1}:\n${result.searchContext ?? result.toolMessage.content ?? "結果なし"}`,
    }))

  const finalMessages: GroqMessage[] = [
    ...baseMessages,
    ...toolContextMessages,
    { role: "system", content: finalInstruction },
  ]

  try {
    await streamGroq(groqApiKey, {
      model,
      messages: finalMessages,
      stream: true,
      temperature: 0.6,
      max_completion_tokens: ANSWER_MAX_TOKENS,
    }, controller)
  } catch (error) {
    console.error("final Groq stream failed:", error)
    const fallback = hasSearchTool
      ? buildSearchFallbackAnswer(toolResults, latestUserText)
      : "回答生成中に一時的なエラーが発生しました。もう一度お試しください。"
    sseText(controller, fallback)
    sseDone(controller)
  }
}

Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders })
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await handleChatStream(req, controller)
      } catch (error) {
        console.error("limeai fatal error:", error)
        sseText(controller, "一時的なエラーが発生しました。もう一度お試しください。")
        sseDone(controller)
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  })
})
