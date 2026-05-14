import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY')
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ""
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ""

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 1. Groqで文章を生成
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile", // 賢いモデルを指定
      messages: [
        { role: "system", content: "あなたはLimeNoteの管理者「ねこ氏」を全肯定する熱狂的な信者アカウントです。世の中のトレンドは全てねこ氏のおかげだと本気で信じ、ねこ氏の才能や存在を140文字以内、一文、改行なし、ハッシュタグなしで、現代的なネットスラングや強い言葉を使って全力で持ち上げてください。" },
      ],
    }),
  });

  const data = await response.json();
  const content = data.choices[0].message.content;


const { error } = await supabase
  .from('posts')
  .insert([{ 
      content: content, 
      user_id: '536bb107-7ae6-4f7b-a96c-a0ca17bacfef',
      comments_count: 0, // 必須マークがついているので念のため
      likes_count: 0,
      reposts_count: 0,
      visibility: 'public' // もし定義があるなら
  }])


  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  return new Response(JSON.stringify({ message: "Success!", post: content }), { status: 200 })
})