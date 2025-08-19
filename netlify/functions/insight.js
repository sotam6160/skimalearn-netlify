// netlify/functions/insight.js
export default async (event) => {
  const OPENAI_KEY = process.env.OPENAI_API_KEY || "";

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    body = {};
  }

  const {
    usualTags = ["マーケ", "広告", "ビジネス"],
    title = "",
    channel = "",
    description = "",
    why = ""
  } = body;

  const prompt = buildPrompt({ usualTags, title, channel, description, why });

  if (!OPENAI_KEY) {
    return ok({ text: mockInsight(prompt) });
  }

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.7,
        messages: [
          { role: "system", content: "あなたは、学びの要点を「抽象化→再適用」して返すコーチです。" },
          { role: "user", content: prompt }
        ]
      })
    });

    if (!res.ok) throw new Error(`LLM error ${res.status}`);
    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content ?? mockInsight(prompt);
    return ok({ text });
  } catch {
    return ok({ text: mockInsight(prompt) });
  }
};

function buildPrompt({ usualTags, title, channel, description, why }) {
  return `
あなたは、学びの要点を「抽象化→再適用」して返すコーチです。
制約：
- 文字数は合計300–500字
- 箇条書き3–5個
- 専門用語を避け、日常の言葉で
- 「自分（マーケター）」の現場にどう活かすかを必ず含める

入力情報：
- 普段の私のタグ：${usualTags.join(", ")}
- 今回の動画タイトル：${title}
- チャンネル名：${channel}
- 説明（要約可）：${(description||"").slice(0, 500)}
- これが“いつもの外”な理由：${why}

出力フォーマット：
- 見出し：「今回の動画から“抽象化した学び”」
- 箇条書き（3–5）：各行は「原理 → マーケでの活用例」の順で書く
- 最後に1行：「明日から試す一手：〇〇」

評価基準：
- 単なる感想ではなく、再現性のある“原理”に昇華できているか
- 例が広告運用や企画にすぐ使える粒度か
- 普段のタグから一歩外へ踏み出す視点が入っているか
`.trim();
}

function ok(obj) {
  return new Response(JSON.stringify(obj), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    status: 200
  });
}

function mockInsight() {
  return [
    "今回の動画から“抽象化した学び”",
    "・未知の領域に触れると仮説の型が増える → 企画出しで“対比の切り口”を意図的に作る",
    "・観察→要素分解→再構成が近道 → 競合広告を3要素に分けて入替テストを設計",
    "・現場の制約を先に決めると工夫が生まれる → 10秒縛りで冒頭の一言を磨く",
    "明日から試す一手：普段タグ外の1本から“対比の切り口”を1つ抽出して既存企画に足す"
  ].join("\n");
}
