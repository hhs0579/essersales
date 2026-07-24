FROM node:20-alpine

WORKDIR /app

# Root deps (xlsx shared with frontend parsers)
COPY package.json package-lock.json ./
RUN npm install --omit=dev

# Backend service deps
COPY backend/package.json backend/package-lock.json* ./backend/
WORKDIR /app/backend
RUN npm install --omit=dev

WORKDIR /app
COPY backend/src ./backend/src
COPY src/utils ./src/utils
COPY src/config ./src/config
COPY src/constants ./src/constants
COPY infra/db ./infra/db

WORKDIR /app/backend

# Runtime data directories (volume mount points — entrypoint fixes ownership)
RUN mkdir -p /app/data/uploads /app/data/exports /app/data/backups \
    && mkdir -p /data/uploads /data/exports \
    && apk add --no-cache su-exec \
    && chown -R node:node /app/data /data

COPY backend/docker-entrypoint.sh /docker-entrypoint.sh
RUN sed -i 's/\r$//' /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh

ENV NODE_ENV=production
EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=10s --retries=5 --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:3001/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["npm", "start"]
