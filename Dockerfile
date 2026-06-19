FROM node:20-alpine AS base

RUN apk add --no-cache \
  ffmpeg \
  bash

WORKDIR /app

FROM base AS builder

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS production

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/generated ./src/generated
COPY --from=builder /app/prisma ./prisma

RUN mkdir -p /app/sessions /app/logs /app/temp

EXPOSE 3001

CMD ["node", "dist/index.js"]
