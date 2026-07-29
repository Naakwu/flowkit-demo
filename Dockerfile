FROM oven/bun:1.3.14
WORKDIR /app
COPY packages/flowkit-core/package.json packages/flowkit-core/package.json
COPY packages/flowkit-core/dist packages/flowkit-core/dist
COPY packages/flowkit-temporal/package.json packages/flowkit-temporal/package.json
COPY packages/flowkit-temporal/dist packages/flowkit-temporal/dist
COPY packages/flowkit-tasks/package.json packages/flowkit-tasks/package.json
COPY packages/flowkit-tasks/dist packages/flowkit-tasks/dist
COPY packages/flowkit-notify/package.json packages/flowkit-notify/package.json
COPY packages/flowkit-notify/dist packages/flowkit-notify/dist
COPY packages/flowkit-auth/package.json packages/flowkit-auth/package.json
COPY packages/flowkit-auth/dist packages/flowkit-auth/dist
COPY packages/flowkit-demo/package.json packages/flowkit-demo/package.json
COPY packages/flowkit-demo/tsconfig.json packages/flowkit-demo/tsconfig.build.json packages/flowkit-demo/.env.example packages/flowkit-demo/
COPY packages/flowkit-demo/src packages/flowkit-demo/src
COPY packages/flowkit-demo/public packages/flowkit-demo/public
COPY packages/flowkit-demo/scripts packages/flowkit-demo/scripts
COPY packages/flowkit-demo/migrations packages/flowkit-demo/migrations
WORKDIR /app/packages/flowkit-demo
RUN bun install --ignore-scripts
# The demo is installed as the runtime consumer, while the copied Flowkit
# packages remain sibling package directories. Link the consumer's resolved
# dependency tree into those package directories so ESM resolution from their
# dist files can resolve @flowkit/core and their external dependencies.
RUN for package in flowkit-core flowkit-temporal flowkit-tasks flowkit-notify flowkit-auth; do \
      ln -s /app/packages/flowkit-demo/node_modules /app/packages/$package/node_modules; \
    done
CMD ["bun", "run", "src/api/main.ts"]
