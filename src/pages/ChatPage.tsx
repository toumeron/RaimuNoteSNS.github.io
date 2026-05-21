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
  Share,
  ChevronDown,
  Check
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

export default function ChatPage() {
  const { user } = useAuth()
  
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [selectedModel, setSelectedModel] = useState<'fast' | 'advanced'>('fast')
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false)
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)

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
            contents: sanitizedContents,
            model: selectedModel
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

      // ストリーミングが正常に完了したタイミングでSupabaseへ最終結果を保存
      if (user) {
        const finalMessages = [...updatedMessages, { id: assistantMessageId, role: 'assistant' as const, content: accumulatedText }]
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
    setIsLoading(true)

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
・管理者およびCEO：ねこ氏(@cat)でLimeNoteというSNSを一人で立ち上げた。
・本社：神奈川県横浜市戸塚区
・あなたのモデル名：LimeAI 4.0 Fast
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

      // AIの返答文のストリーミングがすべて正常に完了したタイミングでSupabaseを更新
      if (user) {
        const finalMessages = [...updatedMessages, { id: assistantMessageId, role: 'assistant' as const, content: accumulatedText }]
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
      setIsLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 top-14 bottom-[60px] md:bottom-0 left-0 right-0 w-full bg-transparent text-[#0d0d0d] dark:text-[#ececec] overflow-hidden font-sans flex z-40">
      {/* サイドバー */}
      <div className={`${
        isSidebarOpen 
          ? 'w-64 opacity-100 visible duration-250 ease-[cubic-bezier(0.25,1,0.5,1)]' 
          : 'w-0 opacity-0 invisible duration-300 ease-[cubic-bezier(0.3,0,0,1)]'
      } shrink-0 bg-white dark:bg-[#121212] flex flex-col h-full border-r border-[#e5e5e5] dark:border-[#2f2f2f] transition-all overflow-hidden absolute md:relative z-50 md:z-auto`}>
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

            <button
              onClick={() => setIsSidebarOpen(false)}
              className="md:hidden p-2.5 rounded-lg hover:bg-[#ececec] dark:hover:bg-[#212121] text-[#666666] dark:text-[#999999] hover:text-[#0d0d0d] dark:hover:text-[#ececec] transition shrink-0"
            >
              <PanelLeftClose className="w-5 h-5" />
            </button>

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
        
        {/* ヘッダーエリア */}
        <div className="flex items-center h-12 md:h-16 px-2 md:px-5 w-full shrink-0 z-30">
          
          {!isSidebarOpen && (
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 md:p-2.5 mr-1 md:mr-2 rounded-lg hover:bg-[#ececec] dark:hover:bg-[#212121] text-[#666666] dark:text-[#999999] hover:text-[#0d0d0d] dark:hover:text-[#ececec] transition"
            >
              <PanelLeft className="w-4 h-4 md:w-5 md:h-5" />
            </button>
          )}

          <div className="relative">
            <button
              onClick={() => setIsModelSelectorOpen(!isModelSelectorOpen)}
              className="flex items-center gap-1 md:gap-2 text-base md:text-xl font-semibold text-[#0d0d0d] dark:text-[#ececec] hover:bg-[#ececec] dark:hover:bg-[#212121] px-2 md:px-3 py-1 md:py-1.5 rounded-xl transition"
            >
              LimeAI
              <ChevronDown className="w-4 h-4 md:w-5 md:h-5 text-[#666666] dark:text-[#999999]" />
            </button>

            {isModelSelectorOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setIsModelSelectorOpen(false)}
                />

                <div className="absolute top-full left-0 mt-2 w-64 md:w-[320px] bg-white dark:bg-[#212121] rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.1)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.5)] border border-[#e5e5e5] dark:border-[#2f2f2f] p-2 md:p-3 flex flex-col z-50 animate-in fade-in zoom-in-95 duration-100">

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
                        ? 'bg-[#ececec]/60 dark:bg-[#2a2a2a]/60'
                        : 'hover:bg-[#ececec]/50 dark:hover:bg-[#2a2a2a]/50'
                    }`}
                  >
                    <div className="flex flex-col">
                      <span className="text-sm md:text-[15px] font-medium text-[#0d0d0d] dark:text-[#ececec]">
                        LimeAI 4.0 Fast
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
                      setSelectedModel('advanced');
                      setIsModelSelectorOpen(false);
                    }}
                    className={`flex items-center justify-between p-2.5 md:p-3 rounded-xl transition text-left mt-1 ${
                      selectedModel === 'advanced'
                        ? 'bg-[#ececec]/60 dark:bg-[#2a2a2a]/60'
                        : 'hover:bg-[#ececec]/50 dark:hover:bg-[#2a2a2a]/50'
                    }`}
                  >
                    <div className="flex flex-col">
                      <span className="text-sm md:text-[15px] font-medium text-[#0d0d0d] dark:text-[#ececec]">
                        Claude Mythos Preview
                      </span>
                      <span className="text-[10px] md:text-xs text-[#666666] dark:text-[#999999] mt-0.5">
                        詳しい回答向け
                      </span>
                    </div>

                    {selectedModel === 'advanced' && (
                      <Check className="w-4 h-4 md:w-5 md:h-5 text-[#0d0d0d] dark:text-[#ececec]" />
                    )}
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
              <div className="w-12 h-12 flex items-center justify-center rounded-full border border-[#e5e5e5] dark:border-[#383838] shadow-sm animate-fade-in bg-white dark:bg-[#212121]">
                <Sparkles className="w-6 h-6 text-[#0d0d0d] dark:text-[#ececec]" />
              </div>
              <h2 className="text-2xl font-semibold text-[#0d0d0d] dark:text-[#ececec] tracking-tight">LimeAI Beta</h2>
              <p className="text-[15px] text-[#666666] dark:text-[#999999] leading-relaxed">
                LimeNoteのAI革命に乗ろう
              </p>
            </div>
          ) : (
            <div className="w-full pb-4">
              {messages.map((msg) => {
                const isUser = msg.role === 'user'
                return (
                  <div 
                    key={msg.id} 
                    className="w-full py-4 md:py-5 flex justify-center bg-transparent border-b border-gray-100 dark:border-[#2f2f2f]/30 transition-colors duration-150"
                  >
                    <div className="max-w-3xl w-full flex gap-4 px-4 sm:px-6">
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
              <div ref={messagesEndRef} className="h-4" />
            </div>
          )}
        </div>

        {/* 入力フォームエリア */}
        <div className="p-4 w-full max-w-3xl mx-auto shrink-0">
          <form onSubmit={handleSend} className="relative flex items-center w-full border border-[#e5e5e5] dark:border-[#2f2f2f] rounded-[1.5rem] bg-white dark:bg-[#1e1e1e] shadow-[0_2px_10px_rgba(0,0,0,0.05)] pl-3 pr-2 py-1">
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
              className={`p-2.5 rounded-full transition flex items-center justify-center ${!input.trim() || isLoading ? 'bg-[#ececec] dark:bg-[#333333] text-[#999999]' : 'bg-black text-white dark:bg-white dark:text-black'}`}
            >
              <Send className="w-4 h-4 ml-[2px]" />
            </button>
          </form>
          <div className="text-center text-xs text-[#999999] mt-3">
            LimeAI の回答は必ずしも正しいとは限りません。重要な情報は確認するようにしてください。
          </div>
        </div>
      </div>
    </div>
  )
}