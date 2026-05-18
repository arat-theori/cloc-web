# syntax=docker/dockerfile:1.7

# ---------- Stage 1: Build cloc-rs WASM ----------
FROM rust:1-bookworm AS wasm-builder
RUN curl -sSf https://rustwasm.github.io/wasm-pack/installer/init.sh | sh
WORKDIR /build
# cloc-rs source comes from a sibling directory via docker-compose's
# additional_contexts (build args won't reach a sibling outside the
# primary build context).
COPY --from=cloc-rs . .
RUN wasm-pack build --target web --release --out-dir pkg
# wasm-pack drops a .gitignore that excludes everything — remove it so
# Stage 2 can COPY the artifacts.
RUN rm -f pkg/.gitignore

# ---------- Stage 2: Build the Next.js app ----------
FROM node:20-alpine AS app-builder
WORKDIR /app

# Install deps first so this layer survives source edits.
COPY package.json package-lock.json ./
RUN npm ci

# Bring in the app source. public/wasm in the build context is the
# stale checked-in artifact; we overwrite it with the freshly built one.
COPY . .
RUN rm -rf public/wasm
COPY --from=wasm-builder /build/pkg/ public/wasm/

RUN npm run build:standalone

# ---------- Stage 3: Runtime ----------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# `output: "standalone"` packs a minimal node_modules into .next/standalone/.
COPY --from=app-builder /app/.next/standalone ./
COPY --from=app-builder /app/.next/static ./.next/static
COPY --from=app-builder /app/public ./public

USER node
EXPOSE 3000
CMD ["node", "server.js"]
