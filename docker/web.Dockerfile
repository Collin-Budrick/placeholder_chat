## Builder: install deps and build static site
FROM oven/bun:1 AS builder
SHELL ["/bin/bash", "-lc"]
WORKDIR /workspace

# Optional: install Node.js 22.x for plugins that expect Node runtime during build
RUN set -eux; \
    export DEBIAN_FRONTEND=noninteractive; \
    apt-get update; \
    apt-get install -y --no-install-recommends curl ca-certificates gnupg; \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -; \
    apt-get install -y --no-install-recommends nodejs; \
    node -v && npm -v; \
    rm -rf /var/lib/apt/lists/*

# Install workspace dependencies with maximum cache
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN bun install --ignore-scripts

# Copy source and build
COPY . .
RUN bun x tsc -p packages/shared/tsconfig.build.json
WORKDIR /workspace/apps/web
ENV NODE_ENV=production
RUN ASSET_COMPRESSION=1 ASSET_BROTLI=1 BUILD_TARGET=client bunx vite build
RUN BUILD_TARGET=ssg ASSET_COMPRESSION=0 bunx vite build -c adapters/static/vite.config.ts

## Runner: serve prebuilt static assets
FROM oven/bun:1 AS runner
WORKDIR /workspace
ENV NODE_ENV=production \
    PORT=5174 \
    HOST=0.0.0.0 \
    DIST_DIR=/workspace/apps/web/dist

# Copy only the runtime bits
COPY --from=builder /workspace/apps/web/dist ./apps/web/dist
COPY --from=builder /workspace/apps/web/scripts ./apps/web/scripts

EXPOSE 5174
CMD ["bun", "apps/web/scripts/serve-static.ts"]
