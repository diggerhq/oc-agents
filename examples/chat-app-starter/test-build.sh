#!/bin/bash

# Test script to verify the chat app builds correctly

echo "🧪 Testing Oshu Chat App build..."

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Type check
echo "🔍 Running type check..."
npm run type-check
if [ $? -ne 0 ]; then
    echo "❌ Type check failed"
    exit 1
fi

# Build
echo "🏗️ Building application..."
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi

echo "✅ All tests passed!"
echo ""
echo "🚀 Ready to run with: npm run dev"