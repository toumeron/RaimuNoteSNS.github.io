const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  // CORSプリフライト（OPTIONS）のハンドリング
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders })
  }

  try {
    // リクエストボディからcontentsを取得
    const body = await req.json()
    const contents = body.contents

    if (!contents) {
      throw new Error('The "contents" field is missing in the request body')
    }
    
    // Groq環境変数の取得
    const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY')
    if (!GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY is not set')
    }

    // フロントエンドから届くGoogle形式（contents）をGroq形式（messages）にその場でマッピング
    // 万が一システムプロンプト的な user ターンがあればそれも抽出し、roleの不整合を置換
    const groqMessages = contents.map((item: any) => {
      let role = item.role === 'model' ? 'assistant' : 'user'
      const text = item.parts?.[0]?.text || ''
      
      // フロントエンドがねじ込んだシステム指示の文字列が含まれている場合、システムプロンプトに格上げする
      if (text.includes('【システム命令:')) {
        role = 'system'
      }
      
      return {
        role: role,
        content: text
      }
    }).filter((m: any) => m.content.trim() !== '')

    // Groq のチャット完了（ストリーミング）エンドポイント
    const url = 'https://api.groq.com/openai/v1/chat/completions'

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile", // 高速・高精度な主力モデルを指定
        messages: groqMessages,
        stream: true, // ストリーミングを有効化
        temperature: 0.6,
      }),
    })

    // Groq API側がエラーを返した場合は、生エラーテキストをブラウザに透過して返す
    if (!response.ok) {
      const errorDetail = await response.text()
      return new Response(errorDetail, {
        status: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!response.body) {
      throw new Error('No response body from Groq API')
    }

    // 正常時はフロントエンドにSSEストリームをそのまま中継
    return new Response(response.body, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    return new Response(JSON.stringify({ 
      error: "Edge Function Internal Crash", 
      details: errorMessage 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})