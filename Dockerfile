# syntax=docker/dockerfile:1
# Update the tag and digest together in a reviewed dependency change.
FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS tooling
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Optional public CA bundle for corporate build proxies; never pass app secrets.
RUN --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    npm install --global pnpm@9.15.9 --no-audit --no-fund

FROM tooling AS dependencies
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    pnpm install --frozen-lockfile

FROM dependencies AS build
# The context is restricted to an explicit source allowlist by .dockerignore.
COPY . .
# Collection imports the DB module but never connects. This unreachable,
# passwordless placeholder is build-only, not a deployment credential.
RUN --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    POSTGRES_URL=postgres://build@127.0.0.1:1/build PAYMENTS_ENABLED=false pnpm build && \
    rm -rf .next/cache

FROM dependencies AS production-dependencies
# Debian uses glibc; retain its verified native binaries, omit unused musl builds.
RUN pnpm prune --prod && pnpm store prune && rm -rf node_modules/.pnpm/*linux*musl*

FROM build AS runtime-files
RUN mkdir -p /out/lib/config /out/lib/ops /out/scripts && \
    cp -a .next public package.json next.config.ts tsconfig.json /out/ && \
    cp lib/config/runtime.ts /out/lib/config/ && \
    cp lib/ops/database-role.ts lib/ops/database-role-query.mjs /out/lib/ops/ && \
    cp scripts/start.ts scripts/check-config.ts scripts/container-health.mjs scripts/container-entrypoint.mjs /out/scripts/

FROM tooling AS runtime
ENV NODE_ENV=production APP_ENV=staging PORT=3000 \
    PAYMENTS_ENABLED=false SIGNUP_ENABLED=false MEDIA_UPLOADS_ENABLED=false \
    VIDEO_UPLOADS_ENABLED=false VIDEO_WORKER_ENABLED=false
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=runtime-files --chown=node:node /out/ ./
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=8s --start-period=40s --retries=3 \
  CMD ["node", "scripts/container-health.mjs"]
ENTRYPOINT ["node", "scripts/container-entrypoint.mjs"]
CMD ["pnpm", "start", "--hostname", "0.0.0.0"]
