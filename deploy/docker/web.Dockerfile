FROM oven/bun:1.3.14 AS build

WORKDIR /app
COPY package.json bun.lock bunfig.toml tsconfig.json ./
COPY apps apps
COPY packages packages
RUN bun install --frozen-lockfile --ignore-scripts --filter @flowkit-demo/web
RUN bun run --cwd apps/web build

FROM nginx:1.27-alpine

COPY deploy/docker/nginx-spa.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/apps/web /usr/share/nginx/html
EXPOSE 8080
