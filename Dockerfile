FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Final image
FROM base
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock tsconfig.json index.ts ./
COPY src/ ./src/
COPY web/ ./web/

RUN mkdir -p /app/data

ENV HUMANOMS_HOST=0.0.0.0
ENV HUMANOMS_PORT=3747

EXPOSE 3747

VOLUME ["/app/data"]

CMD ["bun", "run", "index.ts"]
