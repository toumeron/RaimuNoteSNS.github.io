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
  Menu
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
  
  // スマホ表示の初期状態では画面を圧迫しないようサイドバーを閉じ、デスクトップ（md以上）では開くように画面幅を検知
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

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

  return (
    <div className="fixed inset-0 top-14 bottom-20 md:bottom-0 left-0 right-0 w-full bg-white text-gray-900 dark:bg-[#212121] dark:text-[#ececec] overflow-hidden font-sans selection:bg-gray-200 dark:selection:bg-[#3d3d3d] flex z-40">
      
      {/* サイドバー: スマホ時は最前面にオーバーレイ展開（fixed/absolute制御）させてタイムラインを潰さないように最適化 */}
      <div className={`${
        isSidebarOpen ? 'w-64 opacity-100 visible' : 'w-0 opacity-0 invisible md:visible'
      } shrink-0 bg-gray-50 dark:bg-[#171717] flex flex-col h-full border-r border-gray-200 dark:border-[#2f2f2f] transition-all duration-300 overflow-hidden absolute md:relative z-50 md:z-auto`}>
        <div className="p-3.5">
          <button
            onClick={createNewSession}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-gray-200 dark:border-[#3c3c3c] bg-white dark:bg-[#212121] hover:bg-gray-100 dark:hover:bg-[#2a2a2a] transition duration-200 text-sm font-medium text-gray-900 dark:text-[#f9f9f9]"
          >
            <span className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-gray-400" /> 新しいチャット
            </span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 space-y-0.5 custom-scrollbar">
          <div className="px-3 py-2 text-xs font-semibold text-gray-400 sticky top-0 bg-gray-50 dark:bg-[#171717] z-10">
            チャット履歴
          </div>
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => {
                setCurrentSessionId(s.id)
                // スマホ環境なら選択時に自動でサイドバーを閉じる
                if (window.innerWidth < 768) {
                  setIsSidebarOpen(false)
                }
              }}
              className={`group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-sm transition duration-150 ${
                s.id === currentSessionId 
                  ? 'bg-white shadow-sm border border-gray-200 dark:border-transparent dark:bg-[#212121] text-gray-900 dark:text-white font-medium' 
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100/50 dark:hover:bg-[#212121]/50 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <MessageSquare className="w-4 h-4 shrink-0 opacity-60" />
                <span className="truncate">{s.title}</span>
              </div>
              <button
                onClick={(e) => deleteSession(s.id, e)}
                className="opacity-100 md:opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 dark:hover:bg-[#2a2a2a] rounded text-gray-400 hover:text-red-400 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        {user && (
          <div className="p-3 border-t border-gray-200 dark:border-[#2f2f2f] bg-gray-50 dark:bg-[#171717] flex items-center gap-3">
            <Avatar className="h-8 w-8 border border-gray-200 dark:border-[#2f2f2f]">
              <AvatarImage src={user.avatarUrl} />
              <AvatarFallback>{user.displayName?.slice(0, 1)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-gray-900 dark:text-[#f9f9f9] truncate leading-tight">{user.displayName}</div>
              <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate leading-none">@{user.username}</div>
            </div>
          </div>
        )}
      </div>

      {/* スマホ用サイドバー展開時の暗幕レイヤー（タップで閉じられる仕様を追加） */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 top-14 bottom-20 bg-black/40 z-40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* メインエリア: カード化を完全に排除した一体型構造 */}
      <div className="flex flex-col flex-1 h-full bg-white dark:bg-[#212121] relative min-w-0 w-full">
        
        {/* ヘッダー: 境界線を極限まで薄く */}
        <div className="h-14 border-b border-gray-200 dark:border-[#2f2f2f] flex items-center px-4 bg-white dark:bg-[#212121] justify-between z-10">
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-[#2a2a2a] rounded-lg text-gray-400 hover:text-gray-900 dark:hover:text-white transition"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="text-sm font-semibold text-gray-900 dark:text-[#f9f9f9] flex items-center gap-1.5 tracking-tight">
            LimeAI Chat
          </div>
          <div className="w-9" />
        </div>

        {/* タイムライン: 親のmax-w-2xlを突破し画面横幅いっぱいへ */}
        <div className="flex-1 overflow-y-auto custom-scrollbar bg-white dark:bg-[#212121]">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4 px-4">
              <div className="p-3 bg-gray-50 dark:bg-[#2a2a2a] rounded-full border border-gray-200 dark:border-[#333] shadow-sm animate-fade-in">
                <Sparkles className="w-6 h-6 text-purple-500 dark:text-purple-400" />
              </div>
              <h2 className="text-xl font-medium text-gray-900 dark:text-[#f9f9f9] tracking-tight">LimeAI Beta</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                LimeNoteの革命に乗ろう
              </p>
            </div>
          ) : (
            <div className="w-full">
              {messages.map((msg) => {
                const isUser = msg.role === 'user'
                return (
                  <div 
                    key={msg.id} 
                    className="w-full py-4 md:py-6 flex justify-center border-b border-gray-100 dark:border-[#2f2f2f]/30 transition-colors duration-150 bg-white dark:bg-[#212121]"
                  >
                    <div className="max-w-3xl w-full flex gap-3 md:gap-4 px-4 sm:px-6">
                      {/* アバター配置 */}
                      <div className="shrink-0">
                        {isUser ? (
                          <Avatar className="h-6 w-6 border border-gray-200 dark:border-[#3a3a3a]">
                            <AvatarImage src={user?.avatarUrl} />
                            <AvatarFallback><User className="w-3.5 h-3.5 text-gray-400" /></AvatarFallback>
                          </Avatar>
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-purple-500/10 dark:bg-purple-600/20 border border-purple-500/20 dark:border-purple-500/30 flex items-center justify-center">
                            <Sparkles className="w-3.5 h-3.5 text-purple-500 dark:text-purple-400" />
                          </div>
                        )}
                      </div>

                      {/* テキストエリア: フラット展開 */}
                      <div className="flex-1 space-y-1 md:max-w-2xl lg:max-w-3xl min-w-0">
                        <div className="text-[13px] font-semibold tracking-wide uppercase text-gray-400 dark:text-gray-500 mb-1">
                          {isUser ? 'あなた' : 'LimeAI'}
                        </div>
                        <div className="text-[15px] leading-7 text-gray-800 dark:text-[#ececec] whitespace-pre-wrap break-words tracking-normal">
                          {msg.content === '' && isLoading ? (
                            <span className="flex items-center gap-2 text-gray-400 text-sm animate-pulse">
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-500 dark:text-purple-400" />
                              思考中...
                            </span>
                          ) : (
                            msg.content
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

        {/* フッター/入力欄: モバイル環境での横幅パディング調整とソフトウェアキーボード時の縮小防止 */}
        <div className="p-3 md:p-4 bg-white dark:bg-[#212121] border-t border-gray-100 dark:border-[#2f2f2f]/40 w-full shrink-0">
          <form onSubmit={handleSend} className="max-w-3xl mx-auto relative">
            <div className="relative flex items-center bg-white dark:bg-[#2f2f2f] border border-gray-200 dark:border-[#3e3e3e] rounded-3xl focus-within:border-gray-400 dark:focus-within:border-[#4f4f4f] transition duration-200 px-3.5 md:px-4 py-2.5 md:py-3 shadow-md">
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
                className="w-full bg-transparent resize-none text-[15px] leading-relaxed focus:outline-none text-gray-900 dark:text-[#ececec] pr-10 md:pr-12 max-h-28 md:max-h-36 custom-scrollbar placeholder-gray-400 dark:placeholder-gray-500"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="absolute right-2.5 bottom-2 p-2 rounded-full bg-gray-900 dark:bg-[#ececec] text-white dark:text-black hover:bg-gray-800 dark:hover:bg-[#d9d9d9] disabled:bg-gray-100 dark:disabled:bg-[#212121] disabled:text-gray-300 dark:disabled:text-[#4f4f4f] transition duration-200 shadow-sm"
              >
                {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="text-[11px] text-center text-gray-400 dark:text-gray-500 mt-2 tracking-wide">
              LimeAIは間違いを起こす可能性があるため、重要な情報は確認してください。
            </div>
          </form>
        </div>

      </div>
    </div>
  )
}