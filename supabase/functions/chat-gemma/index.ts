import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type ClientContent = {
  role: "user" | "model"
  parts?: {
    text?: string
  }[]
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

type SearchToolArgs = {
  query: string
  terms: string[]
  mode: SearchMode
  authorUsername: string | null
  hashtag: string | null
  limit: number
}

type HtmlPreviewToolArgs = {
  title: string
  html: string
}

type CodingArtifact = {
  title: string
  language: "html"
  html: string
}

type DbProfile = {
  id: string
  username: string
  display_name: string
  bio: string | null
  is_official: boolean | null
  bot_enabled: boolean | null
  prefecture: string | null
  city: string | null
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

type ProfileLite = {
  id: string
  username: string
  display_name: string
  bio: string | null
}

type HashtagLite = {
  id: string
  tag: string
}

type PostHashtagLink = {
  post_id: string
}

type ReferencedPost = {
  id: string
  authorUsername: string
  authorDisplayName: string
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

type RequestBody = {
  contents?: ClientContent[]
  model?: "fast" | "advanced"
}

type LimeSupabaseClient = SupabaseClient

const encoder = new TextEncoder()

const RECENT_CHAT_MESSAGE_LIMIT = 6
const SUMMARY_TRIGGER_CHARS = 2400
const SUMMARY_INPUT_MAX_CHARS = 2000
const SUMMARY_MAX_CHARS = 200
const ANSWER_MAX_CHARS = 200
const ANSWER_MAX_TOKENS = 650
const SUMMARY_MODEL = "llama-3.1-8b-instant"

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
  city,
  profiles!posts_user_id_fkey (
    id,
    username,
    display_name,
    bio,
    is_official,
    bot_enabled,
    prefecture,
    city
  )
`

const searchTool = {
  type: "function",
  function: {
    name: "search_limenote_public_posts",
    description:
      "LimeNote内の公開SNS投稿だけを検索する。ユーザーが投稿、ニュース、最新情報、近況、話題、特定ユーザー、ハッシュタグ、みんなの反応を聞いた時に使う。『最新のニュースは』『今日のニュースは』のような短い質問もLimeNote公開投稿検索として扱う。通常の挨拶、雑談、翻訳、コード、数学、一般知識では使わない。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: {
          type: "string",
          description: "検索したい内容を短く書く。",
        },
        terms: {
          type: "array",
          items: {
            type: "string",
          },
          description: "検索に使う語句。ユーザー名は @ なし、ハッシュタグは # なしでもよい。",
        },
        mode: {
          type: "string",
          enum: ["search", "latest", "popular"],
          description: "latest は最新投稿、popular は反応数重視、search は語句検索。",
        },
        authorUsername: {
          type: ["string", "null"],
          description: "@cat など投稿者が明確な時のユーザー名。@ は付けない。",
        },
        hashtag: {
          type: ["string", "null"],
          description: "#AI などタグが明確な時のタグ名。# は付けない。",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 5,
          description: "取得件数。通常は3。",
        },
      },
      required: ["query", "terms", "mode", "authorUsername", "hashtag", "limit"],
    },
  },
} as const

const htmlPreviewTool = {
  type: "function",
  function: {
    name: "create_html_preview",
    description:
      "ユーザーが簡単なWebサイト、HTMLページ、ランディングページ、プロフィールページ、紹介サイト、プレビュー付きコードを作ってほしい時に使う。通常の説明、質問回答、SNS検索では使わない。HTMLは単体で動く完全なHTMLにする。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: {
          type: "string",
          description: "作品名。",
        },
        html: {
          type: "string",
          description: "<!doctype html> から始まる単体HTML。CSSはstyleタグ、必要なJSはscriptタグに含める。",
        },
      },
      required: ["title", "html"],
    },
  },
} as const

function fixedHtmlPreviewTool() {
  return {
    ...htmlPreviewTool,
    function: {
      ...htmlPreviewTool.function,
      parameters: {
        ...htmlPreviewTool.function.parameters,
        additionalProperties: false,
      },
    },
  }
}

function fixedSearchTool() {
  return {
    ...searchTool,
    function: {
      ...searchTool.function,
      parameters: {
        ...searchTool.function.parameters,
        additionalProperties: false,
      },
    },
  }
}

function enqueueEvent(controller: ReadableStreamDefaultController<Uint8Array>, payload: unknown) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
}

function enqueueDone(controller: ReadableStreamDefaultController<Uint8Array>) {
  controller.enqueue(encoder.encode("data: [DONE]\n\n"))
}

function enqueueText(controller: ReadableStreamDefaultController<Uint8Array>, text: string) {
  if (!text) return

  enqueueEvent(controller, {
    choices: [
      {
        delta: {
          content: text,
        },
      },
    ],
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isClientContent(value: unknown): value is ClientContent {
  if (!isRecord(value)) return false

  const role = value.role

  if (role !== "user" && role !== "model") return false

  const parts = value.parts

  if (parts === undefined) return true
  if (!Array.isArray(parts)) return false

  return parts.every((part) => {
    if (!isRecord(part)) return false

    const text = part.text

    return text === undefined || typeof text === "string"
  })
}

function parseRequestBody(value: unknown): RequestBody {
  if (!isRecord(value)) {
    return {}
  }

  const contentsValue = value.contents
  const modelValue = value.model

  const contents = Array.isArray(contentsValue)
    ? contentsValue.filter(isClientContent)
    : undefined

  const model = modelValue === "fast" || modelValue === "advanced"
    ? modelValue
    : undefined

  return {
    contents,
    model,
  }
}

function getText(item: ClientContent) {
  return item.parts?.map((part) => part.text ?? "").join("\n").trim() ?? ""
}

function removeSystemBlock(text: string) {
  return text.replace(/【システム命令:[\s\S]*?】/g, " ").trim()
}

function getLatestUserText(contents: ClientContent[]) {
  for (let i = contents.length - 1; i >= 0; i--) {
    const item = contents[i]

    if (item.role !== "user") continue

    const text = removeSystemBlock(getText(item))

    if (text) return text
  }

  return ""
}

function normalizeTerm(term: string) {
  return term
    .replace(/^[@#]/, "")
    .replace(/[,%()*]/g, "")
    .trim()
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function expandSearchTerms(args: SearchToolArgs) {
  const queryTerms =
    args.query.match(/@[a-zA-Z0-9_]+|#[\p{L}\p{N}_]+|[a-zA-Z0-9_]{2,}|[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー]{2,}/gu) ?? []

  const baseTerms = [
    ...args.terms,
    ...queryTerms,
    args.authorUsername ?? "",
    args.hashtag ?? "",
  ]

  const lowerQuery = args.query.toLowerCase()

  if (args.query.includes("ニュース") || lowerQuery.includes("news")) {
    baseTerms.push("ニュース", "news", "News", "LimeNews", "お知らせ", "告知")
  }

  if (args.query.includes("ねこ") || lowerQuery.includes("cat")) {
    baseTerms.push("cat", "ねこ")
  }

  return uniqueStrings(baseTerms)
    .map(normalizeTerm)
    .filter((term) => term.length >= 1)
    .slice(0, 10)
}

function buildOrFilter(columns: string[], terms: string[]) {
  const safeTerms = terms
    .map(normalizeTerm)
    .filter((term) => term.length >= 2)

  return safeTerms
    .flatMap((term) => columns.map((column) => `${column}.ilike.*${term}*`))
    .join(",")
}

function getProfile(post: DbPost) {
  const profile = post.profiles

  if (Array.isArray(profile)) {
    return profile[0] ?? null
  }

  return profile ?? null
}

function makeSnippet(text: string, maxLength = 160) {
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

function formatToolResult(posts: DbPost[]) {
  if (posts.length === 0) {
    return "公開投稿は見つかりませんでした。"
  }

  return posts
    .slice(0, 3)
    .map((post, index) => {
      const profile = getProfile(post)

      return [
        `${index + 1}. ${profile?.display_name || "無名"}(@${profile?.username || "unknown"})${profile?.is_official ? "/公式" : ""}`,
        `時刻:${post.created_at}`,
        `本文:${makeSnippet(post.content, 140)}`,
        `反応:いいね${post.likes_count ?? 0}/RP${post.reposts_count ?? 0}/返信${post.comments_count ?? 0}`,
      ].join("\n")
    })
    .join("\n\n")
}

function scorePost(post: DbPost, terms: string[], mode: SearchMode) {
  const profile = getProfile(post)
  const content = (post.content ?? "").toLowerCase()
  const username = (profile?.username ?? "").toLowerCase()
  const displayName = (profile?.display_name ?? "").toLowerCase()
  const bio = (profile?.bio ?? "").toLowerCase()

  let score = 0

  for (const rawTerm of terms) {
    const term = normalizeTerm(rawTerm).toLowerCase()

    if (!term) continue

    if (content.includes(term)) score += 10
    if (username === term) score += 20
    if (username.includes(term)) score += 12
    if (displayName.toLowerCase().includes(term)) score += 8
    if (bio.includes(term)) score += 4
  }

  const likes = Number(post.likes_count ?? 0)
  const reposts = Number(post.reposts_count ?? 0)
  const comments = Number(post.comments_count ?? 0)

  score += Math.log1p(likes) * 0.8
  score += Math.log1p(reposts) * 1.0
  score += Math.log1p(comments) * 0.7

  const createdMs = new Date(post.created_at).getTime()
  const ageHours = Math.max(1, (Date.now() - createdMs) / 1000 / 60 / 60)
  const recentScore = Math.max(0, 24 * 7 - ageHours) / 24

  if (mode === "latest") {
    score += recentScore * 3
  }

  if (mode === "popular") {
    score += likes * 0.03 + reposts * 0.06 + comments * 0.04
  }

  return score
}

function dedupeAndRank(posts: DbPost[], terms: string[], mode: SearchMode, limit: number) {
  const map = new Map<string, DbPost>()

  for (const post of posts) {
    if (!post?.id) continue
    if (post.visibility !== "public") continue
    if (!post.content?.trim()) continue

    map.set(post.id, post)
  }

  return [...map.values()]
    .map((post) => ({
      post,
      score: scorePost(post, terms, mode),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(Math.max(limit, 1), 5))
    .map((item) => item.post)
}

async function fetchPostsByIds(supabase: LimeSupabaseClient, ids: string[]) {
  const uniqueIds = [...new Set(ids)].filter(Boolean)

  if (uniqueIds.length === 0) return []

  const { data, error } = await supabase
    .from("posts")
    .select(POST_SELECT)
    .eq("visibility", "public")
    .in("id", uniqueIds)
    .limit(20)

  if (error) {
    console.error("fetchPostsByIds error:", error)
    return []
  }

  return (data ?? []) as unknown as DbPost[]
}

async function searchProfiles(supabase: LimeSupabaseClient, terms: string[]) {
  const profileTerms = terms
    .map(normalizeTerm)
    .filter((term) => term.length >= 2)
    .slice(0, 8)

  if (profileTerms.length === 0) return []

  const orFilter = buildOrFilter(["username", "display_name", "bio"], profileTerms)

  if (!orFilter) return []

  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, bio")
    .or(orFilter)
    .limit(10)

  if (error) {
    console.error("searchProfiles error:", error)
    return []
  }

  return (data ?? []) as unknown as ProfileLite[]
}

async function findAuthorIds(supabase: LimeSupabaseClient, authorUsername: string | null, terms: string[]) {
  const ids = new Set<string>()

  if (authorUsername) {
    const username = normalizeTerm(authorUsername)

    if (username) {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, display_name, bio")
        .ilike("username", username)
        .limit(3)

      if (!error) {
        for (const profile of (data ?? []) as unknown as ProfileLite[]) {
          ids.add(profile.id)
        }
      }
    }
  }

  for (const profile of await searchProfiles(supabase, terms)) {
    ids.add(profile.id)
  }

  return [...ids]
}

async function searchByPostContent(supabase: LimeSupabaseClient, terms: string[]) {
  const orFilter = buildOrFilter(["content", "client_name", "prefecture", "city"], terms)

  if (!orFilter) return []

  const { data, error } = await supabase
    .from("posts")
    .select(POST_SELECT)
    .eq("visibility", "public")
    .or(orFilter)
    .order("created_at", { ascending: false })
    .limit(20)

  if (error) {
    console.error("searchByPostContent error:", error)
    return []
  }

  return (data ?? []) as unknown as DbPost[]
}

async function searchByAuthors(supabase: LimeSupabaseClient, authorIds: string[]) {
  if (authorIds.length === 0) return []

  const { data, error } = await supabase
    .from("posts")
    .select(POST_SELECT)
    .eq("visibility", "public")
    .in("user_id", authorIds)
    .order("created_at", { ascending: false })
    .limit(20)

  if (error) {
    console.error("searchByAuthors error:", error)
    return []
  }

  return (data ?? []) as unknown as DbPost[]
}

async function searchByHashtag(supabase: LimeSupabaseClient, hashtag: string | null, terms: string[]) {
  const hashtagTerms = [
    hashtag ?? "",
    ...terms,
  ]
    .map(normalizeTerm)
    .filter((term) => term.length >= 1)
    .slice(0, 8)

  if (hashtagTerms.length === 0) return []

  const orFilter = buildOrFilter(["tag"], hashtagTerms)

  if (!orFilter) return []

  const { data: hashtags, error: hashtagError } = await supabase
    .from("hashtags")
    .select("id, tag")
    .or(orFilter)
    .limit(10)

  if (hashtagError) {
    console.error("searchByHashtag hashtags error:", hashtagError)
    return []
  }

  const hashtagIds = ((hashtags ?? []) as unknown as HashtagLite[])
    .map((item) => item.id)

  if (hashtagIds.length === 0) return []

  const { data: links, error: linkError } = await supabase
    .from("post_hashtags")
    .select("post_id")
    .in("hashtag_id", hashtagIds)
    .limit(30)

  if (linkError) {
    console.error("searchByHashtag links error:", linkError)
    return []
  }

  const postIds = ((links ?? []) as unknown as PostHashtagLink[])
    .map((item) => item.post_id)

  return await fetchPostsByIds(supabase, postIds)
}

async function getLatestPublicPosts(supabase: LimeSupabaseClient, authorIds: string[]) {
  let query = supabase
    .from("posts")
    .select(POST_SELECT)
    .eq("visibility", "public")
    .order("created_at", { ascending: false })
    .limit(12)

  if (authorIds.length > 0) {
    query = query.in("user_id", authorIds)
  }

  const { data, error } = await query

  if (error) {
    console.error("getLatestPublicPosts error:", error)
    return []
  }

  return (data ?? []) as unknown as DbPost[]
}

async function getPopularPublicPosts(supabase: LimeSupabaseClient, authorIds: string[]) {
  let query = supabase
    .from("posts")
    .select(POST_SELECT)
    .eq("visibility", "public")
    .order("likes_count", { ascending: false })
    .order("reposts_count", { ascending: false })
    .order("comments_count", { ascending: false })
    .limit(12)

  if (authorIds.length > 0) {
    query = query.in("user_id", authorIds)
  }

  const { data, error } = await query

  if (error) {
    console.error("getPopularPublicPosts error:", error)
    return []
  }

  return (data ?? []) as unknown as DbPost[]
}

function createSupabaseClient(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")

  if (!supabaseUrl) {
    console.error("SUPABASE_URL is missing")
    return null
  }

  if (serviceRoleKey) {
    return createClient(supabaseUrl, serviceRoleKey)
  }

  if (!anonKey) {
    console.error("SUPABASE_ANON_KEY is missing")
    return null
  }

  const authHeader = req.headers.get("Authorization") || `Bearer ${anonKey}`

  return createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
  })
}

async function searchLimeNotePublicPosts(req: Request, args: SearchToolArgs) {
  const supabase = createSupabaseClient(req)

  if (!supabase) {
    return {
      posts: [] as DbPost[],
      references: [] as ReferencedPost[],
      context: "検索用のSupabase接続が設定されていません。",
    }
  }

  const terms = expandSearchTerms(args)
  const authorIds = await findAuthorIds(supabase, args.authorUsername, terms)

  let posts: DbPost[] = []

  if (args.mode === "latest") {
    posts = [
      ...await getLatestPublicPosts(supabase, authorIds),
      ...await searchByPostContent(supabase, terms),
      ...await searchByAuthors(supabase, authorIds),
    ]
  } else if (args.mode === "popular") {
    posts = [
      ...await getPopularPublicPosts(supabase, authorIds),
      ...await searchByPostContent(supabase, terms),
      ...await searchByAuthors(supabase, authorIds),
    ]
  } else {
    const [contentPosts, authorPosts, hashtagPosts] = await Promise.all([
      searchByPostContent(supabase, terms),
      searchByAuthors(supabase, authorIds),
      searchByHashtag(supabase, args.hashtag, terms),
    ])

    posts = [
      ...contentPosts,
      ...authorPosts,
      ...hashtagPosts,
    ]
  }

  if (posts.length === 0 && (args.mode === "latest" || args.mode === "popular")) {
    posts = args.mode === "latest"
      ? await getLatestPublicPosts(supabase, [])
      : await getPopularPublicPosts(supabase, [])
  }

  const rankedPosts = dedupeAndRank(posts, terms, args.mode, args.limit)
  const references = rankedPosts.map(toReferencePost)
  const context = formatToolResult(rankedPosts)

  return {
    posts: rankedPosts,
    references,
    context,
  }
}

function getToolCalls(value: unknown): GroqToolCall[] {
  if (!Array.isArray(value)) return []

  return value
    .filter(isRecord)
    .map((item) => {
      const id = typeof item.id === "string" ? item.id : ""
      const type = item.type === "function" ? "function" : null
      const fn = isRecord(item.function) ? item.function : null
      const name = typeof fn?.name === "string" ? fn.name : ""
      const args = typeof fn?.arguments === "string" ? fn.arguments : ""

      if (!id || type !== "function" || !name) return null

      return {
        id,
        type,
        function: {
          name,
          arguments: args,
        },
      } satisfies GroqToolCall
    })
    .filter((item): item is GroqToolCall => item !== null)
}

function parseSearchArgs(text: string, latestUserText: string): SearchToolArgs {
  let parsed: unknown = null

  try {
    parsed = JSON.parse(text)
  } catch (_error) {
    parsed = null
  }

  const record = isRecord(parsed) ? parsed : {}

  const query = typeof record.query === "string" && record.query.trim()
    ? record.query.trim()
    : latestUserText

  const rawTerms = Array.isArray(record.terms)
    ? record.terms
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
    : []

  const mode: SearchMode =
    record.mode === "latest" || record.mode === "popular" || record.mode === "search"
      ? record.mode
      : "search"

  const authorUsername = typeof record.authorUsername === "string" && record.authorUsername.trim()
    ? normalizeTerm(record.authorUsername)
    : null

  const hashtag = typeof record.hashtag === "string" && record.hashtag.trim()
    ? normalizeTerm(record.hashtag)
    : null

  const limit = typeof record.limit === "number" && Number.isFinite(record.limit)
    ? Math.min(Math.max(Math.trunc(record.limit), 1), 5)
    : 3

  return {
    query,
    terms: rawTerms,
    mode,
    authorUsername,
    hashtag,
    limit,
  }
}

function parseHtmlPreviewArgs(text: string, latestUserText: string): HtmlPreviewToolArgs {
  let parsed: unknown = null

  try {
    parsed = JSON.parse(text)
  } catch (_error) {
    parsed = null
  }

  const record = isRecord(parsed) ? parsed : {}

  const title = typeof record.title === "string" && record.title.trim()
    ? record.title.trim().slice(0, 80)
    : "HTMLプレビュー"

  const rawHtml = typeof record.html === "string" && record.html.trim()
    ? record.html.trim()
    : `<!doctype html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body>
  <main>
    <h1>${latestUserText.replace(/[<>&]/g, "")}</h1>
  </main>
</body>
</html>`

  const html = rawHtml.toLowerCase().includes("<html")
    ? rawHtml
    : `<!doctype html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body>
${rawHtml}
</body>
</html>`

  return {
    title,
    html: html.slice(0, 24000),
  }
}

function toCodingArtifact(args: HtmlPreviewToolArgs): CodingArtifact {
  return {
    title: args.title,
    language: "html",
    html: args.html,
  }
}


function roleLabel(role: "user" | "model") {
  return role === "user" ? "ユーザー" : "LimeAI"
}

function limitText(text: string, maxChars: number) {
  const cleaned = text.trim()

  if (cleaned.length <= maxChars) return cleaned

  return `${cleaned.slice(0, maxChars).trimEnd()}…`
}

function splitChatContents(contents: ClientContent[]) {
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

function contentsToPlainHistory(items: ClientContent[], maxChars: number) {
  const text = items
    .map((item) => `${roleLabel(item.role)}: ${getText(item)}`)
    .join("\n")
    .trim()

  if (text.length <= maxChars) return text

  return text.slice(text.length - maxChars)
}

function countContentChars(items: ClientContent[]) {
  return items.reduce((sum, item) => sum + getText(item).length, 0)
}

async function summarizeOldChat(groqApiKey: string, olderItems: ClientContent[]) {
  if (olderItems.length === 0) return ""
  if (countContentChars(olderItems) < SUMMARY_TRIGGER_CHARS) return ""

  const historyText = contentsToPlainHistory(olderItems, SUMMARY_INPUT_MAX_CHARS)

  if (!historyText) return ""

  try {
    const response = await callGroqJson(groqApiKey, {
      model: SUMMARY_MODEL,
      messages: [
        {
          role: "system",
          content: `会話履歴を${SUMMARY_MAX_CHARS}字以内で要約してください。ユーザーの依頼、決定済みの仕様、作業中のコード方針、未解決の点だけを残してください。雑談や重複は削ってください。`,
        },
        {
          role: "user",
          content: historyText,
        },
      ],
      stream: false,
      temperature: 0.1,
      max_tokens: 520,
    })

    const summary = response.choices?.[0]?.message?.content ?? ""

    return limitText(summary, SUMMARY_MAX_CHARS)
  } catch (error) {
    console.error("summarizeOldChat error:", error)
    return ""
  }
}

async function buildBaseMessages(
  groqApiKey: string,
  contents: ClientContent[],
  controller: ReadableStreamDefaultController<Uint8Array>,
) {
  const messages: GroqMessage[] = []
  const { systemTexts, olderItems, recentItems } = splitChatContents(contents)

  const toolPolicy = [
    "あなたはLimeAIです。日本語で直接答えます。",
    `回答は原則${ANSWER_MAX_CHARS}字以内。必要な時だけ短い箇条書きを使います。`,
    "LimeNoteの公開投稿・ニュース・最新情報・近況・話題・特定ユーザー・ハッシュタグ・みんなの反応が必要な質問では、search_limenote_public_postsを呼びます。",
    "ユーザーがWebサイト、HTMLページ、プレビュー付きコードの作成を求めた時は、create_html_previewを呼びます。",
    "通常の挨拶、雑談、翻訳、一般説明、数学ではツールを呼びません。",
    "ツール結果がある時は、その内容から自然に短く答えます。取得中とは言わず、投稿番号も出しません。",
  ].join("\n")

  messages.push({
    role: "system",
    content: toolPolicy,
  })

  for (const systemText of systemTexts) {
    messages.push({
      role: "system",
      content: systemText,
    })
  }

  if (olderItems.length > 0 && countContentChars(olderItems) >= SUMMARY_TRIGGER_CHARS) {
    enqueueEvent(controller, {
      type: "conversation_summary_start",
    })

    const summary = await summarizeOldChat(groqApiKey, olderItems)

    if (summary) {
      messages.push({
        role: "system",
        content: `これまでの会話要約（${SUMMARY_MAX_CHARS}字以内）:\n${summary}`,
      })
    }

    enqueueEvent(controller, {
      type: "conversation_summary_end",
      used: Boolean(summary),
      chars: summary.length,
    })
  }

  for (const item of recentItems) {
    const text = getText(item)

    if (!text) continue

    messages.push({
      role: item.role === "model" ? "assistant" : "user",
      content: text,
    })
  }

  return messages
}

function contentsToGroqMessages(contents: ClientContent[]) {
  const messages: GroqMessage[] = []
  const { systemTexts, recentItems } = splitChatContents(contents)

  const toolPolicy = [
    "あなたはLimeAIです。日本語で直接答えます。",
    `回答は原則${ANSWER_MAX_CHARS}字以内。必要な時だけ短い箇条書きを使います。`,
    "LimeNoteの公開投稿・ニュース・最新情報・近況・話題・特定ユーザー・ハッシュタグ・みんなの反応が必要な質問では、search_limenote_public_postsを呼びます。",
    "ユーザーがWebサイト、HTMLページ、プレビュー付きコードの作成を求めた時は、create_html_previewを呼びます。",
    "通常の挨拶、雑談、翻訳、一般説明、数学ではツールを呼びません。",
    "ツール結果がある時は、その内容から自然に短く答えます。取得中とは言わず、投稿番号も出しません。",
  ].join("\n")

  messages.push({
    role: "system",
    content: toolPolicy,
  })

  for (const systemText of systemTexts) {
    messages.push({
      role: "system",
      content: systemText,
    })
  }

  for (const item of recentItems) {
    const text = getText(item)

    if (!text) continue

    messages.push({
      role: item.role === "model" ? "assistant" : "user",
      content: text,
    })
  }

  return messages
}

async function callGroqJson(groqApiKey: string, body: unknown): Promise<GroqChatResponse> {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${groqApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Groq Error (${response.status}): ${detail}`)
  }

  return await response.json() as GroqChatResponse
}

