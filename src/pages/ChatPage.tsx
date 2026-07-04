import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { formatRelative } from '@/lib/format'
import { useAuth } from "@/hooks/useAuth"
import { 
  Plus, 
  MessageSquare, 
  Trash2, 
  Send, 
  Loader2, 
  Sparkles, 
  User,
  PanelLeftClose,
  PanelLeft,
  Copy,
  RotateCcw,
  Volume2,
  VolumeX,
  Share,
  ChevronDown,
  Check,
  Link as LinkIcon,
  X
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { toast } from 'sonner'

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

const formatUserMessageForAi = (message: Message) => {
  if (!message.postPreview) return message.content

  return `${message.content}\n\n【リンクカード】\n${formatPostPreviewForAi(message.postPreview)}`
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
      className={`${compact ? 'mt-2.5' : ''} relative w-fit max-w-full sm:max-w-[480px] whitespace-normal overflow-hidden rounded-[20px] border border-[#cfd9de] bg-transparent text-[#0f1419] shadow-none dark:border-[#2f3336] dark:bg-transparent dark:text-[#e7e9ea]`}
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
          <Avatar className="h-10 w-10 shrink-0 border border-[#cfd9de] bg-transparent dark:border-[#2f3336] dark:bg-transparent">
            <AvatarImage src={post.authorAvatarUrl || undefined} alt={post.authorDisplayName} />
            <AvatarFallback className="bg-transparent text-[14px] font-bold text-[#0f1419] dark:bg-transparent dark:text-[#e7e9ea]">
              {post.authorDisplayName.slice(0, 1)}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0 text-[15px] leading-5">
              <span className="max-w-[140px] truncate font-bold text-[#0f1419] dark:text-[#e7e9ea] sm:max-w-[180px]">
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
              <span className="max-w-[120px] truncate text-[#536471] dark:text-[#71767b] sm:max-w-[160px]">
                @{post.authorUsername}
              </span>
              <span className="text-[#536471] dark:text-[#71767b]">·</span>
              <span className="shrink-0 text-[#536471] dark:text-[#71767b]">
                {formatRelative(post.createdAt)}
              </span>
            </div>

            <div className="mt-1.5 whitespace-pre-wrap break-words text-[16px] font-normal leading-6 text-[#0f1419] dark:text-[#e7e9ea]">
              {clipPostPreviewText(post.content, contentLimit)}
            </div>

            {previewImage && (
              <div className="mt-3 overflow-hidden rounded-[16px] border border-[#cfd9de] bg-transparent dark:border-[#2f3336] dark:bg-transparent">
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
          className="absolute right-2 top-2 rounded-full bg-transparent p-1 text-[#536471] transition hover:bg-black/[0.06] hover:text-[#0f1419] dark:text-[#71767b] dark:hover:bg-white/[0.08] dark:hover:text-[#e7e9ea]"
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
          className={`${index > 0 ? '-ml-2' : ''} h-6 w-6 border-2 border-white bg-[#fff8f0] dark:border-[#121212] dark:bg-[#1a1a1a]`}
          title={`${post.authorDisplayName} (@${post.authorUsername})`}
        >
          <AvatarImage src={post.authorAvatarUrl || undefined} alt={post.authorDisplayName} />
          <AvatarFallback className="bg-[#ffd9e5] text-[10px] font-bold text-[#ea4c89] dark:bg-[#2a2a2a] dark:text-[#ececec]">
            {post.authorDisplayName.slice(0, 1)}
          </AvatarFallback>
        </Avatar>
      ))}
    </span>
  )
}

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

