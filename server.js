import "dotenv/config";
import express from "express";
import { randomUUID } from "crypto";
import { existsSync, createReadStream, unlink, mkdirSync } from "fs";
import { spawn, execFile } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { tmpdir } from "os";
const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Yapılandırma
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || "";
const TMP_DIR = join(tmpdir(), "oneclickdownload");
const YTDLP_BINARY = process.env.YTDLP_BINARY || "yt-dlp";

mkdirSync(TMP_DIR, { recursive: true });

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
// GET /auth/youtube  — tek seferlik OAuth2 akışı (SSE stream)
// Cihaz kodunu döndürür; kullanıcı https://google.com/device adresine gidip
// kodu girdikten sonra token /root/.cache/yt-dlp altına kaydedilir ve
// tüm sonraki indirmelerde otomatik kullanılır.
// ---------------------------------------------------------------------------
app.get("/auth/youtube", requireApiKey, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (type, payload = {}) =>
    res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);

  const proc = spawn(YTDLP_BINARY, [
    "--username", "oauth2",
    "--password", "",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  ]);

  let buf = "";
  let codeSent = false;

  const parse = (chunk) => {
    buf += chunk.toString();
    if (!codeSent) {
      const urlMatch = buf.match(/go to\s+(https?:\/\/\S+)\s+and enter/);
      const codeMatch = buf.match(/enter code\s+(\S+)/);
      if (urlMatch && codeMatch) {
        codeSent = true;
        send("code", { verification_url: urlMatch[1], user_code: codeMatch[1] });
        buf = "";
      }
    }
    // Token kaydedildi — test indirmesi başarılı olsun ya da olmasın işimiz bitti
    if (buf.includes("Authorization successful")) {
      send("complete", { message: "OAuth tamamlandı, token kaydedildi." });
      proc.kill();
      res.end();
    }
  };

  proc.stdout.on("data", parse);
  proc.stderr.on("data", parse);

  proc.on("close", (code) => {
    if (res.writableEnded) return;
    if (code === 0) {
      send("complete", { message: codeSent ? "OAuth tamamlandı, token kaydedildi." : "Token zaten geçerli." });
    } else {
      send("error", { message: `yt-dlp çıkış kodu: ${code}`, details: buf.trim() });
    }
    res.end();
  });

  req.on("close", () => { if (!proc.killed) proc.kill(); });
});

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
    await execFileAsync(YTDLP_BINARY, [url, ...buildArgs(outputPath)]);
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
