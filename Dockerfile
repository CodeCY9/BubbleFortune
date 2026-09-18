# ==============================================================================
# BubbleFortune Production Multi-Stage Dockerfile
# Stage 1: Build frontend static assets (Vite + PWA)
# Stage 2: Web static service (Nginx)
# Stage 3: Game server runtime (Node.js / Colyseus)
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build frontend and install dependencies
# ------------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install all dependencies including build-time tools
RUN npm ci

# Copy application source code and configuration files
COPY index.html vite.config.ts tsconfig*.json ./
COPY src/ ./src/
COPY public/ ./public/
COPY packages/ ./packages/
COPY apps/ ./apps/
COPY scripts/ ./scripts/

# Build frontend static assets and PWA service worker into /app/dist.
# Keep type errors fatal so an image can never silently ship an unverified client.
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Web static service (Nginx)
# ------------------------------------------------------------------------------
FROM nginx:alpine AS web

# Copy compiled static assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy Nginx static configuration with SPA routing, PWA no-cache, and Gzip
COPY docker/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:80/index.html || exit 1

# ------------------------------------------------------------------------------
# Stage 3: Game Server runtime (Node.js / Colyseus) - Default final stage
# ------------------------------------------------------------------------------
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=2567
ENV HOST=0.0.0.0

# Copy manifests and installed node_modules from builder
COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules

# Copy server code, protocol packages, tsconfig, scripts, and built dist
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps ./apps
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/tsconfig*.json ./
COPY --from=builder /app/dist ./dist

# Create durable outbox directory and set permissions for node user
RUN mkdir -p /app/.data/history-outbox && \
    chown -R node:node /app/.data

# Run as non-root user for container security
USER node

EXPOSE 2567

# Healthcheck verifies HTTP API availability and database connectivity via /api/guest
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:2567/api/guest').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Start authoritative Colyseus game server
CMD ["npx", "tsx", "apps/game-server/src/index.ts"]
