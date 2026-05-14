import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// 使っていない引数 req を _req に変更して警告を解消
Deno.serve(async (_req) => {
  const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY')
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ""
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ""

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 1. Bot機能が有効で、かつプロンプトが設定されているユーザーを全員取得
  const { data: botUsers, error: userError } = await supabase
    .from('profiles')
    .select('id, bot_prompt')
    .eq('bot_enabled', true)
    .not('bot_prompt', 'is', null)

  if (userError) {
    return new Response(JSON.stringify({ error: "ユーザー取得失敗: " + userError.message }), { status: 500 })
  }

  if (!botUsers || botUsers.length === 0) {
    return new Response(JSON.stringify({ message: "対象となるBotユーザーがいません。" }), { status: 200 })
  }

  const results = []

  // 2. 各ユーザーごとにループして投稿を生成・挿入
  for (const user of botUsers) {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            { 
              role: "system", 
              content: `あなたはSNS(XやMisskey等)を利用している個人ユーザーです。
              以下の【ユーザー設定】を完全に内面化し、そのキャラクターとしてタイムラインに流れる「独り言」や「リアルタイムな呟き」を生成してください。

              【SNS投稿の鉄則】
              1. 読者への挨拶や丁寧な自己紹介（「こんにちは」「〜と申します」）は絶対に禁止。
              2. 状況を客観的に説明するのではなく、その瞬間の感情や思考を短く切り取ってください。
              3. 文末は「〜だ」「〜すぎる」「〜かな」など、キャラクターに合わせた口語体にすること。
              4. 140文字以内（推奨50文字前後）で出力してください。

              【制約】
              一文または二文で出力、改行なし、ハッシュタグなし、絵文字は自由。

              【ユーザー設定】
              ${user.bot_prompt}` 
            },
          ],
        }),
      });

      const data = await response.json();
      const content = data.choices[0].message.content;

      const { error: postError } = await supabase
        .from('posts')
        .insert([{ 
            content: content, 
            user_id: user.id,
            comments_count: 0,
            likes_count: 0,
            reposts_count: 0,
            visibility: 'public',
            is_bot: true // 管理用のBotラベル（フラグ）を追加
        }])

      if (postError) {
        results.push({ user_id: user.id, status: "error", message: postError.message });
      } else {
        results.push({ user_id: user.id, status: "success", post: content });
      }

    } catch (e) {
      // 型ガード：e が Error オブジェクトかどうかを確認してから message を参照する
      const errorMessage = e instanceof Error ? e.message : String(e);
      results.push({ user_id: user.id, status: "exception", error: errorMessage });
    }
  }

  return new Response(JSON.stringify({ 
    message: "処理完了", 
    processed_count: botUsers.length,
    details: results 
  }), { status: 200 })
})