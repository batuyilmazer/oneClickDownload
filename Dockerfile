FROM node:22-slim

# ffmpeg + yt-dlp için sistem bağımlılıkları
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
  && pip3 install --break-system-packages "yt-dlp[default]" \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./

# Geçici dosyalar için dizin (volume mount da olabilir)
RUN mkdir -p /tmp/oneclickdownload

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
