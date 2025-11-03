FROM node:18-alpine AS build
WORKDIR /app

## 依存関係をインストール（prepare/prepareスクリプトは無効化）
RUN apk add --no-cache openssl
COPY package*.json ./
RUN npm ci --ignore-scripts

## Prisma クライアント生成（スキーマをコピーした後に手動実行）
COPY prisma ./prisma
RUN npx prisma generate || (echo "warn: prisma generate skipped" && true)

# アプリ本体をコピー
COPY . .

# エントリーポイントスクリプトをコピーして実行可能にする
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# 本番用にdev依存を削除（prismaは依存関係に含めるので削除されない）
RUN npm prune --omit=dev

# prismaが正しくインストールされているか確認
RUN npx prisma --version || (echo "ERROR: prisma not found" && exit 1)

EXPOSE 8080
# ENTRYPOINTはinitコンテナで上書きできるように、CMDとして設定
CMD ["/app/docker-entrypoint.sh"]
