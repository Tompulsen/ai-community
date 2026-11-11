# syntax=docker/dockerfile:1
FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS build
RUN apt-get update && apt-get install --no-install-recommends -y git ca-certificates curl && rm -rf /var/lib/apt/lists/*
WORKDIR /engine
COPY services/documents/package*.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY services/documents/engine.mjs services/documents/build.mjs services/documents/upstream-lock.json ./
RUN git init /upstream && git -C /upstream remote add origin https://github.com/genspark-ai/genoffice.git && git -C /upstream fetch --depth 1 origin 1a0fcec971c714d11777cbd5c68da1c933572d14 && git -C /upstream checkout --detach FETCH_HEAD
ENV GENOFFICE_SOURCE=/upstream
RUN node build.mjs
RUN curl --fail --location --retry 2 --output /tmp/genoffice.deb https://github.com/genspark-ai/genoffice/releases/download/v0.12.600/genoffice_0.12.600_amd64.deb && echo '124be568c97a8fcf611735b63c04dec4c0e1b280a61db33e1a2fccd988a9b0fe  /tmp/genoffice.deb' | sha256sum --check && dpkg-deb -x /tmp/genoffice.deb /tmp/genoffice && mkdir -p /native && cp /tmp/genoffice/opt/GenOffice/resources/native/xlsx-sidecar /native/ && cp /tmp/genoffice/opt/GenOffice/resources/THIRD-PARTY-NOTICES.txt /native/ && chmod 755 /native/xlsx-sidecar
COPY services/documents/test.mjs ./test.mjs
RUN XLSX_SIDECAR_PATH=/native/xlsx-sidecar node test.mjs
COPY services/documents/server.ts /source/services/documents/server.ts
COPY studio/app/utils/document-workspace.ts /source/studio/app/utils/document-workspace.ts
RUN ln -s /engine/node_modules /source/node_modules && ./node_modules/.bin/esbuild /source/services/documents/server.ts --bundle --platform=node --target=node24 --format=esm --outfile=/engine/dist/server.mjs
COPY services/documents/QXChat-LICENSE /engine/dist/licenses/QXChat-LICENSE

FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
RUN groupadd -g 11001 documents && useradd --no-create-home -u 11001 -g 11001 documents && mkdir /documents && chown 11001:11001 /documents
COPY --from=build /engine/dist/ /srv/
COPY --from=build /native/ /srv/native/
ENV DOCUMENT_ENGINE_ENTRY=/srv/engine.cjs XLSX_SIDECAR_PATH=/srv/native/xlsx-sidecar DOCUMENT_STORAGE_ROOT=/documents TMPDIR=/tmp
USER 11001:11001
WORKDIR /srv
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3010/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--max-old-space-size=256", "/srv/server.mjs"]
