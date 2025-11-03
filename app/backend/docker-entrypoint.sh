#!/bin/sh

echo "=== Starting backend container ==="
echo "Current directory: $(pwd)"
echo "DATABASE_URL is set: ${DATABASE_URL:+yes}"
if [ -n "$DATABASE_URL" ]; then
  echo "DATABASE_URL starts with: ${DATABASE_URL%:*}"
fi

# Prismaの確認（エラー時も続行）
echo "Prisma version:"
if ! npx prisma --version; then
    echo "ERROR: prisma command not found"
    echo "Checking if prisma is installed..."
    ls -la node_modules/.bin/prisma || echo "prisma binary not found"
    which prisma || echo "prisma not in PATH"
    exit 1
fi

echo "Checking Prisma schema..."
if [ ! -f "prisma/schema.prisma" ]; then
    echo "ERROR: prisma/schema.prisma not found!"
    echo "Files in current directory:"
    ls -la
    exit 1
fi

echo "Checking migration files..."
if [ ! -d "prisma/migrations" ]; then
    echo "ERROR: prisma/migrations directory not found!"
    exit 1
fi

echo "Running database migrations..."
# リトライロジック（データベースが準備できるまで待つ）
MAX_RETRIES=15
RETRY_DELAY=5
RETRY_COUNT=0
MIGRATION_SUCCESS=false

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  echo "Attempting migration (attempt $((RETRY_COUNT + 1))/$MAX_RETRIES)..."
  
  if npx prisma migrate deploy 2>&1; then
    echo "Migration succeeded!"
    MIGRATION_SUCCESS=true
    break
  else
    EXIT_CODE=$?
    RETRY_COUNT=$((RETRY_COUNT + 1))
    
    if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
      echo "Migration failed (exit code: $EXIT_CODE), will retry in ${RETRY_DELAY} seconds..."
      sleep $RETRY_DELAY
    else
      echo "ERROR: Migration failed after $MAX_RETRIES attempts!"
      echo "Exit code: $EXIT_CODE"
      echo ""
      echo "Diagnostic information:"
      if [ -n "$DATABASE_URL" ]; then
        # DATABASE_URLからホスト名を抽出（安全のためパスワード部分は表示しない）
        DB_HOST=$(echo "$DATABASE_URL" | sed -n 's/.*@\([^:]*\):.*/\1/p')
        DB_PORT=$(echo "$DATABASE_URL" | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
        echo "  Database host: ${DB_HOST:-unknown}"
        echo "  Database port: ${DB_PORT:-unknown}"
        echo "  DATABASE_URL format: ${DATABASE_URL%%@*}@***:***/***"
        
        # DNS解決を試行
        if [ -n "$DB_HOST" ]; then
          echo "  Attempting DNS lookup for $DB_HOST..."
          nslookup "$DB_HOST" 2>&1 || echo "  DNS lookup failed for $DB_HOST"
          
          # pingでネットワーク接続を確認（alpineにはpingが含まれている）
          echo "  Testing network connectivity..."
          ping -c 2 "$DB_HOST" 2>&1 || echo "  Network test failed for $DB_HOST"
        fi
      else
        echo "  DATABASE_URL is not set!"
      fi
      echo ""
      echo "This might be due to:"
      echo "  - DATABASE_URL not set or incorrect"
      echo "  - Database server not accessible (check service name in Kubernetes)"
      echo "  - Network connectivity issues (check DNS resolution)"
      echo "  - Database server not ready yet"
      echo "  - Migration file errors"
      exit $EXIT_CODE
    fi
  fi
done

if [ "$MIGRATION_SUCCESS" = "false" ]; then
  echo "ERROR: Migration did not succeed after all retries"
  exit 1
fi

echo "Migrations completed successfully!"
echo "Starting application..."
exec node src/server.js
