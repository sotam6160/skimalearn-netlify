// public/app.js（期間フィルタ＋方針をLLMへ連携）
// クリック再生・興味なし機能は維持

const view = document.getElementById("view");
const T = (id) => document.getElementById(id).content.cloneNode(true);

document.getElementById("nav-preferences").onclick = renderPreferences;
document.getElementById("nav-feed").onclick = renderFeed;
document.getElementById("nav-history").onclick = renderHistory;

// 初期表示
renderFeed();

// ========== Prefs ==========
function getPrefs() {
  const country = localStorage.getItem("country") || "JP";
  const tags = (localStorage.getItem("usualTags") || "マーケ, 広告, ビジネス")
    .split(",").map(s => s.trim()).filter(Boolean);
  const filter = JSON.parse(localStorage.getItem("filterPrefs") || "{}");
  const defaults = { windowDays: 7, allowGambling: true, allowClickbait: true, minSec: 0, maxMin: 0 };
  return { country, usualTags: tags, filter: { ...defaults, ...filter } };
}

function setPrefs({ country, usualTags }) {
  localStorage.setItem("country", country || "JP");
  localStorage.setItem("usualTags", (usualTags && usualTags.length ? usualTags : ["マーケ","広告","ビジネス"]).join(", "));
}

function setFilterPrefs(fp) {
  localStorage.setItem("filterPrefs", JSON.stringify(fp || {}));
}

function renderPreferences() {
  view.innerHTML = "";
  view.appendChild(T("tpl-preferences"));

  const elCountry = document.getElementById("country");
  const elTags = document.getElementById("tags");

  const elWindow = document.getElementById("windowDays");
  const elAllowG = document.getElementById("allowGambling");
  const elAllowC = document.getElementById("allowClickbait");
  const elMinSec = document.getElementById("minSec");
  const elMaxMin = document.getElementById("maxMin");

  const { country, usualTags, filter } = getPrefs();
  elCountry.value = country;
  elTags.value = usualTags.join(", ");

  elWindow.value = String(filter.windowDays ?? 7);
  elAllowG.checked = !!filter.allowGambling;
  elAllowC.checked = !!filter.allowClickbait;
  elMinSec.value = String(filter.minSec ?? 0);
  elMaxMin.value = String(filter.maxMin ?? 0);

  document.getElementById("save-prefs").onclick = () => {
    const newCountry = (elCountry.value || "JP").toUpperCase();
    const newTags = (elTags.value || "マーケ, 広告, ビジネス").split(",").map(s => s.trim()).filter(Boolean);
    setPrefs({ country: newCountry, usualTags: newTags });

    const fp = {
      windowDays: Number(elWindow.value || 0),
      allowGambling: !!elAllowG.checked,
      allowClickbait: !!elAllowC.checked,
      minSec: Number(elMinSec.value || 0),
      maxMin: Number(elMaxMin.value || 0),
    };
    setFilterPrefs(fp);
    alert("保存しました");
  };
}

// ========== Fetch ==========
async function fetchTrending() {
  const { country } = getPrefs();
  const res = await fetch(`/.netlify/functions/trending?country=${encodeURIComponent(country)}`);
  if (!res.ok) throw new Error("trending failed");
  const json = await res.json();
  return json.items || [];
}

function parseISODuration(iso) {
  if (!iso) return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  const h = Number(m?.[1] || 0), mi = Number(m?.[2] || 0), s = Number(m?.[3] || 0);
  return h*3600 + mi*60 + s;
}

function filterByWindow(items, windowDays) {
  if (!windowDays || windowDays <= 0) return items;
  const now = Date.now();
  const ms = windowDays * 24 * 3600 * 1000;
  const filtered = items.filter(it => {
    const p = it?.snippet?.publishedAt;
    const t = p ? new Date(p).getTime() : 0;
    return t && (now - t) <= ms;
  });
  // 10本未満なら緩和（何も出ないのを防ぐ）
  return filtered.length >= 10 ? filtered : items;
}

