import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || "";
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || "";
const SERVICE_KEY = Deno.env.get('PRIVATE_SERVICE_KEY') || "";

interface Post {
  id: string;
  content: string;
}

serve(async (_req: Request): Promise<Response> => {
  try {
    if (!GEMINI_API_KEY || !SUPABASE_URL || !SERVICE_KEY) {
      throw new Error("Missing environment variables (GEMINI_API_KEY, SUPABASE_URL, or PRIVATE_SERVICE_KEY)");
    }

    // ここで正しい変数名（SERVICE_KEY）を使用
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
    
    // 1. 最新の10件を取得
    const { data: posts, error: fetchError } = await supabase
      .from('posts')
      .select('id, content')
      .order('created_at', { ascending: false })
      .limit(5)

    if (fetchError) throw new Error(`Database fetch error: ${fetchError.message}`);

    if (!posts || posts.length === 0) {
      return new Response(JSON.stringify({ message: 'No posts found in database' }), { 
        status: 200, 
        headers: { "Content-Type": "application/json" } 
      })
    }

    const postsText = posts.map((p: Post) => `ID:${p.id} 内容:${p.content}`).join('\n')
    
    // 2. プロンプト
    const prompt = `以下のLimeNoteというSNS投稿データをもとに、ニュース記事を1つ作成してください。
【ルール】
- 投稿が少なくとも、その中から主要なトピックを見つけてまとめてください。
- 必ず以下のJSON形式のみで出力してください。
- 余計な挨拶や解説文、markdownの枠組みも一切不要です。

JSON形式:
{
  "title": "見出し",
  "content": "要約",
  "category": "カテゴリ",
  "related_post_ids": ["ID1", "ID2"]
}

投稿データ:
${postsText}`

    // 3. Gemini API 呼び出し (2026年最新モデル)
    const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    })

    const geminiData = await response.json()

    if (!response.ok) {
      throw new Error(`Gemini API Error: ${geminiData.error?.message || 'Unknown error'}`);
    }

    const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text
    if (!rawText) throw new Error("Gemini response is empty");

    // 4. JSONのクリーニング
    const cleanJson = rawText
      .replace("```json", "")
      .replace("```", "")
      .replace("```", "")
      .trim();
    
    let newsJson;
    try {
      newsJson = JSON.parse(cleanJson);
    } catch (_e) {
      console.error("Parse Error. Raw text:", rawText);
      throw new Error("Failed to parse Gemini response as JSON");
    }

    // 5. DB保存
    const { error: insertError } = await supabase
      .from('news_summaries')
      .insert([
        {
          title: newsJson.title,
          content: newsJson.content,
          category: newsJson.category,
          related_post_ids: newsJson.related_post_ids
        }
      ])

    if (insertError) throw new Error(`Database insert error: ${insertError.message}`);

    return new Response(JSON.stringify({ success: true, data: newsJson }), { 
      status: 200,
      headers: { "Content-Type": "application/json" }
    })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: msg }), { 
      status: 500, 
      headers: { "Content-Type": "application/json" } 
    })
  }
})