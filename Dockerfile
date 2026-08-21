# ── Derleme aşaması ──────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Yalnızca üretim bağımlılıkları
RUN npm ci --omit=dev && npm cache clean --force

# ── Çalıştırma aşaması ───────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
RUN apk add --no-cache tini && \
    addgroup -g 1001 -S nodejs && \
    adduser -u 1001 -S notify -G nodejs

COPY --from=builder --chown=notify:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=notify:nodejs /app/dist ./dist
COPY --from=builder --chown=notify:nodejs /app/package.json ./package.json
# schema.sql derlemeye dahil olmadığı için ayrıca kopyalanır
COPY --from=builder --chown=notify:nodejs /app/src/lib/schema.sql ./dist/lib/schema.sql

# Root olarak çalıştırma
USER notify

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>{if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