async function scoreByLLM(items, usualTags, policy) {
  const payload = items.map(it => ({
    id: it.id,
    title: it?.snippet?.title || "",
    description: it?.snippet?.description || "",
    channel: it?.snippet?.channelTitle || "",
    durationSec: parseISODuration(it?.contentDetails?.duration),
    viewCount: Number(it?.statistics?.viewCount || 0),
  }));

  try {
    const res = await fetch("/.netlify/functions/score", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ usualTags, videos: payload, policy })
    });
    if (!res.ok) throw new Error("score failed");
    const data = await res.json();
    return Array.isArray(data?.results) ? data.results : [];
  } catch {
    return [];
  }
}

function pick5(items, scores) {
  const byId = new Map(scores.map(s => [s.id, s]));
  const blockedChannels = JSON.parse(localStorage.getItem("blockedChannels") || "[]");

  const enriched = items.map(it => {
    const s = byId.get(it.id) || {};
    return {
      id: it.id,
      title: it?.snippet?.title || "",
      description: it?.snippet?.description || "",
      channel: it?.snippet?.channelTitle || "",
      thumb: it?.snippet?.thumbnails?.high?.url || "",
      viewCount: Number(it?.statistics?.viewCount || 0),
      url: `https://www.youtube.com/watch?v=${it.id}`,
      ring: s.ring || "ring2",
      quality: Number(s.quality || 3),
      topics: Array.isArray(s.topics) ? s.topics : [],
      reason: s.reason || "",
    };
  })
  .filter(v => !blockedChannels.includes(v.channel))
  .filter(v => v.ring !== "skip");

  const uniqByChannel = (arr) => {
    const seen = new Set(); const out = [];
    for (const v of arr) { if (seen.has(v.channel)) continue; seen.add(v.channel); out.push(v); }
    return out;
  };

  const cmp = (a,b) => (b.quality - a.quality) || (b.viewCount - a.viewCount);
  let ring1 = uniqByChannel(enriched.filter(v => v.ring === "ring1").sort(cmp));
  let ring2 = uniqByChannel(enriched.filter(v => v.ring === "ring2").sort(cmp));
  let inside = uniqByChannel(enriched.filter(v => v.ring === "inside").sort(cmp));

  const picked = [];
  const pushSome = (list, n) => { for (const v of list) { if (picked.length>=n) break; if (!picked.find(x=>x.channel===v.channel)) picked.push(v); } };
  pushSome(ring1, 3); // 一回り外側
  pushSome(ring2, 5); // ふた回り外側
  if (picked.length<5) pushSome(ring1, 5);
  if (picked.length<5) pushSome(ring2, 5);
  if (picked.length<5) pushSome(inside, 5);

  return picked.slice(0,5).map(v => ({
    ...v,
    displayReason: `一言: ${v.reason || (v.ring==="ring1"?"一回り外側":"ふた回り外側")} / トピック: ${v.topics.slice(0,3).join("・") || "推定中"}`
  }));
}

// ========== Views ==========
async function renderFeed() {
  view.innerHTML = "";
  view.appendChild(T("tpl-feed"));

  const { usualTags, filter } = getPrefs();
  const cards = document.getElementById("cards");

  async function load() {
    cards.innerHTML = "<p>読み込み中...</p>";
    try {
      const raw = await fetchTrending();                 // 50本
      const items = filterByWindow(raw, filter.windowDays); // 期間フィルタ
      const policy = {
        allowGambling: !!filter.allowGambling,
        allowClickbait: !!filter.allowClickbait,
        minSec: Number(filter.minSec || 0),
        maxSec: Number(filter.maxMin || 0) * 60
      };
      const scores = await scoreByLLM(items, usualTags, policy); // LLM分類（方針付き）
      const top5 = pick5(items, scores);

      try { console.table(top5.map(v => ({ title: v.title, ring: v.ring, quality: v.quality }))); } catch {}

      cards.innerHTML = "";
      top5.forEach((v) => cards.appendChild(videoCard(v, usualTags)));
    } catch (e) {
      cards.innerHTML = `<p>失敗しました。<button id="use-mock">擬似データで表示</button></p>`;
      document.getElementById("use-mock").onclick = async () => {
        const raw = await fetchTrending();
        const items = filterByWindow(raw, filter.windowDays);
        const policy = {
          allowGambling: !!filter.allowGambling,
          allowClickbait: !!filter.allowClickbait,
          minSec: Number(filter.minSec || 0),
          maxSec: Number(filter.maxMin || 0) * 60
        };
        const scores = await scoreByLLM(items, usualTags, policy);
        const top5 = pick5(items, scores);
        cards.innerHTML = "";
        top5.forEach((v) => cards.appendChild(videoCard(v, usualTags)));
      };
    }
  }

  document.getElementById("refresh").onclick = load;
  load();
}

