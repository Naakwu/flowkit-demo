FROM oven/bun:1.3.14 AS build

WORKDIR /workspace
COPY package.json bun.lock ./
COPY packages packages

ARG APP_DIR
ARG VITE_API_URL
ARG VITE_BETTER_AUTH_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_BETTER_AUTH_URL=$VITE_BETTER_AUTH_URL

RUN bun install --frozen-lockfile
RUN bun run --cwd packages/$APP_DIR build

FROM nginx:1.27-alpine
COPY deploy/docker/nginx-spa.conf /etc/nginx/conf.d/default.conf
ARG APP_DIR
COPY --from=build /workspace/packages/$APP_DIR/dist /usr/share/nginx/html
EXPOSE 8080
