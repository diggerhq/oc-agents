#!/bin/bash

# Deploy script for Get Jeff (Staging)
# Usage: ./deploy-staging.sh

set -e

APP_NAME="get-jeff"
CONFIG_FILE="fly.staging.toml"
ORG="staging-509"
DOMAIN="getjeff.ai"

echo "🚀 Deploying Get Jeff (staging) to org $ORG..."

# Check if app exists, create if not
if ! fly apps list | grep -q "$APP_NAME"; then
    echo "📦 Creating app $APP_NAME..."
    fly apps create "$APP_NAME" --org "$ORG"
fi

# Set secrets (only needs to be done once or when changed)
echo "🔐 Setting secrets..."
fly secrets set \
    WORKOS_REDIRECT_URI="https://${DOMAIN}/api/auth/workos/callback" \
    --app "$APP_NAME" \
    --stage

# Prompt for other secrets if not set
echo ""
echo "⚠️  Make sure you've set these secrets (run once):"
echo "   fly secrets set DATABASE_URL=postgres://user:pass@host:5432/db --app $APP_NAME"
echo "   fly secrets set ANTHROPIC_API_KEY=sk-ant-xxx --app $APP_NAME"
echo "   fly secrets set WORKOS_API_KEY=sk_xxx --app $APP_NAME"
echo "   fly secrets set WORKOS_CLIENT_ID=client_xxx --app $APP_NAME"
echo "   fly secrets set SESSION_SECRET=your-secret --app $APP_NAME"
echo ""

# Create volume if doesn't exist
if ! fly volumes list --app "$APP_NAME" | grep -q "data"; then
    echo "💾 Creating data volume..."
    fly volumes create data --size 1 --region sjc --app "$APP_NAME" --yes
fi

# Deploy
echo "🚀 Deploying..."
fly deploy --config "$CONFIG_FILE" --app "$APP_NAME"

echo ""
echo "✅ Deployed to https://${DOMAIN}"
echo ""
echo "📊 View logs: fly logs --app $APP_NAME"
echo "🔧 SSH into machine: fly ssh console --app $APP_NAME"