async function pipeGroqStream(
  groqResponse: Response,
  controller: ReadableStreamDefaultController<Uint8Array>,
) {
  if (!groqResponse.body) {
    throw new Error("No response body from Groq API")
  }

  const reader = groqResponse.body.getReader()

  while (true) {
    const { value, done } = await reader.read()

    if (done) break
    if (value) controller.enqueue(value)
  }
}

async function streamFinalGroqAnswer(
  groqApiKey: string,
  model: string,
  messages: GroqMessage[],
  controller: ReadableStreamDefaultController<Uint8Array>,
) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${groqApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: 0.6,
      max_tokens: ANSWER_MAX_TOKENS,
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Groq Error (${response.status}): ${detail}`)
  }

  await pipeGroqStream(response, controller)
}

async function handleChatStream(
  req: Request,
  controller: ReadableStreamDefaultController<Uint8Array>,
) {
  try {
    const rawBody = await req.json()
    const body = parseRequestBody(rawBody)
    const contents = body.contents
    const selectedModel = body.model

    if (!contents || contents.length === 0) {
      throw new Error('The "contents" field is missing in the request body')
    }

    const groqApiKey = Deno.env.get("GROQ_API_KEY")

    if (!groqApiKey) {
      throw new Error("GROQ_API_KEY is not set")
    }

    const model =
      selectedModel === "fast"
        ? "llama-3.1-8b-instant"
        : "llama-3.3-70b-versatile"

    const latestUserText = getLatestUserText(contents)
    const baseMessages = await buildBaseMessages(groqApiKey, contents, controller)

    const firstResponse = await callGroqJson(groqApiKey, {
      model,
      messages: baseMessages,
      tools: [fixedSearchTool(), fixedHtmlPreviewTool()],
      tool_choice: "auto",
      stream: false,
      temperature: 0.2,
      max_tokens: 1200,
    })

    const firstMessage = firstResponse.choices?.[0]?.message
    const toolCalls = getToolCalls(firstMessage?.tool_calls)
      .filter((toolCall) =>
        toolCall.function.name === "search_limenote_public_posts" ||
        toolCall.function.name === "create_html_preview"
      )
      .slice(0, 2)

    if (toolCalls.length === 0) {
      const content = firstMessage?.content ?? ""

      enqueueText(controller, limitText(content || "回答を生成できませんでした。", ANSWER_MAX_CHARS))
      enqueueDone(controller)
      return
    }

    const toolResultMessages: GroqMessage[] = []
    let hasSearchTool = false
    let hasCodingTool = false

    for (const toolCall of toolCalls) {
      if (toolCall.function.name === "search_limenote_public_posts") {
        hasSearchTool = true
        const searchArgs = parseSearchArgs(toolCall.function.arguments, latestUserText)

        enqueueEvent(controller, {
          type: "sns_search_start",
        })

        const searchResult = await searchLimeNotePublicPosts(req, searchArgs)

        enqueueEvent(controller, {
          type: "sns_search_end",
          posts: searchResult.references,
        })

        if (searchResult.references.length > 0) {
          enqueueEvent(controller, {
            type: "sns_reference_posts",
            posts: searchResult.references,
          })
        }

        toolResultMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: searchResult.context,
        })
      }

      if (toolCall.function.name === "create_html_preview") {
        hasCodingTool = true
        const htmlArgs = parseHtmlPreviewArgs(toolCall.function.arguments, latestUserText)
        const artifact = toCodingArtifact(htmlArgs)

        enqueueEvent(controller, {
          type: "coding_artifact_start",
        })

        enqueueEvent(controller, {
          type: "coding_artifact",
          artifact,
        })

        toolResultMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: `HTMLプレビューを作成しました。タイトル: ${artifact.title}`,
        })
      }
    }

    const finalInstruction = [
      hasSearchTool ? "公開投稿のツール結果を使う時は、自然に短く要約します。投稿番号・内部ラベル・取得中という表現は使いません。回答下に参照UIが出ます。" : "",
      hasCodingTool ? "HTMLプレビューは画面に表示済みです。回答では『作成しました』と短く伝え、必要なら編集できる点を一言だけ添えます。コード全文は回答本文に貼りません。" : "",
      `回答は${ANSWER_MAX_CHARS}字以内に収めます。`,
    ].filter(Boolean).join("\n")

    const finalMessages: GroqMessage[] = [
      ...baseMessages,
      {
        role: "assistant",
        content: firstMessage?.content ?? null,
        tool_calls: toolCalls,
      },
      ...toolResultMessages,
      {
        role: "system",
        content: finalInstruction || "ツール結果を使って自然に短く答えます。",
      },
    ]

    await streamFinalGroqAnswer(
      groqApiKey,
      model,
      finalMessages,
      controller,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"

    console.error("chat-gemma error:", error)

    enqueueEvent(controller, {
      type: "edge_error",
      error: message,
    })

    enqueueText(controller, `エラーが発生しました。詳細: ${message}`)
    enqueueDone(controller)
  } finally {
    controller.close()
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    })
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void handleChatStream(req, controller)
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
