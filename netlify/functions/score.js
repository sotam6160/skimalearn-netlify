// netlify/functions/score.js
// 入力: { usualTags: string[], videos: [...], policy?: {allowGambling, allowClickbait, minSec, maxSec} }
// 出力: { results: [{id, ring, quality, topics, reason}] }
export async function handler(event) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY || "";

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch {}
  const usualTags = Array.isArray(body.usualTags) ? body.usualTags : [];
  const videos = Array.isArray(body.videos) ? body.videos.slice(0, 50) : [];
  const policy = body.policy || {};
  const prefs = {
    allowGambling: !!policy.allowGambling,
    allowClickbait: !!policy.allowClickbait,
    minSec: Number(policy.minSec || 0),
    maxSec: Number(policy.maxSec || 0) // 0なら無制限
  };

  if (!OPENAI_KEY || videos.length === 0) {
    return json({ results: fallbackScore(usualTags, videos, prefs) });
  }

  try {
    const prompt = buildPrompt(usualTags, videos, prefs);
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are a precise video content classifier for a marketer. Output strictly JSON." },
          { role: "user", content: prompt }
        ]
      })
    });
    if (!res.ok) throw new Error("LLM error");
    const data = await res.json();
    const parsed = JSON.parse(data?.choices?.[0]?.message?.content || "{}");
    const results = Array.isArray(parsed?.results) ? parsed.results : [];
    if (results.length === 0) throw new Error("empty");
    return json({ results: clampResults(results, videos) });
  } catch {
    return json({ results: fallbackScore(usualTags, videos, prefs) });
  }
}

function buildPrompt(usualTags, videos, prefs) {
  const compact = videos.map(v => ({
    id: v.id,
    title: v.title,
    description: (v.description || "").slice(0, 200),
    channel: v.channel,
    durationSec: Number(v.durationSec || 0),
    viewCount: Number(v.viewCount || 0)
  }));

  return `
あなたは「マーケター向けに役立つか」を基準に動画を分類し、JSONで返すアシスタントです。
ユーザーの方針:
- ギャンブル系OK: ${prefs.allowGambling ? "yes" : "no"}
- 釣りタイトルOK: ${prefs.allowClickbait ? "yes" : "no"}
- 短すぎ下限(秒): ${prefs.minSec || 0}
- 長すぎ上限(秒。0は無制限): ${prefs.maxSec || 0}

やること：
1) 各動画を、ユーザーの普段のタグ: [${usualTags.join(", ")}] と比較し、距離を判定：
   - inside: タグにど真ん中（2語以上ヒット/非常に近い）
   - ring1: 一回り外側（1語だけ近い/関連が薄い）
   - ring2: ふた回り外側（0語ヒット/でも学びに転用可）
2) "skip" は以下のみ（ユーザー方針を尊重）:
   - 長さが最小閾値未満（durationSec < ${prefs.minSec || 0}）
   - 長さが最大閾値超（${prefs.maxSec || 0} が0でない場合のみ適用）
   - 明らかなノイズ（情報ゼロのスパム/違法/危険）。※ギャンブル/釣りは、${prefs.allowGambling ? "理由にしない" : "避ける"} / ${prefs.allowClickbait ? "理由にしない" : "避ける"}
3) "quality" は 1〜5（教育性・再現性・具体性の総合点）。釣りでも内容があれば低くはしない。
4) "topics" は内容を表す3〜5語。
5) "reason" は20〜40字で、そのリング判定の一言理由（ユーザー方針に合う説明）。

形式（厳守）:
{
  "results":[
    {"id":"...", "ring":"ring1|ring2|inside|skip", "quality":1|2|3|4|5, "topics":["..",".."], "reason":"..."},
    ...
  ]
}

対象動画一覧（id, title, description, channel, durationSec, viewCount）:
${JSON.stringify(compact)}
`.trim();
}

function fallbackScore(usualTags, videos, prefs) {
  const lc = (usualTags || []).map(t => (t || "").toLowerCase());
  return videos.map(v => {
    const hay = `${v.title || ""} ${v.description || ""} ${v.channel || ""}`.toLowerCase();
    let hits = 0; lc.forEach(t => { if (t && hay.includes(t)) hits += 1; });
    const dur = Number(v.durationSec || 0);
    let ring = (hits >= 2) ? "inside" : (hits === 1 ? "ring1" : "ring2");
    if (prefs.minSec && dur < prefs.minSec) ring = "skip";
    if (prefs.maxSec && prefs.maxSec > 0 && dur > prefs.maxSec) ring = "skip";
    const view = Number(v.viewCount || 0);
    const quality = Math.max(1, Math.min(5, Math.floor(Math.log10(view + 10))));
    return { id: v.id, ring, quality, topics: [], reason: hits >= 2 ? "普段ど真ん中" : (hits === 1 ? "一回り外側" : "ふた回り外側") };
  });
}

function clampResults(results, videos) {
  const ids = new Set(videos.map(v => v.id));
  return results
    .filter(r => ids.has(String(r.id)))
    .map(r => ({
      id: String(r.id),
      ring: ["inside","ring1","ring2","skip"].includes(r.ring) ? r.ring : "ring2",
      quality: Math.max(1, Math.min(5, Number(r.quality || 3))),
      topics: Array.isArray(r.topics) ? r.topics.slice(0,5).map(x=>String(x)) : [],
      reason: String(r.reason || "")
    }));
}

function json(obj) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(obj)
  };
}
