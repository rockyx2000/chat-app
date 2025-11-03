#!/bin/sh
set -e

echo "=== Starting backend container ==="
echo "Current directory: $(pwd)"
echo "DATABASE_URL is set: ${DATABASE_URL:+yes}"
echo "Prisma version:"
npx prisma --version || (echo "ERROR: prisma command not found" && exit 1)

echo "Running database migrations..."
npx prisma migrate deploy || {
    echo "ERROR: Migration failed!"
    echo "This might be due to:"
    echo "  - DATABASE_URL not set or incorrect"
    echo "  - Database server not accessible"
    echo "  - Migration file errors"
    exit 1
}

echo "Migrations completed successfully!"
echo "Starting application..."
exec node src/server.js

