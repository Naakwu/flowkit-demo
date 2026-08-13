FROM oven/bun:1.3.14

WORKDIR /app
COPY package.json bun.lock bunfig.toml tsconfig.json tsconfig.build.json ./
COPY apps apps
COPY packages packages
COPY scripts scripts
RUN bun install --frozen-lockfile --ignore-scripts

CMD ["bun", "run", "apps/api/src/main.ts"]
