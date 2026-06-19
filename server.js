import "dotenv/config";
import express from "express";
import { randomUUID } from "crypto";
import { existsSync, createReadStream, unlink } from "fs";
import { mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import YTDlpWrapModule from "yt-dlp-wrap";
const YTDlpWrap = YTDlpWrapModule.default ?? YTDlpWrapModule;

// ---------------------------------------------------------------------------
// Yapılandırma
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || "";
const TMP_DIR = join(tmpdir(), "oneclickdownload");
const YTDLP_BINARY = process.env.YTDLP_BINARY || "yt-dlp";

mkdirSync(TMP_DIR, { recursive: true });

const ytDlp = new YTDlpWrap(YTDLP_BINARY);

// ---------------------------------------------------------------------------
// Desteklenen platform regex'leri
// ---------------------------------------------------------------------------
const SUPPORTED_PATTERNS = [
  /https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/\S+/i,
  /https?:\/\/(www\.)?instagram\.com\/\S+/i,
  /https?:\/\/(www\.)?(twitter\.com|x\.com)\/\S+/i,
  /https?:\/\/(www\.)?tiktok\.com\/\S+/i,
  /https?:\/\/vm\.tiktok\.com\/\S+/i,
];

function extractURL(text) {
  const candidates = text.match(/https?:\/\/\S+/g) ?? [];
  return candidates.find((c) => SUPPORTED_PATTERNS.some((re) => re.test(c))) ?? null;
}

// ---------------------------------------------------------------------------
// yt-dlp seçenekleri
// ---------------------------------------------------------------------------
function buildArgs(outputPath) {
  return [
    "-f", "bestvideo[height<=1080]+bestaudio/bestvideo[height<=1080]/bestvideo+bestaudio/best",
    "--merge-output-format", "mp4",
    "-o", outputPath,
    "--quiet",
    "--no-warnings",
    "--socket-timeout", "30",
    // YouTube bot tespitini cookie olmadan bypass etmek için Android + iOS client kullan
    "--extractor-args", "youtube:player_client=android,ios,web",
  ];
}

// ---------------------------------------------------------------------------
// Express uygulaması
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// GET /health  (auth yok — Docker health check için)
// ---------------------------------------------------------------------------
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// İsteğe bağlı API anahtarı doğrulama (yalnızca /download)
function requireApiKey(req, res, next) {
  if (!API_KEY) return next();
  const provided = req.headers["x-api-key"] ?? req.query.apiKey;
  if (provided !== API_KEY) return res.status(401).json({ error: "Yetkisiz istek." });
  next();
}

// ---------------------------------------------------------------------------
// POST /download
// Body: { "url": "<clipboard metni veya direkt link>" }
// Yanıt: video/mp4 binary stream
// ---------------------------------------------------------------------------
app.post("/download", requireApiKey, async (req, res) => {
  let { url } = req.body ?? {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "url alanı zorunlu." });
  }
  url = url.trim();

  // Ham clipboard metni gelebilir; içinden URL çıkar
  const extracted = extractURL(url);
  if (extracted) {
    url = extracted;
  } else if (!SUPPORTED_PATTERNS.some((re) => re.test(url))) {
    return res.status(400).json({
      error: "Desteklenmeyen platform. YouTube, Instagram, Twitter/X veya TikTok linki gönderin.",
    });
  }

  const outputPath = join(TMP_DIR, `${randomUUID()}.mp4`);

  try {
    await ytDlp.execPromise([url, ...buildArgs(outputPath)]);
  } catch (err) {
    console.error("yt-dlp hatası:", err.message);
    return res.status(422).json({ error: `İndirme hatası: ${err.message}` });
  }

  if (!existsSync(outputPath)) {
    return res.status(500).json({ error: "Dosya oluşturulamadı." });
  }

  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", 'attachment; filename="video.mp4"');

  const stream = createReadStream(outputPath);
  stream.pipe(res);

  // İndirme tamamlandıktan sonra geçici dosyayı sil
  stream.on("close", () => unlink(outputPath, () => {}));
  stream.on("error", (e) => {
    console.error("Stream hatası:", e.message);
    unlink(outputPath, () => {});
  });
});

// ---------------------------------------------------------------------------
// Sunucu başlat
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`OneClickDownload sunucusu çalışıyor → http://localhost:${PORT}`);
  if (API_KEY) console.log("API anahtarı koruması aktif.");
});
