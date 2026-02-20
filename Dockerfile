FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Final image
FROM base

# Install system tools used by shell_command (git, gh, curl, wget)
RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl wget ca-certificates \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock tsconfig.json ./
COPY src/ ./src/
COPY web/ ./web/
COPY scripts/ ./scripts/

# Make data dir writable by any UID (docker-compose sets user: to match host)
RUN mkdir -p /app/data && chmod 777 /app/data

ENV HUMANOMS_HOST=0.0.0.0
ENV HUMANOMS_PORT=3747
ENV NODE_ENV=production

EXPOSE 3747

VOLUME ["/app/data"]

CMD ["bun", "run", "src/index.ts"]
