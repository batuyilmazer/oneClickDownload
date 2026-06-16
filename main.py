import os
import uuid
import re
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from pydantic import BaseModel
import yt_dlp


SUPPORTED_PATTERNS = [
    r"(https?://)?(www\.)?(youtube\.com|youtu\.be)/\S+",
    r"(https?://)?(www\.)?instagram\.com/\S+",
    r"(https?://)?(www\.)?(twitter\.com|x\.com)/\S+",
    r"(https?://)?(www\.)?tiktok\.com/\S+",
    r"(https?://)?vm\.tiktok\.com/\S+",
]

TEMP_DIR = Path("/tmp/oneclick_downloads")


@asynccontextmanager
async def lifespan(app: FastAPI):
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(
    title="OneClickDownload API",
    description="Clipboard'daki sosyal medya linkini video olarak indirir",
    lifespan=lifespan,
)


class DownloadRequest(BaseModel):
    url: str


def is_supported_url(url: str) -> bool:
    return any(re.search(pattern, url, re.IGNORECASE) for pattern in SUPPORTED_PATTERNS)


def extract_url(text: str) -> str | None:
    """Clipboard metninden ilk geçerli sosyal medya URL'ini çıkarır."""
    url_re = r"https?://\S+"
    candidates = re.findall(url_re, text)
    for candidate in candidates:
        if is_supported_url(candidate):
            return candidate
    return None


def delete_file(path: str) -> None:
    try:
        os.remove(path)
    except FileNotFoundError:
        pass


def build_ydl_opts(output_path: str) -> dict:
    return {
        # iOS Photos en iyi şekilde mp4 oynatır; mümkünse mp4 tercih et
        "format": "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "outtmpl": output_path,
        "merge_output_format": "mp4",
        "quiet": True,
        "no_warnings": True,
        # Twitter/X ve Instagram için zaman zaman user-agent gerekebilir
        "http_headers": {
            "User-Agent": (
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
            )
        },
        # İndirme zaman aşımı (saniye)
        "socket_timeout": 30,
    }


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/download")
async def download(request: DownloadRequest, background_tasks: BackgroundTasks):
    """
    Verilen URL'deki videoyu indirir ve mp4 dosyası olarak döner.
    iOS Kestirmesi bu endpoint'i çağırır ve dönen dosyayı Fotoğraflar'a kaydeder.
    """
    url = request.url.strip()

    # Clipboard ham metin gelebilir; içinden URL çek
    extracted = extract_url(url)
    if extracted:
        url = extracted
    elif not is_supported_url(url):
        raise HTTPException(
            status_code=400,
            detail="Desteklenmeyen platform. YouTube, Instagram, Twitter/X veya TikTok linki gönderin.",
        )

    output_path = str(TEMP_DIR / f"{uuid.uuid4()}.mp4")
    ydl_opts = build_ydl_opts(output_path)

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
    except yt_dlp.utils.DownloadError as exc:
        raise HTTPException(status_code=422, detail=f"İndirme hatası: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Sunucu hatası: {exc}")

    if not os.path.exists(output_path):
        raise HTTPException(status_code=500, detail="Dosya oluşturulamadı.")

    # İstek tamamlandıktan sonra geçici dosyayı sil
    background_tasks.add_task(delete_file, output_path)

    return FileResponse(
        path=output_path,
        media_type="video/mp4",
        filename="video.mp4",
    )
