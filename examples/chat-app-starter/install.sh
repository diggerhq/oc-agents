#!/bin/bash

# Oshu Chat App Starter - Installation Script

echo "🚀 Installing Oshu Chat App..."

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Please run this script from the chat-app-starter directory."
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Install browser polyfills for Node.js modules
echo "🔧 Installing browser polyfills..."
npm install events

# Build the SDK first (if needed)
echo "🔧 Building SDK..."
cd ../../packages/sdk-typescript
npm run build
cd ../../examples/chat-app-starter

# Install the SDK package
echo "🔗 Linking SDK..."
npm install

echo ""
echo "✅ Installation complete!"
echo ""
echo "🎯 To start the chat app:"
echo "   npm run dev"
echo ""
echo "⚙️  Configuration:"
echo "   - Default API key: flt_GkBRHUPABVyy2bbkk-0KHxI73Z8cByN2"
echo "   - Default base URL: http://localhost:3000"
echo "   - You can change these in the Settings panel (gear icon)"
echo ""
echo "📋 Make sure your Oshu backend is running on localhost:3000"