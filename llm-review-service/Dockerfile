FROM node:20.19-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src/ src/
COPY tsconfig.json ./
RUN npm run build

FROM node:20.19-slim

WORKDIR /app
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup appuser

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist/ dist/
COPY --from=build /app/src/db/migrations/ src/db/migrations/

USER appuser

EXPOSE 3000
ENV NODE_ENV=production

CMD ["node", "dist/server.js"]
