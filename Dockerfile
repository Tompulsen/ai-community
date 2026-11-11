# syntax=docker/dockerfile:1
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig*.json vite.config.ts ./
COPY src ./src
COPY public ./public
COPY server ./server
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache ffmpeg
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
RUN addgroup -g 991 community && adduser -D -u 991 -G community community
COPY --from=build /app/dist ./dist
COPY server ./server
COPY THIRD_PARTY_NOTICES.md REUSE.md LICENSE ./
USER community
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=8s --retries=6 --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/runtime.ts"]