function videoCard(v, usualTags) {
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML = `
    <a href="${v.url}" target="_blank" rel="noopener">
      <img src="${v.thumb}" alt="">
    </a>
    <div class="body">
      <div class="title">
        <a href="${v.url}" target="_blank" rel="noopener">${escapeHtml(v.title)}</a>
      </div>
      <div class="desc">${escapeHtml(v.description)}</div>
      <div class="meta">${escapeHtml(v.channel)}　${
        v.viewCount ? `・${Number(v.viewCount).toLocaleString()}回視聴` : ""
      }　/　${escapeHtml(v.ring === "ring1" ? "一回り外側" : v.ring === "ring2" ? "ふた回り外側" : "普段ど真ん中")}</div>
      <div class="badge">${escapeHtml(v.displayReason)}</div>
      <div style="margin-top:8px;">
        <a class="play" href="${v.url}" target="_blank" rel="noopener" style="margin-right:6px;">▶︎ 再生</a>
        <button class="skip" style="margin-right:6px;">興味なし</button>
        <button class="gen">学び生成</button>
      </div>
      <div class="insight" hidden></div>
    </div>
  `;

  const skip = el.querySelector(".skip");
  skip.onclick = () => {
    const arr = JSON.parse(localStorage.getItem("blockedChannels") || "[]");
    if (!arr.includes(v.channel)) {
      arr.push(v.channel);
      localStorage.setItem("blockedChannels", JSON.stringify(arr));
    }
    el.remove();
  };

  const btn = el.querySelector(".gen");
  const out = el.querySelector(".insight");
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = "生成中...";
    try {
      const res = await fetch("/.netlify/functions/insight", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          usualTags,
          title: v.title,
          channel: v.channel,
          description: v.description,
          why: v.displayReason
        })
      });
      const json = await res.json();
      out.textContent = json.text || "（結果なし）";
      out.hidden = false;
      saveHistory({ video: v, text: json.text });
    } catch {
      out.textContent = "エラー。もう一度お試しください。";
      out.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = "学び生成";
    }
  };
  return el;
}

function escapeHtml(s){ return (s||"").replace(/[&<>"']/g,m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m])); }

function saveHistory({ video, text }) {
  const rec = { id: video.id, title: video.title, channel: video.channel, thumb: video.thumb, reason: video.displayReason, text, at: Date.now() };
  const arr = JSON.parse(localStorage.getItem("history") || "[]");
  arr.unshift(rec);
  localStorage.setItem("history", JSON.stringify(arr.slice(0, 50)));
}

function renderHistory() {
  view.innerHTML = "";
  view.appendChild(T("tpl-history"));
  const box = document.getElementById("history-list");
  const arr = JSON.parse(localStorage.getItem("history") || "[]").slice(0, 5);
  if (arr.length === 0) { box.innerHTML = "<p>まだ履歴がありません。</p>"; return; }
  arr.forEach(h => {
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `
      <a href="https://www.youtube.com/watch?v=${h.id}" target="_blank" rel="noopener">
        <img src="${h.thumb}" alt="">
      </a>
      <div class="body">
        <div class="title">
          <a href="https://www.youtube.com/watch?v=${h.id}" target="_blank" rel="noopener">${escapeHtml(h.title)}</a>
        </div>
        <div class="meta">${escapeHtml(h.channel)}</div>
        <div class="badge">${escapeHtml(h.reason)}</div>
        <div class="insight">${escapeHtml(h.text)}</div>
      </div>
    `;
    box.appendChild(el);
  });
}
