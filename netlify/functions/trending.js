// netlify/functions/trending.js
export default async () => {
  const YT_KEY = process.env.YOUTUBE_API_KEY || "";
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");

  const country = "JP"; // 必要に応じて変更。クライアントから渡す場合はevent.queryStringParametersを使用。

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
    data = await importMock();
  } else {
    try {
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`YouTube API error ${res.status}`);
      data = await res.json();
    } catch (e) {
      data = await importMock();
    }
  }

  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    status: 200
  });
};

async function importMock() {
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
