# syntax=docker/dockerfile:1

FROM node:24-trixie-slim@sha256:0820eaa85e07d0490446dd01d14707e17e6108a36988cf374899cd057eb3812d AS build

WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# The package token and optional cloud proxy CA never become image layers.
RUN --mount=type=secret,id=NODE_AUTH_TOKEN,env=NODE_AUTH_TOKEN,required=true \
    --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci

COPY . .
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    NODE_AUTH_TOKEN= npm run build && mkdir -p /runtime-data/vehicle-images

# One-shot migration image uses the same locked Prisma CLI and release files.
FROM build AS migrations
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    node node_modules/prisma/build/index.js --version && chmod -R a+rX prisma prisma.config.ts package.json
USER node
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

FROM node:24-trixie-slim@sha256:0820eaa85e07d0490446dd01d14707e17e6108a36988cf374899cd057eb3812d AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    VEHICLE_IMAGE_DIR=/data/vehicle-images

COPY --from=build /app/.output ./
COPY --from=build --chown=node:node /runtime-data /data
USER node

EXPOSE 3000
VOLUME ["/data/vehicle-images"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/login', { signal: AbortSignal.timeout(4000) }).then(async response => { await response.arrayBuffer(); process.exit(response.ok ? 0 : 1); }).catch(() => process.exit(1))"]

CMD ["node", "server/index.mjs"]
