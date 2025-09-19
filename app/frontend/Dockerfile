# Stage 1: ビルド環境
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: 本番環境
FROM nginx:1.25-alpine
# ビルドした静的ファイルをNginxの公開ディレクトリにコピー（Viteはdist）
COPY --from=build /app/dist /usr/share/nginx/html
# Nginxの設定ファイルをコピー
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Nginxをフォアグラウンドで実行
CMD ["nginx", "-g", "daemon off;"]

