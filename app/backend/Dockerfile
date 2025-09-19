FROM node:18-alpine AS base
WORKDIR /app

# 依存関係のみ先にインストール
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Prisma クライアント生成のためにスキーマをコピー
COPY prisma ./prisma
RUN npx prisma generate || echo "skip prisma generate"

# アプリ本体をコピー
COPY src ./src

EXPOSE 8080
CMD ["node", "src/server.js"]
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 8080
CMD ["node", "server.js"]
