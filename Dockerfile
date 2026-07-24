# Express + SQLite API only (프론트는 Firebase Hosting)
FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server

ENV NODE_ENV=production
ENV PORT=8080
ENV DB_PATH=/data/essersales.db

RUN mkdir -p /data

EXPOSE 8080

CMD ["node", "server/index.js"]
