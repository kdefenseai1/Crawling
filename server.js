const express = require("express");
const archiver = require("archiver");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config();

const app = express();
const DEFAULT_PORT = Number(process.env.PORT || 3000);
const SEARCH_PROVIDER = (process.env.SEARCH_PROVIDER || "duckduckgo").toLowerCase();
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use((_, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});
app.options("*", (req, res) => {
  res.status(204).end();
});

function ensureGoogleConfig(res) {
  if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) {
    res.status(500).json({
      error:
        "Google API 설정이 없습니다. GOOGLE_API_KEY, GOOGLE_CSE_ID를 .env에 설정하세요.",
    });
    return false;
  }
  return true;
}

function extractDuckDuckGoVqd(html) {
  const patterns = [
    /vqd\s*=\s*["']([^"']+)["']/i,
    /["']vqd["']\s*:\s*["']([^"']+)["']/i,
    /vqd=([0-9-]{8,})/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

async function searchDuckDuckGoImages(query, num, start = 0) {
  const baseHeaders = {
    "User-Agent": "Mozilla/5.0",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,ko;q=0.8",
    Referer: "https://duckduckgo.com/",
  };

  const bootstrapUrls = [
    `https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=images&iax=images`,
    `https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=images`,
    `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
  ];

  let vqd = null;
  let lastStatus = null;
  for (const url of bootstrapUrls) {
    try {
      const initRes = await fetch(url, { headers: baseHeaders });
      lastStatus = initRes.status;
      if (!initRes.ok) continue;
      const initHtml = await initRes.text();
      vqd = extractDuckDuckGoVqd(initHtml);
      if (vqd) break;
    } catch (_) {
      // 다음 시도
    }
  }

  if (!vqd) {
    throw new Error(
      `DuckDuckGo 토큰(vqd)을 찾지 못했습니다.${lastStatus ? ` (status ${lastStatus})` : ""}`
    );
  }

  const apiUrl = new URL("https://duckduckgo.com/i.js");
  apiUrl.searchParams.set("l", "us-en");
  apiUrl.searchParams.set("o", "json");
  apiUrl.searchParams.set("q", query);
  apiUrl.searchParams.set("vqd", vqd);
  apiUrl.searchParams.set("f", ",,,");
  apiUrl.searchParams.set("p", "1");
  apiUrl.searchParams.set("s", String(Math.max(0, start)));

  const searchRes = await fetch(apiUrl, {
    headers: {
      ...baseHeaders,
      Referer: "https://duckduckgo.com/",
      Accept: "application/json",
    },
  });

  if (!searchRes.ok) {
    throw new Error(`DuckDuckGo 검색 실패: ${searchRes.status}`);
  }

  const data = await searchRes.json();
  const items = (data.results || []).slice(0, num).map((item, index) => ({
    id: index + 1,
    title: item.title || "image",
    imageUrl: item.image,
    thumbnailUrl: item.thumbnail || item.image,
    sourcePage: item.url || "",
  }));
  let nextStart = null;
  if (typeof data.next === "string") {
    try {
      const nextUrl = new URL(data.next, "https://duckduckgo.com");
      const s = parseInt(nextUrl.searchParams.get("s"), 10);
      if (Number.isFinite(s)) nextStart = s;
    } catch (_) {}
  }

  return { items, nextStart };
}

function sanitizeFilename(name) {
  return (name || "image")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 100);
}

function asciiFilenameBase(name) {
  const ascii = sanitizeFilename(name)
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return ascii || "images";
}

function guessExt(url, contentType) {
  if (contentType) {
    if (contentType.includes("jpeg")) return "jpg";
    if (contentType.includes("png")) return "png";
    if (contentType.includes("webp")) return "webp";
    if (contentType.includes("gif")) return "gif";
    if (contentType.includes("bmp")) return "bmp";
    if (contentType.includes("svg")) return "svg";
  }

  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.split(".").pop()?.toLowerCase();
    if (ext && ext.length <= 5) return ext;
  } catch (_) {}

  return "jpg";
}

app.get(["/api/search", "/search"], async (req, res) => {
  const q = (req.query.q || "").trim();
  const num = Math.min(Math.max(parseInt(req.query.num, 10) || 20, 1), 50);
  const start = Math.max(0, parseInt(req.query.start, 10) || 0);

  if (!q) {
    return res.status(400).json({ error: "검색어(q)가 필요합니다." });
  }

  try {
    if (SEARCH_PROVIDER === "duckduckgo") {
      const result = await searchDuckDuckGoImages(q, num, start);
      const items = result.items;
      return res.json({
        provider: "duckduckgo",
        query: q,
        start,
        nextStart: result.nextStart,
        count: items.length,
        items,
      });
    }

    if (!ensureGoogleConfig(res)) return;

    const endpoint = new URL("https://www.googleapis.com/customsearch/v1");
    endpoint.searchParams.set("key", GOOGLE_API_KEY);
    endpoint.searchParams.set("cx", GOOGLE_CSE_ID);
    endpoint.searchParams.set("q", q);
    endpoint.searchParams.set("searchType", "image");
    endpoint.searchParams.set("num", String(num));
    endpoint.searchParams.set("safe", "active");

    const response = await fetch(endpoint);
    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({
        error: "Google API 호출 실패",
        detail: errText,
      });
    }

    const data = await response.json();
    const items = (data.items || []).map((item, index) => ({
      id: index + 1,
      title: item.title,
      imageUrl: item.link,
      thumbnailUrl: item.image?.thumbnailLink || item.link,
      sourcePage: item.image?.contextLink || "",
    }));

    return res.json({ provider: "google", query: q, count: items.length, items });
  } catch (error) {
    return res.status(500).json({
      error: "검색 처리 중 오류가 발생했습니다.",
      detail: error.message,
    });
  }
});

app.post(["/api/download", "/download"], async (req, res) => {
  const images = Array.isArray(req.body.images) ? req.body.images : [];
  const query = (req.body.query || "images").toString();

  if (!images.length) {
    return res.status(400).json({ error: "다운로드할 이미지가 없습니다." });
  }

  if (images.length > 100) {
    return res.status(400).json({ error: "한 번에 최대 100개까지 다운로드할 수 있습니다." });
  }
  const downloadedImages = [];

  for (let i = 0; i < images.length; i += 1) {
    const imageUrl = images[i];
    if (typeof imageUrl !== "string") continue;

    try {
      const response = await fetch(imageUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (!response.ok) continue;

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.startsWith("image/")) continue;

      const buffer = Buffer.from(await response.arrayBuffer());
      const ext = guessExt(imageUrl, contentType);
      downloadedImages.push({
        buffer,
        name: `image_${String(i + 1).padStart(2, "0")}.${ext}`,
      });
    } catch (_) {
      // 개별 이미지 실패는 건너뛰고 계속 진행
    }
  }

  if (!downloadedImages.length) {
    return res.status(502).json({
      error: "다운로드 가능한 이미지를 찾지 못했습니다. 다른 이미지를 선택해 주세요.",
    });
  }

  const timestamp = Date.now();
  const asciiBase = asciiFilenameBase(query);
  const zipNameAscii = `${asciiBase}_${timestamp}.zip`;

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${zipNameAscii}"`);

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err) => {
    if (!res.headersSent) {
      res.status(500).json({ error: "ZIP 생성 실패", detail: err.message });
    } else {
      res.end();
    }
  });
  archive.pipe(res);

  for (const item of downloadedImages) {
    archive.append(item.buffer, { name: item.name });
  }

  await archive.finalize();
});

function startServer(port = DEFAULT_PORT) {
  return new Promise((resolve, reject) => {
    const server = app
      .listen(port, () => {
        const address = server.address();
        const actualPort = typeof address === "object" && address ? address.port : port;
        console.log(`Server running: http://localhost:${actualPort}`);
        resolve({ server, port: actualPort });
      })
      .on("error", reject);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error("Server failed to start:", error);
    process.exit(1);
  });
}

module.exports = { app, startServer };