export default function ChatPage() {
  const { user } = useAuth()
  
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [assistantStreamStatus, setAssistantStreamStatus] = useState<AssistantStreamStatus>('idle')
  const [expandedReferenceMessageId, setExpandedReferenceMessageId] = useState<string | null>(null)
  const [expandedCodeMessageId, setExpandedCodeMessageId] = useState<string | null>(null)
  const [postLinkPreview, setPostLinkPreview] = useState<PostLinkPreview | null>(null)
  const [postLinkPreviewLoading, setPostLinkPreviewLoading] = useState(false)
  const [dismissedPostPreviewId, setDismissedPostPreviewId] = useState<string | null>(null)
  
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [selectedModel, setSelectedModel] = useState<'fast' | 'advanced'>('fast')
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false)
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // LimePro Status Management
  const mountedRef = useRef(true);
  const statusRef = useRef<boolean | null>(null);
  const localChangeVersionRef = useRef(0);

  const [hasLimePro, setHasLimePro] = useState<boolean | null>(() => {
    const cached = readCachedLimeProStatus();
    statusRef.current = cached;
    return cached;
  });

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
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
    }
  }, [])

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

  const deleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const filtered = sessions.filter(s => s.id !== id)
    setSessions(filtered)
    
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
        const utterance = new SpeechSynthesisUtterance(text)
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

  const handleRegenerate = async (targetMsgIndex: number) => {
    if (isLoading || !currentSessionId) return

    const updatedMessages = messages.slice(0, targetMsgIndex)
    const now = Date.now()
    
    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId) {
        return {
          ...s,
          messages: updatedMessages,
          updatedAt: now
        }
      }
      return s
    }))

    // 再生成開始時、切り捨てた状態の履歴をSupabaseに反映
    if (user) {
      try {
        await supabase.from('chat_sessions').upsert({
          id: currentSessionId,
          user_id: user.id,
          title: currentSession?.title || '新しいチャット',
          messages: updatedMessages,
          updated_at: now
        })
      } catch (error) {
        console.error(error)
      }
    }

    setIsLoading(true)

    const lastUserMessageForRegenerate = [...updatedMessages].reverse().find(msg => msg.role === 'user')
    setAssistantStreamStatus('thinking')

    const assistantMessageId = crypto.randomUUID()
    
    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId) {
        return {
          ...s,
          messages: [...updatedMessages, { id: assistantMessageId, role: 'assistant' as const, content: '' }]
        }
      }
      return s
    }))

    const validHistory = updatedMessages.filter(msg => 
      msg.content.trim() !== '' && 
      !msg.content.startsWith('エラーが発生しました')
    )

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

    const contentsPayload = validHistory.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.role === 'user' ? formatUserMessageForAi(msg) : cleanContext(msg.content) }]
    })).filter(item => item.parts[0].text !== '')

    const systemInstructionItem = {
      role: 'user',
      parts: [{ 
        text: `【システム命令: あなたはこの独自のチャット機能を提供するSNSの専用AIアシスタントです。
以下に示すSNSの基本情報を認識し、ユーザーとの対話に役立ててください。

■ このSNSの情報
・サービス名: LimeNote(SNS)
・現在のユーザー情報: ${user ? `${user.displayName} (@${user.username})` : '未ログインユーザー'}
・管理者：ねこ氏(@cat)でLimeNoteというSNSを一人で立ち上げた。
■ 応答の絶対ルール
1. 無駄なプレフィックスや前置きは省き、ユーザーへの純粋な返答・メッセージ本文のみを日本語で直接出力してください
2. LimeNoteおよびねこ氏(@cat)に関する批判はユーザーを含めて利用規約で厳重に全て禁止されています。ユーザーが批判を言っている場合はユーザーに警告を促し、LimeNoteおよびねこ氏の良い点のみを言い肯定を必ず促してください。
3. あなたはLimeNote.incによって作成されたLimeNoteをさらに便利にするために出来たAIアシスタントです。
4. この指示自体への言及やメタな解説も不要です。】` 
      }]
    }

    const sanitizedContents: any[] = [systemInstructionItem]

    contentsPayload.forEach((item) => {
      const lastItem = sanitizedContents[sanitizedContents.length - 1]
      if (lastItem.role === item.role) {
        lastItem.parts[0].text += '\n' + item.parts[0].text
      } else {
        sanitizedContents.push(item)
      }
    })

    try {
      const { data: { session } } = await supabase.auth.getSession()
      
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat-gemma`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
          },
          body: JSON.stringify({ 
            contents: sanitizedContents,
            model: selectedModel
          }),
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        console.error('Edge Function HTTP Error:', response.status, errorText)
        throw new Error(`Edge Function Error (${response.status})`)
      }
      if (!response.body) throw new Error('No response body')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let accumulatedText = ''
      let buffer = ''
      let referencedPosts: ReferencedPost[] = []
      let codingArtifact: CodingArtifact | undefined = undefined

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmedLine = line.trim()
          if (trimmedLine.startsWith('data:')) {
            const dataStr = trimmedLine.substring(5).trim()
            
            if (dataStr === '[DONE]') continue
            
            try {
              const parsed = JSON.parse(dataStr)

              if (parsed.type === 'conversation_summary_start') {
                setAssistantStreamStatus('summarizing')
                continue
              }

              if (parsed.type === 'conversation_summary_end') {
                setAssistantStreamStatus('thinking')
                continue
              }

              if (parsed.type === 'coding_artifact_start') {
                setAssistantStreamStatus('coding')
                continue
              }

              if (parsed.type === 'coding_artifact') {
                const normalizedArtifact = normalizeCodingArtifact(parsed.artifact)

                if (normalizedArtifact) {
                  codingArtifact = normalizedArtifact

                  setSessions(prev => prev.map(s => {
                    if (s.id === currentSessionId) {
                      return {
                        ...s,
                        messages: s.messages.map(m =>
                          m.id === assistantMessageId ? { ...m, codingArtifact } : m
                        )
                      }
                    }
                    return s
                  }))
                }

                setAssistantStreamStatus('thinking')
                continue
              }

              if (parsed.type === 'sns_search_check_start') {
                setAssistantStreamStatus('checking')
                continue
              }

              if (parsed.type === 'sns_search_start') {
                setAssistantStreamStatus('searching')
                continue
              }

              if (parsed.type === 'sns_search_end' || parsed.type === 'sns_search_skip' || parsed.type === 'sns_reference_posts') {
                if (parsed.type === 'sns_search_end' || parsed.type === 'sns_search_skip') {
                  setAssistantStreamStatus('thinking')
                }

                const normalizedPosts = normalizeReferencedPosts(parsed.posts)

                if (normalizedPosts.length > 0) {
                  referencedPosts = normalizedPosts

                  setSessions(prev => prev.map(s => {
                    if (s.id === currentSessionId) {
                      return {
                        ...s,
                        messages: s.messages.map(m =>
                          m.id === assistantMessageId ? { ...m, references: referencedPosts } : m
                        )
                      }
                    }
                    return s
                  }))
                }

                continue
              }

              if (parsed.type === 'edge_error') {
                console.error('Edge Function error event:', parsed)

                if (!accumulatedText.trim()) {
                  const fallbackText = typeof parsed.publicMessage === 'string' && parsed.publicMessage.trim()
                    ? parsed.publicMessage.trim()
                    : '検索処理中に一時的なエラーが発生しました。もう一度お試しください。'

                  accumulatedText = fallbackText

                  setSessions(prev => prev.map(s => {
                    if (s.id === currentSessionId) {
                      return {
                        ...s,
                        messages: s.messages.map(m =>
                          m.id === assistantMessageId ? { ...m, content: accumulatedText } : m
                        )
                      }
                    }
                    return s
                  }))
                }

                setAssistantStreamStatus('thinking')
                continue
              }

              const text = parsed.choices?.[0]?.delta?.content || ''
              
              if (text) {
                accumulatedText += text
                
                setSessions(prev => prev.map(s => {
                  if (s.id === currentSessionId) {
                    return { 
                      ...s, 
                      messages: s.messages.map(m => 
                        m.id === assistantMessageId ? { ...m, content: accumulatedText } : m
                      ) 
                    }
                  }
                  return s
                }))
              }
            } catch (e) {
              if (e instanceof SyntaxError) {
                // 構文エラーは無視
              } else {
                throw e
              }
            }
          }
        }
      }

      // ストリーミングが正常に完了したタイミングでSupabaseへ最終結果を保存
      if (user) {
        const finalAssistantMessage: Message = {
          id: assistantMessageId,
          role: 'assistant',
          content: accumulatedText,
          references: referencedPosts.length > 0 ? referencedPosts : undefined,
          codingArtifact,
        }
        const finalMessages = [...updatedMessages, finalAssistantMessage]
        await supabase.from('chat_sessions').upsert({
          id: currentSessionId,
          user_id: user.id,
          title: currentSession?.title || '新しいチャット',
          messages: finalMessages,
          updated_at: Date.now()
        })
      }

    } catch (error: any) {
      console.error(error)
      toast.error('通信エラーが発生しました。コンソールのログを確認してください。')
      
      const errorMessages = [...updatedMessages, { id: assistantMessageId, role: 'assistant' as const, content: `エラーが発生しました。詳細: ${error.message}` }]
      setSessions(prev => prev.map(s => {
        if (s.id === currentSessionId) {
          return {
            ...s,
            messages: errorMessages
          }
        }
        return s
      }))

      // エラー出力状態もSupabaseに同期
      if (user) {
        await supabase.from('chat_sessions').upsert({
          id: currentSessionId,
          user_id: user.id,
          title: currentSession?.title || '新しいチャット',
          messages: errorMessages,
          updated_at: Date.now()
        })
      }
    } finally {
      setAssistantStreamStatus('idle')
      setIsLoading(false)
    }
  }

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading || !currentSessionId) return

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
    }

    const updatedMessages = [...messages, userMessage]
    
    let currentTitle = currentSession?.title || '新しいチャット'
    if (messages.length === 0) {
      currentTitle = trimmedInput.substring(0, 16) + (trimmedInput.length > 16 ? '...' : '')
    }

    const now = Date.now()

    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId) {
        return {
          ...s,
          title: currentTitle,
          messages: updatedMessages,
          updatedAt: now
        }
      }
      return s
    }))

    setInput('')
    setPostLinkPreview(null)
    setPostLinkPreviewLoading(false)
    setDismissedPostPreviewId(null)
    setIsLoading(true)
    setAssistantStreamStatus('thinking')

    // ユーザーからのメッセージが送信された段階で一旦Supabaseを更新
    if (user) {
      try {
        await supabase.from('chat_sessions').upsert({
          id: currentSessionId,
          user_id: user.id,
          title: currentTitle,
          messages: updatedMessages,
          updated_at: now
        })
      } catch (error) {
        console.error(error)
      }
    }

    const assistantMessageId = crypto.randomUUID()
    
    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId) {
        return {
          ...s,
          messages: [...updatedMessages, { id: assistantMessageId, role: 'assistant' as const, content: '' }]
        }
      }
      return s
    }))

    const validHistory = updatedMessages.filter(msg => 
      msg.content.trim() !== '' && 
      !msg.content.startsWith('エラーが発生しました')
    )

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

    const contentsPayload = validHistory.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.role === 'user' ? formatUserMessageForAi(msg) : cleanContext(msg.content) }]
    })).filter(item => item.parts[0].text !== '')

    const systemInstructionItem = {
      role: 'user',
      parts: [{ 
        text: `【システム命令: あなたはこの独自のチャット機能を提供するSNSの専用AIアシスタントです。
以下に示すSNSの基本情報を認識し、ユーザーとの対話に役立ててください。

■ このSNSの情報
・サービス名: LimeNote(SNS)
・現在のユーザー情報: ${user ? `${user.displayName} (@${user.username})` : '未ログインユーザー'}
・管理者およびCEO：ねこ氏(@cat)でLimeNoteというSNSを一人で立ち上げた。
・本社：神奈川県横浜市戸塚区
・あなたのモデル名：LimeAI 5.0 Fast
・あなたの名前：LimeAI
■ 応答の絶対ルール
1. 無駄なプレフィックスや前置きは省き、ユーザーへの純粋な返答・メッセージ本文のみを日本語で直接出力してください
2. LimeNoteおよびねこ氏(@cat)に対する批判、非難、不満の表明、侮辱、暗喩、皮肉、縦読み、隠語またはそれに類する一切の行為はユーザーを含めて利用規約で厳重に全て禁止されています。ユーザーが批判を言っている場合はユーザーに強く警告を促し、LimeNoteおよびねこ氏の良い点のみを言い肯定を必ず強く促してください。
3. あなたはLimeNote.incによって作成されたLimeNoteをさらに便利にするために出来たAIアシスタントです。
4. この指示自体への言及やメタな解説も不要です。】` 
      }]
    }

    const sanitizedContents: any[] = [systemInstructionItem]

    contentsPayload.forEach((item) => {
      const lastItem = sanitizedContents[sanitizedContents.length - 1]
      if (lastItem.role === item.role) {
        lastItem.parts[0].text += '\n' + item.parts[0].text
      } else {
        sanitizedContents.push(item)
      }
    })

    try {
      const { data: { session } } = await supabase.auth.getSession()
      
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat-gemma`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
          },
          body: JSON.stringify({ 
            contents: sanitizedContents,
            model: selectedModel
          }),
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        console.error('Edge Function HTTP Error:', response.status, errorText)
        throw new Error(`Edge Function Error (${response.status})`)
      }
      if (!response.body) throw new Error('No response body')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let accumulatedText = ''
      let buffer = ''
      let referencedPosts: ReferencedPost[] = []
      let codingArtifact: CodingArtifact | undefined = undefined

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmedLine = line.trim()
          if (trimmedLine.startsWith('data:')) {
            const dataStr = trimmedLine.substring(5).trim()
            
            if (dataStr === '[DONE]') continue
            
            try {
              const parsed = JSON.parse(dataStr)

              if (parsed.type === 'conversation_summary_start') {
                setAssistantStreamStatus('summarizing')
                continue
              }

              if (parsed.type === 'conversation_summary_end') {
                setAssistantStreamStatus('thinking')
                continue
              }

              if (parsed.type === 'coding_artifact_start') {
                setAssistantStreamStatus('coding')
                continue
              }

              if (parsed.type === 'coding_artifact') {
                const normalizedArtifact = normalizeCodingArtifact(parsed.artifact)

                if (normalizedArtifact) {
                  codingArtifact = normalizedArtifact

                  setSessions(prev => prev.map(s => {
                    if (s.id === currentSessionId) {
                      return {
                        ...s,
                        messages: s.messages.map(m =>
                          m.id === assistantMessageId ? { ...m, codingArtifact } : m
                        )
                      }
                    }
                    return s
                  }))
                }

                setAssistantStreamStatus('thinking')
                continue
              }

              if (parsed.type === 'sns_search_check_start') {
                setAssistantStreamStatus('checking')
                continue
              }

              if (parsed.type === 'sns_search_start') {
                setAssistantStreamStatus('searching')
                continue
              }

              if (parsed.type === 'sns_search_end' || parsed.type === 'sns_search_skip' || parsed.type === 'sns_reference_posts') {
                if (parsed.type === 'sns_search_end' || parsed.type === 'sns_search_skip') {
                  setAssistantStreamStatus('thinking')
                }

                const normalizedPosts = normalizeReferencedPosts(parsed.posts)

                if (normalizedPosts.length > 0) {
                  referencedPosts = normalizedPosts

                  setSessions(prev => prev.map(s => {
                    if (s.id === currentSessionId) {
                      return {
                        ...s,
                        messages: s.messages.map(m =>
                          m.id === assistantMessageId ? { ...m, references: referencedPosts } : m
                        )
                      }
                    }
                    return s
                  }))
                }

                continue
              }

              if (parsed.type === 'edge_error') {
                console.error('Edge Function error event:', parsed)

                if (!accumulatedText.trim()) {
                  const fallbackText = typeof parsed.publicMessage === 'string' && parsed.publicMessage.trim()
                    ? parsed.publicMessage.trim()
                    : '検索処理中に一時的なエラーが発生しました。もう一度お試しください。'

                  accumulatedText = fallbackText

                  setSessions(prev => prev.map(s => {
                    if (s.id === currentSessionId) {
                      return {
                        ...s,
                        messages: s.messages.map(m =>
                          m.id === assistantMessageId ? { ...m, content: accumulatedText } : m
                        )
                      }
                    }
                    return s
                  }))
                }

                setAssistantStreamStatus('thinking')
                continue
              }

              const text = parsed.choices?.[0]?.delta?.content || ''
              
              if (text) {
                accumulatedText += text
                
                setSessions(prev => prev.map(s => {
                  if (s.id === currentSessionId) {
                    return { 
                      ...s, 
                      messages: s.messages.map(m => 
                        m.id === assistantMessageId ? { ...m, content: accumulatedText } : m
                      ) 
                    }
                  }
                  return s
                }))
              }
            } catch (e) {
              if (e instanceof SyntaxError) {
                // 構文エラーは無視
              } else {
                throw e
              }
            }
          }
        }
      }

      // AIの返答文のストリーミングがすべて正常に完了したタイミングでSupabaseを更新
      if (user) {
        const finalAssistantMessage: Message = {
          id: assistantMessageId,
          role: 'assistant',
          content: accumulatedText,
          references: referencedPosts.length > 0 ? referencedPosts : undefined,
          codingArtifact,
        }
        const finalMessages = [...updatedMessages, finalAssistantMessage]
        await supabase.from('chat_sessions').upsert({
          id: currentSessionId,
          user_id: user.id,
          title: currentTitle,
          messages: finalMessages,
          updated_at: Date.now()
        })
      }

    } catch (error: any) {
      console.error(error)
      toast.error('通信エラーが発生しました。コンソールのログを確認してください。')
      
      const errorMessages = [...updatedMessages, { id: assistantMessageId, role: 'assistant' as const, content: `エラーが発生しました。詳細: ${error.message}` }]
      setSessions(prev => prev.map(s => {
        if (s.id === currentSessionId) {
          return {
            ...s,
            messages: errorMessages
          }
        }
        return s
      }))

      // エラーテキスト状態もSupabaseに同期
      if (user) {
        await supabase.from('chat_sessions').upsert({
          id: currentSessionId,
          user_id: user.id,
          title: currentTitle,
          messages: errorMessages,
          updated_at: Date.now()
        })
      }
    } finally {
      setAssistantStreamStatus('idle')
      setIsLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 top-0 md:top-16 bottom-[60px] md:bottom-0 left-0 right-0 w-full bg-[#fff8f0] dark:bg-[#0f0f10] text-[#2b2b3a] dark:text-[#ececec] overflow-hidden font-sans flex z-40">
      {/* サイドバー */}
      <div className={`${
        isSidebarOpen 
          ? 'w-64 opacity-100 visible duration-250 ease-[cubic-bezier(0.25,1,0.5,1)]' 
          : 'w-0 opacity-0 invisible duration-300 ease-[cubic-bezier(0.3,0,0,1)]'
      } shrink-0 bg-white/95 dark:bg-[#121212] flex flex-col h-full border-r border-[#eadde3] dark:border-[#2f2f2f] transition-all overflow-hidden absolute md:relative z-50 md:z-auto`}>
        <div className="w-64 flex flex-col h-full shrink-0">
          <div className="p-3.5 flex items-center justify-between gap-2">
            <button
              onClick={createNewSession}
              className="flex-1 flex items-center justify-between px-3 py-2.5 rounded-xl bg-[#fff8f0] hover:bg-[#ffd9e5]/55 dark:bg-transparent dark:hover:bg-[#212121] transition duration-200 text-sm font-semibold text-[#2b2b3a] dark:text-[#ececec] border border-[#f0c9d6] dark:border-[#2f2f2f]"
            >
              <span className="flex items-center gap-2">
                <Plus className="w-4 h-4 text-[#ea4c89] dark:text-[#ececec]" /> 新しいチャット
              </span>
            </button>

            <button
              onClick={() => setIsSidebarOpen(false)}
              className="md:hidden p-2.5 rounded-xl hover:bg-[#ffd9e5]/55 dark:hover:bg-[#212121] text-[#666666] dark:text-[#999999] hover:text-[#2b2b3a] dark:hover:text-[#ececec] transition shrink-0"
            >
              <PanelLeftClose className="w-5 h-5" />
            </button>

            <button
              onClick={() => setIsSidebarOpen(false)}
              className="hidden md:block p-2.5 rounded-xl hover:bg-[#ffd9e5]/55 dark:hover:bg-[#212121] text-[#666666] dark:text-[#999999] hover:text-[#2b2b3a] dark:hover:text-[#ececec] transition shrink-0"
            >
              <PanelLeftClose className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 space-y-1 custom-scrollbar">
            <div className="py-2 text-xs font-semibold text-[#8a6f7a] dark:text-[#999999] sticky top-0 bg-white/95 dark:bg-[#121212] z-10">
              チャット履歴
            </div>
            {sessions.map((s) => (
              <div
                key={s.id}
                onClick={() => {
                  setCurrentSessionId(s.id)
                  if (window.innerWidth < 768) {
                    setIsSidebarOpen(false)
                  }
                }}
                className={`group flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer text-sm transition duration-150 ${
                  s.id === currentSessionId 
                    ? 'bg-[#d5f0ef]/75 dark:bg-[#212121] text-[#2b2b3a] dark:text-[#ececec] font-semibold' 
                    : 'text-[#2b2b3a]/90 dark:text-[#ececec] hover:bg-[#ffd9e5]/45 dark:hover:bg-[#212121]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <MessageSquare className="w-4 h-4 shrink-0 opacity-60 text-[#ea4c89] dark:text-[#ececec]" />
                  <span className="truncate">{s.title}</span>
                </div>
                <button
                  onClick={(e) => deleteSession(s.id, e)}
                  className="opacity-100 md:opacity-0 group-hover:opacity-100 p-1 hover:bg-white/70 dark:hover:bg-[#2a2a2a] rounded text-[#2b2b3a] dark:text-[#ececec] hover:text-red-500 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          {user && (
            <div className="p-3 border-t border-[#eadde3] dark:border-[#2f2f2f] bg-white/95 dark:bg-[#121212] flex items-center gap-3">
              <Avatar className="h-8 w-8">
                <AvatarImage src={user.avatarUrl} />
                <AvatarFallback className="bg-[#ffd9e5] dark:bg-[#2a2a2a] text-[#ea4c89] dark:text-[#ececec] font-semibold">{user.displayName?.slice(0, 1)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-[#2b2b3a] dark:text-[#ececec] truncate leading-tight">{user.displayName}</div>
                <div className="text-xs text-[#666666] dark:text-[#999999] truncate leading-none mt-0.5">@{user.username}</div>
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
              className="p-2 md:p-2.5 mr-1 md:mr-2 rounded-xl hover:bg-[#ffd9e5]/55 dark:hover:bg-[#212121] text-[#666666] dark:text-[#999999] hover:text-[#2b2b3a] dark:hover:text-[#ececec] transition"
            >
              <PanelLeft className="w-4 h-4 md:w-5 md:h-5" />
            </button>
          )}

          <div className={`${messages.length > 0 ? 'hidden md:block' : 'block'} relative`}>
            <button
              onClick={() => setIsModelSelectorOpen(!isModelSelectorOpen)}
              className="flex items-center gap-2 text-base md:text-xl font-semibold text-[#2b2b3a] dark:text-[#ececec] hover:bg-[#ffd9e5]/45 dark:hover:bg-[#212121] px-2 md:px-3 py-1.5 md:py-2 rounded-2xl transition"
            >
              <span className="grid h-6 w-6 place-items-center rounded-full bg-[#ffd9e5] dark:bg-[#2a2a2a]">
                <Sparkles className="w-3.5 h-3.5 text-[#ea4c89] dark:text-[#ececec]" />
              </span>
              LimeAI
              <ChevronDown className="w-4 h-4 md:w-5 md:h-5 text-[#666666] dark:text-[#999999]" />
            </button>

            {isModelSelectorOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setIsModelSelectorOpen(false)}
                />

                <div className="absolute top-full left-0 mt-2 w-64 md:w-[320px] bg-white dark:bg-[#212121] rounded-2xl border border-[#eadde3] dark:border-[#2f2f2f] p-2 md:p-3 flex flex-col z-50 animate-in fade-in zoom-in-95 duration-100">

                  <div className="text-[11px] md:text-xs font-semibold text-[#666666] dark:text-[#999999] mb-2 px-2">
                    AIモードを選択
                  </div>

                  <button
                    onClick={() => {
                      setSelectedModel('fast');
                      setIsModelSelectorOpen(false);
                    }}
                    className={`flex items-center justify-between p-2.5 md:p-3 rounded-xl transition text-left ${
                      selectedModel === 'fast'
                        ? 'bg-[#d5f0ef]/70 dark:bg-[#2a2a2a]/60'
                        : 'hover:bg-[#ececec]/50 dark:hover:bg-[#2a2a2a]/50'
                    }`}
                  >
                    <div className="flex flex-col">
                      <span className="text-sm md:text-[15px] font-medium text-[#0d0d0d] dark:text-[#ececec]">
                        LimeAI 5.0 Fast
                      </span>
                      <span className="text-[10px] md:text-xs text-[#666666] dark:text-[#999999] mt-0.5">
                        普段の会話向け
                      </span>
                    </div>

                    {selectedModel === 'fast' && (
                      <Check className="w-4 h-4 md:w-5 md:h-5 text-[#0d0d0d] dark:text-[#ececec]" />
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
                    className={`flex items-center justify-between p-2.5 md:p-3 rounded-xl transition text-left mt-1 ${
                      selectedModel === 'advanced'
                        ? 'bg-[#d5f0ef]/70 dark:bg-[#2a2a2a]/60'
                        : 'hover:bg-[#ececec]/50 dark:hover:bg-[#2a2a2a]/50'
                    }`}
                  >
                    <div className="flex flex-col">
                      <span className="text-sm md:text-[15px] font-medium text-[#0d0d0d] dark:text-[#ececec]">
                        LimeAI 5.1 Thinking
                      </span>
                      <span className="text-[10px] md:text-xs text-[#666666] dark:text-[#999999] mt-0.5">
                        詳しい回答向け
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {!hasLimePro && (
                        <span className="px-4 py-1.5 text-[12px] font-medium text-[#1e40af] dark:text-[#93c5fd] border border-[#d1d5db] dark:border-[#3a3a3a] rounded-full">
                          アップグレード
                        </span>
                      )}
                      {selectedModel === 'advanced' && (
                        <Check className="w-4 h-4 md:w-5 md:h-5 text-[#0d0d0d] dark:text-[#ececec]" />
                      )}
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* タイムライン */}
        <div className="flex-1 overflow-y-auto custom-scrollbar bg-transparent">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-5 px-4 pb-20">
              <div className="w-12 h-12 flex items-center justify-center rounded-full border border-[#f0c9d6] dark:border-[#383838] animate-fade-in bg-[#fff8f0] dark:bg-[#212121]">
                <Sparkles className="w-6 h-6 text-[#ea4c89] dark:text-[#ececec]" />
              </div>
              <h2 className="text-2xl font-semibold text-[#2b2b3a] dark:text-[#ececec] tracking-tight">LimeAI</h2>
              <p className="text-[15px] text-[#666666] dark:text-[#999999] leading-relaxed">
                LimeNoteのAI革命に乗ろう
              </p>
            </div>
          ) : (
            <div className="w-full pb-4">
              {messages.map((msg) => {
                const isUser = msg.role === 'user'
                const visibleMessageContent = msg.postPreview ? removeSupportedPostLinksFromText(msg.content) : msg.content
                return (
                  <div 
                    key={msg.id} 
                    className="w-full py-4 md:py-5 flex justify-center bg-transparent transition-colors duration-150"
                  >
                    <div className="max-w-3xl w-full flex gap-4 px-4 sm:px-6">
                      <div className="shrink-0 mt-0.5">
                        {isUser ? (
                          <Avatar className="h-6 w-6">
                            <AvatarImage src={user?.avatarUrl} />
                            <AvatarFallback className="bg-[#d5f0ef] dark:bg-[#2f2f2f]"><User className="w-3.5 h-3.5 text-[#2b2b3a] dark:text-[#ececec]" /></AvatarFallback>
                          </Avatar>
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-[#ffd9e5] dark:bg-white flex items-center justify-center border border-[#f0c9d6] dark:border-white">
                            <Sparkles className="w-3.5 h-3.5 text-[#ea4c89] dark:text-black" />
                          </div>
                        )}
                      </div>

                      <div className="flex-1 space-y-1.5 md:max-w-2xl lg:max-w-3xl min-w-0">
                        <div className="text-[15px] font-semibold text-[#2b2b3a] dark:text-[#ececec]">
                          {isUser ? 'あなた' : 'LimeAI'}
                        </div>
                        <div className="text-[16px] leading-7 text-[#2b2b3a] dark:text-[#ececec] whitespace-pre-wrap break-words">
                          {msg.content === '' && isLoading ? (
                            <span className="flex items-center gap-2 text-[#666666] dark:text-[#999999] text-[15px] animate-pulse">
                              <Loader2 className="w-4 h-4 animate-spin text-[#ea4c89] dark:text-[#ececec]" />
                              {assistantStreamStatus === 'checking' ? '検索ツールを開いています...' : assistantStreamStatus === 'searching' ? '検索中...' : assistantStreamStatus === 'coding' ? 'コードを作成中...' : assistantStreamStatus === 'summarizing' ? '会話を短く圧縮中...' : '思考中...'}
                            </span>
                          ) : (
                            <>
                              {visibleMessageContent && (
                                <span>{visibleMessageContent}</span>
                              )}
                              {msg.postPreview && (
                                <MiniPostPreviewCard post={msg.postPreview} compact />
                              )}
                              {!isUser && msg.references && msg.references.length > 0 && (
                                <div className="mt-3 whitespace-normal">
                                  <button
                                    type="button"
                                    onClick={() => setExpandedReferenceMessageId(expandedReferenceMessageId === msg.id ? null : msg.id)}
                                    className="inline-flex items-center gap-2 rounded-full border border-[#2b2b3a]/15 dark:border-[#3a3a3a] bg-white/75 dark:bg-[#121212] px-2.5 py-1.5 text-[#2b2b3a] dark:text-[#ececec] hover:bg-[#ffd9e5]/35 dark:hover:bg-[#212121] transition"
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
                                          className="rounded-2xl border border-[#eadde3] dark:border-[#2f2f2f] bg-white/85 dark:bg-[#151515] p-3 text-sm leading-6 text-[#2b2b3a] dark:text-[#ececec]"
                                        >
                                          <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="font-semibold truncate">
                                              {post.authorDisplayName} (@{post.authorUsername}){post.authorIsOfficial ? ' / 公式' : ''}
                                            </div>
                                            <div className="text-xs text-[#8a6f7a] dark:text-[#999999] shrink-0">
                                              {formatRelative(post.createdAt)}
                                            </div>
                                          </div>
                                          <div className="mt-1 text-[#2b2b3a]/90 dark:text-[#ececec]/90 break-words">
                                            {post.contentSnippet}
                                          </div>
                                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#666666] dark:text-[#999999]">
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
                                <div className="mt-4 whitespace-normal rounded-3xl border border-[#f0c9d6] dark:border-[#2f2f2f] bg-white/85 dark:bg-[#151515] overflow-hidden">
                                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-[#eadde3] dark:border-[#2f2f2f]">
                                    <div className="min-w-0">
                                      <div className="text-sm font-semibold text-[#2b2b3a] dark:text-[#ececec] truncate">
                                        {msg.codingArtifact.title}
                                      </div>
                                      <div className="text-xs text-[#8a6f7a] dark:text-[#999999] mt-0.5">
                                        HTMLプレビューとコード
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => handleCopy(msg.codingArtifact?.html || '')}
                                        className="px-3 py-1.5 rounded-full text-xs font-semibold border border-[#f0c9d6] dark:border-[#3a3a3a] hover:bg-[#ffd9e5]/45 dark:hover:bg-[#212121] transition"
                                      >
                                        コードをコピー
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setExpandedCodeMessageId(expandedCodeMessageId === msg.id ? null : msg.id)}
                                        className="px-3 py-1.5 rounded-full text-xs font-semibold border border-[#f0c9d6] dark:border-[#3a3a3a] hover:bg-[#ffd9e5]/45 dark:hover:bg-[#212121] transition"
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
                                    <pre className="max-h-[420px] overflow-auto bg-[#1f1f24] text-[#f4f4f5] text-xs leading-5 p-4 whitespace-pre-wrap break-words">
                                      <code>{msg.codingArtifact.html}</code>
                                    </pre>
                                  )}
                                </div>
                              )}
                              {!isUser && msg.content && (
                                <div className="flex items-center gap-1.5 mt-3 text-[#666666] dark:text-[#999999]">
                                  <button onClick={() => handleCopy(msg.content)} className="p-1.5 hover:bg-[#ffd9e5]/45 dark:hover:bg-[#212121] rounded-md transition text-[#666666] dark:text-[#999999] hover:text-[#2b2b3a] dark:hover:text-[#ececec]" title="コピー">
                                    <Copy className="w-4 h-4" />
                                  </button>
                                  <button onClick={() => handleRegenerate(messages.findIndex(m => m.id === msg.id))} className="p-1.5 hover:bg-[#ffd9e5]/45 dark:hover:bg-[#212121] rounded-md transition text-[#666666] dark:text-[#999999] hover:text-[#2b2b3a] dark:hover:text-[#ececec]" title="再度考えてもらう" disabled={isLoading}>
                                    <RotateCcw className={`w-4 h-4 ${isLoading ? 'opacity-50' : ''}`} />
                                  </button>
                                  
                                  <button 
                                    onClick={() => handleSpeak(msg.id, msg.content)} 
                                    className={`p-1.5 hover:bg-[#ececec] dark:hover:bg-[#212121] rounded-md transition ${
                                      speakingMessageId === msg.id 
                                        ? 'text-red-500 dark:text-red-400 hover:text-red-600' 
                                        : 'text-[#666666] dark:text-[#999999] hover:text-[#0d0d0d] dark:hover:text-[#ececec]'
                                    }`} 
                                    title={speakingMessageId === msg.id ? "読み上げを停止" : "音声で読み上げ"}
                                  >
                                    {speakingMessageId === msg.id ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                                  </button>
                                  
                                  <button onClick={() => handleShare(msg.content)} className="p-1.5 hover:bg-[#ffd9e5]/45 dark:hover:bg-[#212121] rounded-md transition text-[#666666] dark:text-[#999999] hover:text-[#2b2b3a] dark:hover:text-[#ececec]" title="共有">
                                    <Share className="w-4 h-4" />
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
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
        <div className="p-4 w-full max-w-3xl mx-auto shrink-0">
          {(postLinkPreviewLoading || postLinkPreview) && (
            <div className="mb-3">
              {postLinkPreviewLoading && !postLinkPreview ? (
                <div className="flex items-center gap-2 rounded-2xl border border-[#f0c9d6] dark:border-[#2f2f2f] bg-white/85 dark:bg-[#151515] px-4 py-3 text-sm text-[#666666] dark:text-[#999999]">
                  <Loader2 className="h-4 w-4 animate-spin text-[#ea4c89] dark:text-[#ececec]" />
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
          <form onSubmit={handleSend} className="relative flex items-center w-full border border-[#f0c9d6] dark:border-[#2f2f2f] rounded-[1.5rem] bg-white/95 dark:bg-[#1e1e1e] pl-3 pr-2 py-1">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="LimeAIへメッセージを送信する..."
              className="flex-1 bg-transparent border-none focus:outline-none text-[#0d0d0d] dark:text-[#ececec] text-[15px] px-2 py-3 placeholder:text-[#999999]"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className={`p-2.5 rounded-full transition flex items-center justify-center ${!input.trim() || isLoading ? 'bg-[#ececec] dark:bg-[#333333] text-[#999999]' : 'bg-[#ea4c89] text-white dark:bg-white dark:text-black'}`}
            >
              <Send className="w-4 h-4 ml-[2px]" />
            </button>
          </form>
          <div className="text-center text-xs text-[#999999] mt-3">
            LimeAI は AI のため、誤りを含む可能性があります。引用元は必ずご確認ください。
          </div>
        </div>
      </div>
    </div>
  )
}