# ==============================================================================
# BubbleFortune Production Multi-Stage Dockerfile
# Stage 1: Build frontend static assets (Vite + PWA)
# Stage 2: Web static service (Nginx)
# Stage 3: Game server runtime (Node.js / Colyseus)
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build frontend and install dependencies
# ------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install all dependencies including build-time tools
RUN npm ci

# Copy application source code, configuration files, and any pre-built dist
COPY index.html vite.config.ts tsconfig*.json ./
COPY src/ ./src/
COPY public/ ./public/
COPY packages/ ./packages/
COPY apps/ ./apps/
COPY scripts/ ./scripts/
COPY . ./

# If dist/index.html was pre-built, skip expensive Vite compilation to protect low-memory VPS.
# Otherwise, compile frontend static assets and PWA service worker into /app/dist.
RUN if [ -f dist/index.html ]; then \
      echo "=== [builder] Found pre-built dist/index.html! Skipping Vite build. ==="; \
    else \
      echo "=== [builder] Compiling frontend with Vite... ===" && \
      npm run build; \
    fi

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
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=2567
ENV HOST=0.0.0.0

# Copy manifests and installed node_modules from builder with node user ownership
COPY --chown=node:node package*.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules

# Copy server code, protocol packages, tsconfig, scripts, and built dist
COPY --chown=node:node --from=builder /app/packages ./packages
COPY --chown=node:node --from=builder /app/apps ./apps
COPY --chown=node:node --from=builder /app/scripts ./scripts
COPY --chown=node:node --from=builder /app/tsconfig*.json ./

# Create durable outbox directory and ensure full permissions for node user
RUN mkdir -p /app/.data/history-outbox && \
    chown -R node:node /app

# Run as non-root user for container security
USER node

EXPOSE 2567

# Healthcheck verifies HTTP API availability and database connectivity via /readyz
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:2567/readyz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Start authoritative Colyseus game server directly via local tsx binary
CMD ["./node_modules/.bin/tsx", "apps/game-server/src/index.ts"]
