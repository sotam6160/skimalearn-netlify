// public/app.js（① クリック再生＋C/D 興味なし機能 版）

const view = document.getElementById("view");
const T = (id) => document.getElementById(id).content.cloneNode(true);

document.getElementById("nav-preferences").onclick = renderPreferences;
document.getElementById("nav-feed").onclick = renderFeed;
document.getElementById("nav-history").onclick = renderHistory;

// 初期表示
renderFeed();

function getPrefs() {
  const country = localStorage.getItem("country") || "JP";
  const tags = (localStorage.getItem("usualTags") || "マーケ, 広告, ビジネス")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { country, usualTags: tags };
}

function setPrefs({ country, usualTags }) {
  localStorage.setItem("country", country || "JP");
  localStorage.setItem(
    "usualTags",
    (usualTags && usualTags.length ? usualTags : ["マーケ", "広告", "ビジネス"]).join(", ")
  );
}

function renderPreferences() {
  view.innerHTML = "";
  view.appendChild(T("tpl-preferences"));
  const country = document.getElementById("country");
  const tags = document.getElementById("tags");
  const { country: c, usualTags } = getPrefs();
  country.value = c;
  tags.value = usualTags.join(", ");

  document.getElementById("save-prefs").onclick = () => {
    const newCountry = (country.value || "JP").toUpperCase();
    const newTags = (tags.value || "マーケ, 広告, ビジネス")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setPrefs({ country: newCountry, usualTags: newTags });
    alert("保存しました");
  };
}

async function fetchTrending() {
  const res = await fetch("/.netlify/functions/trending");
  if (!res.ok) throw new Error("trending failed");
  const json = await res.json();
  return json.items || [];
}

function scoreVideos(items, usualTags) {
  // D) 興味なしにしたチャンネルを除外
  const blockedChannels = JSON.parse(localStorage.getItem("blockedChannels") || "[]");

  const lcTags = usualTags.map((t) => t.toLowerCase());
  const cleaned = items
    .filter((it) => !blockedChannels.includes(it?.snippet?.channelTitle || ""))
    .map((it) => {
      const title = it?.snippet?.title || "";
      const desc = it?.snippet?.description || "";
      const channel = it?.snippet?.channelTitle || "";
      const hay = (title + " " + desc + " " + channel).toLowerCase();
      let matches = 0;
      lcTags.forEach((t) => {
        if (hay.includes(t)) matches += 1;
      });
      return { it, matches };
    });

  const picked = [];
  const seenChannel = new Set();

  cleaned
    .sort((a, b) => a.matches - b.matches) // 少ない順＝外れ値
    .forEach(({ it, matches }) => {
      const ch = it?.snippet?.channelTitle || "";
      if (seenChannel.has(ch)) return;
      // タイトル先頭語での簡易重複回避
      const key =
        ((it?.snippet?.title || "").split(/[^\p{L}\p{N}]+/u)[0] || "").toLowerCase();
      if (picked.some((p) => p.key === key)) return;

      picked.push({ it, key, matches });
      seenChannel.add(ch);
    });

  return picked.slice(0, 5).map(({ it, matches }) => ({
    id: it.id,
    url: `https://www.youtube.com/watch?v=${it.id}`, // クリックで再生
    title: it.snippet.title,
    channel: it.snippet.channelTitle,
    thumb: it.snippet.thumbnails?.high?.url || "",
    description: it.snippet.description || "",
    viewCount: it.statistics?.viewCount || "",
    reason: buildReason(usualTags, it),
    matches
  }));
}

function buildReason(usualTags, it) {
  const title = it?.snippet?.title || "";
  const guess = guessTags(title);
  return `普段のタグ: ${usualTags.join("/")} → 本動画タグ: ${guess.join("/") || "未判定"}`;
}

function guessTags(text) {
  const words = (text || "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.slice(0, 2);
}

async function renderFeed() {
  view.innerHTML = "";
  view.appendChild(T("tpl-feed"));

  const { usualTags } = getPrefs();
  const cards = document.getElementById("cards");

  async function load() {
    cards.innerHTML = "<p>読み込み中...</p>";
    try {
      const items = await fetchTrending();
      const top5 = scoreVideos(items, usualTags);

      cards.innerHTML = "";
      top5.forEach((v) => cards.appendChild(videoCard(v, usualTags)));
    } catch (e) {
      cards.innerHTML = `<p>失敗しました。<button id="use-mock">擬似データで表示</button></p>`;
      document.getElementById("use-mock").onclick = async () => {
        const items = await fetchTrending();
        const top5 = scoreVideos(items, usualTags);
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
      }</div>
      <div class="badge">${escapeHtml(v.reason)}</div>
      <div style="margin-top:8px;">
        <a class="play" href="${v.url}" target="_blank" rel="noopener" style="margin-right:6px;">▶︎ 再生</a>
        <button class="skip" style="margin-right:6px;">興味なし</button>
        <button class="gen">学び生成</button>
      </div>
      <div class="insight" hidden></div>
    </div>
  `;

  // C) 「興味なし」押下でチャンネルをブロック
  const skip = el.querySelector(".skip");
  skip.onclick = () => {
    const arr = JSON.parse(localStorage.getItem("blockedChannels") || "[]");
    if (!arr.includes(v.channel)) {
      arr.push(v.channel);
      localStorage.setItem("blockedChannels", JSON.stringify(arr));
    }
    el.remove(); // 画面から即消す（次回はDで除外される）
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
          why: v.reason
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

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
}

function saveHistory({ video, text }) {
  const rec = {
    id: video.id,
    title: video.title,
    channel: video.channel,
    thumb: video.thumb,
    reason: video.reason,
    text,
    at: Date.now()
  };
  const arr = JSON.parse(localStorage.getItem("history") || "[]");
  arr.unshift(rec);
  localStorage.setItem("history", JSON.stringify(arr.slice(0, 50)));
}

function renderHistory() {
  view.innerHTML = "";
  view.appendChild(T("tpl-history"));
  const box = document.getElementById("history-list");
  const arr = JSON.parse(localStorage.getItem("history") || "[]").slice(0, 5);
  if (arr.length === 0) {
    box.innerHTML = "<p>まだ履歴がありません。</p>";
    return;
  }
  arr.forEach((h) => {
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
