# Build stage
FROM node:22-alpine AS build

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Firebase client config must be present at build time (inlined into client JS)
ARG PUBLIC_FIREBASE_API_KEY
ARG PUBLIC_FIREBASE_AUTH_DOMAIN
ARG PUBLIC_FIREBASE_PROJECT_ID
ARG PUBLIC_FIREBASE_STORAGE_BUCKET
ARG PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG PUBLIC_FIREBASE_APP_ID

RUN npm run build

# Production stage
FROM node:22-alpine AS production

WORKDIR /app

# Install runtime dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && apk del python3 make g++

COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public

# Create data directory for SQLite
RUN mkdir -p /app/data

ENV HOST=0.0.0.0
ENV PORT=4321
ENV DATABASE_PATH=/app/data/chess-results.db
ENV ORIGIN=https://chess.bhindle.com

EXPOSE 4321

CMD ["node", "dist/server/entry.mjs"]
