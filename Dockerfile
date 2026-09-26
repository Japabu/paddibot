FROM node:22-bookworm-slim

# yt-dlp does the YouTube extraction (needs python3), node doubles as its JS runtime
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 ca-certificates curl \
	&& curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
	&& chmod +x /usr/local/bin/yt-dlp \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json .
RUN npm ci --omit=dev
COPY index.js .

# YouTube breaks yt-dlp regularly, so update it on every start
CMD ["sh", "-c", "yt-dlp -U || true; exec node index.js"]
