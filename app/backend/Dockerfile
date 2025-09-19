FROM node:18-alpine AS build
WORKDIR /app

# 依存関係をインストール（dev含む）
COPY package*.json ./
RUN npm ci

# Prisma クライアント生成
COPY prisma ./prisma
RUN npx prisma generate

# アプリ本体をコピー
COPY . .

# 本番用にdev依存を削除
RUN npm prune --omit=dev

EXPOSE 8080
CMD ["node", "src/server.js"]
