#!/bin/bash

# Deploy script for Oshu.dev (primeintuition app)
# Usage: ./deploy-oshu.sh

set -e

APP_NAME="primeintuition"
CONFIG_FILE="fly.oshu.toml"
DOMAIN="oshu.dev"

echo "🚀 Deploying to $DOMAIN..."

# Deploy
fly deploy --config "$CONFIG_FILE" --app "$APP_NAME"

echo ""
echo "✅ Deployed to https://${DOMAIN}"
echo ""
echo "📊 View logs: fly logs --app $APP_NAME"
echo "🔧 SSH into machine: fly ssh console --app $APP_NAME"
echo "📈 Status: fly status --app $APP_NAME"
