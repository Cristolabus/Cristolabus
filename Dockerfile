# ===== Life OS — container image =====
FROM node:20-bookworm-slim

# better-sqlite3 is a native addon; it needs a toolchain to build at install time.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first for better layer caching.
COPY package*.json ./
RUN npm install --omit=dev

# App source.
COPY server ./server
COPY public ./public

# Persist the SQLite database on a mounted volume.
ENV LIFEOS_DATA_DIR=/data
ENV PORT=3000
VOLUME ["/data"]
EXPOSE 3000

CMD ["node", "server/index.js"]
