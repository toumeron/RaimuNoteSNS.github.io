import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
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
  Share
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { toast } from 'sonner'

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

type ChatSession = {
  id: string
  title: string
  messages: Message[]
  updatedAt: number
}

const LOCAL_STORAGE_KEY = 'raimu_sns_chat_sessions_v1'

export default function ChatPage() {
  const { user } = useAuth()
  
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  
  // スマホ表示 of 初期状態では画面を圧迫しないようサイドバーを閉じ、デスクトップ（md以上）では開くように画面幅を検知
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  // 音声再生中のメッセージIDを管理するステート
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 768) {
      setIsSidebarOpen(true)
    }
  }, [])
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as ChatSession[]
        setSessions(parsed)
        if (parsed.length > 0) {
          setCurrentSessionId(parsed[0].id)
        } else {
          createNewSession()
        }
      } catch (e) {
        createNewSession()
      }
    } else {
      createNewSession()
    }
  }, [])

  useEffect(() => {
    if (sessions.length > 0) {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(sessions))
    }
  }, [sessions])

  const currentSession = sessions.find(s => s.id === currentSessionId)
  const messages = currentSession ? currentSession.messages : []

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  // チャットセッション切り替え時、またはアンマウント時に音声を停止させるクリーンアップ
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

  const createNewSession = () => {
    const newId = crypto.randomUUID()
    const newSession: ChatSession = {
      id: newId,
      title: '新しいチャット',
      messages: [],
      updatedAt: Date.now()
    }
    setSessions(prev => [newSession, ...prev])
    setCurrentSessionId(newId)
    setInput('')
    // スマホ環境で新規チャットを作ったら自動でサイドバーを閉じてタイムラインを見せる
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false)
    }
  }

  const deleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const filtered = sessions.filter(s => s.id !== id)
    setSessions(filtered)
    
    if (currentSessionId === id) {
      if (filtered.length > 0) {
        setCurrentSessionId(filtered[0].id)
      } else {
        const newId = crypto.randomUUID()
        setSessions([{
          id: newId,
          title: '新しいチャット',
          messages: [],
          updatedAt: Date.now()
        }])
        setCurrentSessionId(newId)
      }
    }
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('コピーしました')
  }

  const handleSpeak = (messageId: string, text: string) => {
    if ('speechSynthesis' in window) {
      // 既に同じメッセージを再生中なら停止する
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
    
    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId) {
        return {
          ...s,
          messages: updatedMessages,
          updatedAt: Date.now()
        }
      }
      return s
    }))

    setIsLoading(true)

    const assistantMessageId = crypto.randomUUID()
    
    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId) {
        return {
          ...s,
          messages: [...updatedMessages, { id: assistantMessageId, role: 'assistant', content: '' }]
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
      parts: [{ text: msg.role === 'user' ? msg.content : cleanContext(msg.content) }]
    })).filter(item => item.parts[0].text !== '')

    const systemInstructionItem = {
      role: 'user',
      parts: [{ 
        text: `【システム命令: あなたはこの独自のチャット機能を提供するSNSの専用AIアシスタントです。
以下に示すSNSの基本情報を前提条件として認識し、ユーザーとの対話に役立ててください。

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
            contents: sanitizedContents
          }),
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Edge Function Error (${response.status}): ${errorText}`)
      }
      if (!response.body) throw new Error('No response body')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let accumulatedText = ''
      let buffer = ''

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
              // 構文エラーは無視
            }
          }
        }
      }

    } catch (error: any) {
      console.error(error)
      toast.error('通信エラーが発生しました。コンソールのログを確認してください。')
      
      setSessions(prev => prev.map(s => {
        if (s.id === currentSessionId) {
          return {
            ...s,
            messages: s.messages.map(m => 
              m.id === assistantMessageId ? { ...m, content: `エラーが発生しました。詳細: ${error.message}` } : m
            )
          }
        }
        return s
      }))
    } finally {
      setIsLoading(false)
    }
  }

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading || !currentSessionId) return

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
    }

    const updatedMessages = [...messages, userMessage]
    
    let currentTitle = currentSession?.title || '新しいチャット'
    if (messages.length === 0) {
      currentTitle = input.trim().substring(0, 16) + (input.trim().length > 16 ? '...' : '')
    }

    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId) {
        return {
          ...s,
          title: currentTitle,
          messages: updatedMessages,
          updatedAt: Date.now()
        }
      }
      return s
    }))

    setInput('')
    setIsLoading(true)

    const assistantMessageId = crypto.randomUUID()
    
    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId) {
        return {
          ...s,
          messages: [...updatedMessages, { id: assistantMessageId, role: 'assistant', content: '' }]
        }
      }
      return s
    }))

    // 1. 空白メッセージやエラー表示ログを徹底排除
    const validHistory = updatedMessages.filter(msg => 
      msg.content.trim() !== '' && 
      !msg.content.startsWith('エラーが発生しました')
    )

    // 2. AIのメタ暴走テキストを物理的に削る
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

    // 3. Edge Function側がGoogle形式を受信前提で作られているため、フロントはそのまま送る
    const contentsPayload = validHistory.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.role === 'user' ? msg.content : cleanContext(msg.content) }]
    })).filter(item => item.parts[0].text !== '')

    // 【SNS情報・コンテキストの注入】
    const systemInstructionItem = {
      role: 'user',
      parts: [{ 
        text: `【システム命令: あなたはこの独自のチャット機能を提供するSNSの専用AIアシスタントです。
以下に示すSNSの基本情報を前提条件として認識し、ユーザーとの対話に役立ててください。

■ このSNSの情報
・サービス名: LimeNote(SNS)
・現在のユーザー情報: ${user ? `${user.displayName} (@${user.username})` : '未ログインユーザー'}
・管理者およびCEO：ねこ氏(@cat)でLimeNoteというSNSを一人で立ち上げた。
・本社：福岡県福岡市中央区天神
・設立：2017年9月28日
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
            contents: sanitizedContents
          }),
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Edge Function Error (${response.status}): ${errorText}`)
      }
      if (!response.body) throw new Error('No response body')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let accumulatedText = ''
      let buffer = ''

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
              // 構文エラーは無視
            }
          }
        }
      }

    } catch (error: any) {
      console.error(error)
      toast.error('通信エラーが発生しました。コンソールのログを確認してください。')
      
      setSessions(prev => prev.map(s => {
        if (s.id === currentSessionId) {
          return {
            ...s,
            messages: s.messages.map(m => 
              m.id === assistantMessageId ? { ...m, content: `エラーが発生しました。詳細: ${error.message}` } : m
            )
          }
        }
        return s
      }))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 top-14 bottom-[60px] md:bottom-0 left-0 right-0 w-full bg-transparent text-[#0d0d0d] dark:text-[#ececec] overflow-hidden font-sans flex z-40">
      
{/* サイドバー：開閉状態に応じてアニメーション速度（duration）を動的に切り替え */}
      <div className={`${
        isSidebarOpen 
          ? 'w-64 opacity-100 visible duration-250 ease-[cubic-bezier(0.25,1,0.5,1)]' 
          : 'w-0 opacity-0 invisible duration-300 ease-[cubic-bezier(0.3,0,0,1)]' // 閉じる時だけ遅く（500ms）
      } shrink-0 bg-white dark:bg-[#121212] flex flex-col h-full border-r border-[#e5e5e5] dark:border-[#2f2f2f] transition-all overflow-hidden absolute md:relative z-50 md:z-auto`}>

        {/* 固定幅のインナーラッパーを配置することで閉じる際テキストが圧縮（折り返し）される突っかかりを完全防止 */}
        <div className="w-64 flex flex-col h-full shrink-0">
          <div className="p-3.5 flex items-center justify-between gap-2">
            <button
              onClick={createNewSession}
              className="flex-1 flex items-center justify-between px-3 py-2.5 rounded-lg bg-transparent hover:bg-[#ececec] dark:hover:bg-[#212121] transition duration-200 text-sm font-medium text-[#0d0d0d] dark:text-[#ececec] border border-[#e5e5e5] dark:border-[#2f2f2f]"
            >
              <span className="flex items-center gap-2">
                <Plus className="w-4 h-4 text-[#0d0d0d] dark:text-[#ececec]" /> 新しいチャット
              </span>
            </button>

            {/* スマホ用閉じるボタン（枠線を排除しアセットを最適化） */}
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="md:hidden p-2.5 rounded-lg hover:bg-[#ececec] dark:hover:bg-[#212121] text-[#666666] dark:text-[#999999] hover:text-[#0d0d0d] dark:hover:text-[#ececec] transition shrink-0"
            >
              <PanelLeftClose className="w-5 h-5" />
            </button>

            {/* PC用閉じるボタン（枠線を排除しアセットを最適化） */}
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="hidden md:block p-2.5 rounded-lg hover:bg-[#ececec] dark:hover:bg-[#212121] text-[#666666] dark:text-[#999999] hover:text-[#0d0d0d] dark:hover:text-[#ececec] transition shrink-0"
            >
              <PanelLeftClose className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 space-y-0.5 custom-scrollbar">
            <div className="py-2 text-xs font-semibold text-[#666666] dark:text-[#999999] sticky top-0 bg-white dark:bg-[#121212] z-10">
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
                className={`group flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer text-sm transition duration-150 ${
                  s.id === currentSessionId 
                    ? 'bg-[#ececec] dark:bg-[#212121] text-[#0d0d0d] dark:text-[#ececec] font-medium' 
                    : 'text-[#0d0d0d] dark:text-[#ececec] hover:bg-[#ececec]/80 dark:hover:bg-[#212121]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <MessageSquare className="w-4 h-4 shrink-0 opacity-60" />
                  <span className="truncate">{s.title}</span>
                </div>
                <button
                  onClick={(e) => deleteSession(s.id, e)}
                  className="opacity-100 md:opacity-0 group-hover:opacity-100 p-1 hover:bg-[#d9d9d9] dark:hover:bg-[#2a2a2a] rounded text-[#0d0d0d] dark:text-[#ececec] hover:text-red-350 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          {user && (
            <div className="p-3 border-t border-[#e5e5e5] dark:border-[#2f2f2f] bg-white dark:bg-[#121212] flex items-center gap-3">
              <Avatar className="h-8 w-8">
                <AvatarImage src={user.avatarUrl} />
                <AvatarFallback className="bg-[#ececec] dark:bg-[#2a2a2a] text-[#0d0d0d] dark:text-[#ececec]">{user.displayName?.slice(0, 1)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-[#0d0d0d] dark:text-[#ececec] truncate leading-tight">{user.displayName}</div>
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
        
        {/* メニューが閉じている時のアクセス用ボタンの最適化 */}
        {!isSidebarOpen && (
          <>
            {/* スマホ用開くボタン */}
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="md:hidden absolute top-3 left-3 z-30 p-2.5 rounded-full bg-white dark:bg-[#212121] shadow-sm border border-[#e5e5e5] dark:border-[#2f2f2f] text-[#666666] dark:text-[#999999] hover:text-[#0d0d0d] dark:hover:text-[#ececec] transition"
            >
              <PanelLeft className="w-5 h-5" />
            </button>

            {/* PC用開くボタン */}
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="hidden md:flex absolute top-4 left-4 z-30 p-2 px-3 rounded-lg bg-transparent hover:bg-[#ececec] dark:hover:bg-[#212121] text-[#666666] dark:text-[#999999] hover:text-[#0d0d0d] dark:hover:text-[#ececec] transition items-center gap-2 text-sm font-medium"
            >
              <PanelLeft className="w-5 h-5" />
            </button>
          </>
        )}

        {/* タイムライン：bg-transparentを維持し、スマホ用の余白を最適化 */}
        <div className={`flex-1 overflow-y-auto custom-scrollbar bg-transparent ${!isSidebarOpen ? 'pt-16 md:pt-4 md:pl-44' : 'pt-4'}`}>
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-5 px-4">
              <div className="w-12 h-12 flex items-center justify-center rounded-full border border-[#e5e5e5] dark:border-[#383838] shadow-sm animate-fade-in bg-white dark:bg-[#212121]">
                <Sparkles className="w-6 h-6 text-[#0d0d0d] dark:text-[#ececec]" />
              </div>
              <h2 className="text-2xl font-semibold text-[#0d0d0d] dark:text-[#ececec] tracking-tight">LimeAI Beta</h2>
              <p className="text-[15px] text-[#666666] dark:text-[#999999] leading-relaxed">
                LimeNoteのAI革命に乗ろう
              </p>
            </div>
          ) : (
            <div className="w-full">
              {messages.map((msg) => {
                const isUser = msg.role === 'user'
                return (
                  <div 
                    key={msg.id} 
                    className="w-full py-4 md:py-5 flex justify-center bg-transparent border-b border-gray-100 dark:border-[#2f2f2f]/30 transition-colors duration-150"
                  >
                    <div className="max-w-3xl w-full flex gap-4 px-4 sm:px-6">
                      {/* アバター配置 */}
                      <div className="shrink-0 mt-0.5">
                        {isUser ? (
                          <Avatar className="h-6 w-6">
                            <AvatarImage src={user?.avatarUrl} />
                            <AvatarFallback className="bg-[#ececec] dark:bg-[#2f2f2f]"><User className="w-3.5 h-3.5 text-[#0d0d0d] dark:text-[#ececec]" /></AvatarFallback>
                          </Avatar>
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-black dark:bg-white flex items-center justify-center">
                            <Sparkles className="w-3.5 h-3.5 text-white dark:text-black" />
                          </div>
                        )}
                      </div>

                      {/* テキストエリア */}
                      <div className="flex-1 space-y-1.5 md:max-w-2xl lg:max-w-3xl min-w-0">
                        <div className="text-[15px] font-semibold text-[#0d0d0d] dark:text-[#ececec]">
                          {isUser ? 'あなた' : 'LimeAI'}
                        </div>
                        <div className="text-[16px] leading-7 text-[#0d0d0d] dark:text-[#ececec] whitespace-pre-wrap break-words">
                          {msg.content === '' && isLoading ? (
                            <span className="flex items-center gap-2 text-[#666666] dark:text-[#999999] text-[15px] animate-pulse">
                              <Loader2 className="w-4 h-4 animate-spin text-[#0d0d0d] dark:text-[#ececec]" />
                              思考中...
                            </span>
                          ) : (
                            <>
                              {msg.content}
                              {!isUser && msg.content && (
                                <div className="flex items-center gap-1.5 mt-3 text-[#666666] dark:text-[#999999]">
                                  <button onClick={() => handleCopy(msg.content)} className="p-1.5 hover:bg-[#ececec] dark:hover:bg-[#212121] rounded-md transition text-[#666666] dark:text-[#999999] hover:text-[#0d0d0d] dark:hover:text-[#ececec]" title="コピー">
                                    <Copy className="w-4 h-4" />
                                  </button>
                                  <button onClick={() => handleRegenerate(messages.findIndex(m => m.id === msg.id))} className="p-1.5 hover:bg-[#ececec] dark:hover:bg-[#212121] rounded-md transition text-[#666666] dark:text-[#999999] hover:text-[#0d0d0d] dark:hover:text-[#ececec]" title="再度考えてもらう" disabled={isLoading}>
                                    <RotateCcw className={`w-4 h-4 ${isLoading ? 'opacity-50' : ''}`} />
                                  </button>
                                  
                                  {/* 音声読み上げ・停止トグルボタン */}
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
                                  
                                  <button onClick={() => handleShare(msg.content)} className="p-1.5 hover:bg-[#ececec] dark:hover:bg-[#212121] rounded-md transition text-[#666666] dark:text-[#999999] hover:text-[#0d0d0d] dark:hover:text-[#ececec]" title="共有">
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
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* フッター/入力欄：背景色を透明化、境界線(border-t)のみ保持して外部背景に依存しつつスマホのパディングを最適化 */}
        <div className="p-2.5 md:p-4 bg-transparent border-t border-[#e5e5e5] dark:border-[#2f2f2f] w-full shrink-0">
          <form onSubmit={handleSend} className="max-w-3xl mx-auto relative">
            <div className="relative flex items-center bg-transparent rounded-3xl transition duration-200 px-3.5 md:px-4 py-2.5 md:py-3 shadow-md border border-[#e5e5e5] dark:border-[#2f2f2f] focus-within:border-gray-300 dark:focus-within:border-[#383838]">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (e.nativeEvent.isComposing) {
                      return
                    }
                    if (!e.shiftKey) {
                      e.preventDefault()
                      handleSend(e)
                    }
                  }
                }}
                placeholder="LimeAIへメッセージを送信する..."
                rows={1}
                className="w-full bg-transparent resize-none text-[16px] leading-relaxed focus:outline-none text-[#0d0d0d] dark:text-[#ececec] pr-10 md:pr-12 max-h-28 md:max-h-36 custom-scrollbar placeholder-[#8e8ea0] dark:placeholder-[#9b9b9b]"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="absolute right-2.5 bottom-2 p-2 rounded-full bg-black text-white dark:bg-white dark:text-black hover:opacity-80 disabled:bg-[#e5e5e5] disabled:text-[#9b9b9b] dark:disabled:bg-[#383838] dark:disabled:text-[#676767] transition duration-200"
              >
                {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="text-xs text-center text-[#666666] dark:text-[#999999] mt-2 md:mt-3 tracking-wide">
              LimeAIは間違いを起こす可能性があるため、重要な情報は確認してください。
            </div>
          </form>
        </div>

      </div>
    </div>
  )
}