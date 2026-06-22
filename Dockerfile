# Trux cloud dev machine image (Fly driver). Bakes the trux app + a built web surface
# + the claude CLI; the user's own code repo is cloned to /data at boot by the
# entrypoint. See docs/superpowers/specs/2026-06-21-cloud-dev-machine-fly-design.md.
FROM node:22-bookworm-slim

# git: clone the user's repo at boot. ca-certificates/openssl: TLS to GitHub + Anthropic.
# python3/make/g++: native build of better-sqlite3. claude CLI: the default agent.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates openssl python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && npm install -g @anthropic-ai/claude-code

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile \
    && pnpm --filter @trux/mobile build:web

# Cloud defaults; secrets (TRUX_SECRET, ANTHROPIC_API_KEY, …) come from Fly at runtime.
ENV TRUX_HOST=0.0.0.0 \
    TRUX_PORT=4317 \
    TRUX_WORKSPACES=/data \
    TRUX_DB_PATH=/data/.trux/trux.db

EXPOSE 4317
ENTRYPOINT ["/app/deploy/fly/entrypoint.sh"]
