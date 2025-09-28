// netlify/functions/trending.js
export async function handler(event) {
  const YT_KEY = process.env.YOUTUBE_API_KEY || "";
  const country = "JP"; // 必要なら "US" などに変更OK

  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  const params = {
    chart: "mostPopular",
    regionCode: country,
    maxResults: "25",
    part: "snippet,statistics",
    key: YT_KEY
  };
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  let data;
  if (!YT_KEY) {
    data = mock();
  } else {
    try {
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("YouTube API error");
      data = await res.json();
    } catch {
      data = mock();
    }
  }

  return json(data);
}

function json(obj) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(obj)
  };
}

function mock() {
  return {
    items: [
      {
        id: "abc123",
        snippet: {
          title: "宇宙望遠鏡の最新成果",
          description: "銀河観測のアップデート。",
          channelTitle: "Space Lab",
          thumbnails: { high: { url: "https://picsum.photos/seed/astro/640/360" } }
        },
        statistics: { viewCount: "987654" }
      },
      {
        id: "def456",
        snippet: {
          title: "地方鉄道の魅力を語る",
          description: "乗り鉄的な楽しみ方。",
          channelTitle: "Travel Rail",
          thumbnails: { high: { url: "https://picsum.photos/seed/rail/640/360" } }
        },
        statistics: { viewCount: "34567" }
      },
      {
        id: "ghi789",
        snippet: {
          title: "味噌づくり入門",
          description: "発酵の基本と仕込み手順。",
          channelTitle: "Home Ferment",
          thumbnails: { high: { url: "https://picsum.photos/seed/miso/640/360" } }
        },
        statistics: { viewCount: "123456" }
      }
    ]
  };
}
