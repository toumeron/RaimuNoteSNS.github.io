Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    let genre = "";
    if (req.method === 'POST') {
      try {
        const body = await req.json();
        genre = body.genre || "";
      } catch {
        genre = "";
      }
    }

    const genreKeywords: Record<string, string> = {
      "anime": "アニメ ",
      "game": "ゲーム ",
      "news": "ニュース ",
      "tech": "IT "
    };
    
    const prefix = genreKeywords[genre] || "";
    
    // ジャンルがある場合はそのジャンルで深掘り、ない場合はランダムな8文字を選出
    const chars = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろ";
    const targetChars = prefix 
      ? [prefix.trim()] // ジャンル指定時はその1単語
      : chars.split('').sort(() => 0.5 - Math.random()).slice(0, 8); // ランダムに8文字選出

    // 並列でリクエストを投げる (Promise.all)
    const requests = targetChars.map(async (char) => {
      const query = encodeURIComponent(char);
      const url = `https://www.google.com/complete/search?client=chrome&q=${query}&hl=ja&gl=jp`;
      
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" }
        });
        if (!res.ok) return [];
        const data = await res.json();
        return data[1] || [];
      } catch {
        return [];
      }
    });

    const results = await Promise.all(requests);
    
    // 各文字の検索結果から、1位（または上位）を抽出して統合
    const combinedTrends: { title: string; traffic: string }[] = [];
    const seen = new Set<string>();

    results.forEach((list, index) => {
      // ジャンル指定時はそのリストから多く取り、ランダム時は各文字から1〜2個取る
      const limit = prefix ? 8 : 1; 
      let count = 0;

      for (const item of list) {
        if (count >= limit) break;
        
        let title = String(item);
        if (prefix && title.startsWith(prefix)) {
          title = title.replace(prefix, "").trim();
        }

        // 重複排除とノイズ除去
        if (title.length > 1 && !seen.has(title) && title !== targetChars[index]) {
          combinedTrends.push({ title, traffic: "注目" });
          seen.add(title);
          count++;
        }
      }
    });

    // 最終的に8〜10件に絞る
    const finalTrends = combinedTrends.slice(0, 10);

    return new Response(JSON.stringify(finalTrends), {
      headers: { 
        ...corsHeaders, 
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=600, max-age=300"
      },
    });

  } catch (err) {
    return new Response(JSON.stringify([{ title: "トレンド生成に失敗しました", traffic: "!" }]), {
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
});