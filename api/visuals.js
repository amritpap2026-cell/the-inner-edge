export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Use GET or POST." });
  }

  try {
    const input = req.method === "POST"
      ? (typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {}))
      : (req.query || {});

    const query = String(input.query || input.q || "").trim();
    const limit = Math.min(Math.max(Number(input.limit) || 6, 1), 12);

    if (!query) {
      return res.status(400).json({ ok: false, error: "Missing query." });
    }

    const results = [];

    // Pexels is the primary source for vertical stock video.
    if (process.env.PEXELS_API_KEY) {
      const url = new URL("https://api.pexels.com/v1/videos/search");
      url.searchParams.set("query", query);
      url.searchParams.set("orientation", "portrait");
      url.searchParams.set("size", "medium");
      url.searchParams.set("per_page", String(limit));

      const response = await fetch(url, {
        headers: { Authorization: process.env.PEXELS_API_KEY }
      });

      if (response.ok) {
        const data = await response.json();
        for (const video of data.videos || []) {
          const files = (video.video_files || [])
            .filter(file => file.link && file.file_type === "video/mp4")
            .sort((a, b) => (b.width || 0) - (a.width || 0));

          const file = files.find(f => (f.width || 0) <= 1080) || files[0];
          if (!file) continue;

          results.push({
            source: "pexels",
            id: String(video.id),
            title: video.url || "Pexels video",
            duration: Number(video.duration) || 0,
            width: Number(file.width) || 0,
            height: Number(file.height) || 0,
            url: file.link,
            preview: video.image || "",
            attributionUrl: video.url || "https://www.pexels.com/"
          });
        }
      }
    }

    // Pixabay fallback.
    if (results.length < limit && process.env.PIXABAY_API_KEY) {
      const url = new URL("https://pixabay.com/api/videos/");
      url.searchParams.set("key", process.env.PIXABAY_API_KEY);
      url.searchParams.set("q", query);
      url.searchParams.set("per_page", String(limit));
      url.searchParams.set("safesearch", "true");

      const response = await fetch(url);

      if (response.ok) {
        const data = await response.json();
        for (const video of data.hits || []) {
          const candidates = [
            video.videos?.medium,
            video.videos?.large,
            video.videos?.small
          ].filter(file => file?.url);

          const file = candidates[0];
          if (!file) continue;

          results.push({
            source: "pixabay",
            id: String(video.id),
            title: video.tags || "Pixabay video",
            duration: Number(video.duration) || 0,
            width: Number(file.width) || 0,
            height: Number(file.height) || 0,
            url: file.url,
            preview: video.picture_id
              ? `https://i.vimeocdn.com/video/${video.picture_id}_640x360.jpg`
              : "",
            attributionUrl: "https://pixabay.com/"
          });

          if (results.length >= limit) break;
        }
      }
    }

    // Coverr fallback. Coverr supports query search and returns MP4 URLs.
    if (results.length < limit && process.env.COVERR_API_KEY) {
      const url = new URL("https://api.coverr.co/videos");
      url.searchParams.set("query", query);
      url.searchParams.set("page_size", String(limit));
      url.searchParams.set("urls", "true");

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${process.env.COVERR_API_KEY}` }
      });

      if (response.ok) {
        const data = await response.json();
        for (const video of data.hits || []) {
          const mp4 = video.urls?.mp4 || video.urls?.mp4_download;
          if (!mp4) continue;

          results.push({
            source: "coverr",
            id: String(video.id),
            title: video.title || "Coverr video",
            duration: Number(video.duration) || 0,
            width: Number(video.max_width) || 0,
            height: Number(video.max_height) || 0,
            url: mp4,
            preview: video.thumbnail || video.poster || "",
            attributionUrl: "https://coverr.co/"
          });

          if (results.length >= limit) break;
        }
      }
    }

    const unique = [];
    const seen = new Set();

    for (const item of results) {
      const key = item.source + ":" + item.id;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }

    if (!unique.length) {
      return res.status(502).json({
        ok: false,
        error: "No visual results available.",
        details: "Check PEXELS_API_KEY, PIXABAY_API_KEY and COVERR_API_KEY in Vercel."
      });
    }

    return res.status(200).json({
      ok: true,
      query,
      count: unique.length,
      results: unique.slice(0, limit)
    });
  } catch (error) {
    console.error("VISUAL SEARCH FAILURE:", error);
    return res.status(502).json({
      ok: false,
      error: "Visual search failed.",
      details: error?.message || String(error)
    });
  }
}
