#!/bin/bash

# Build OpenComputer Snapshot Templates
# Prerequisites: OPENCOMPUTER_API_KEY set in .env or environment

set -e

echo "========================================="
echo "Building OpenComputer Snapshots"
echo "========================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load env from parent backend/.env if available
if [ -f "../backend/.env" ]; then
  export $(grep OPENCOMPUTER_API_KEY ../backend/.env | xargs)
fi

if [ -z "$OPENCOMPUTER_API_KEY" ]; then
  echo "Error: OPENCOMPUTER_API_KEY not set"
  echo "Set it in backend/.env or export OPENCOMPUTER_API_KEY=..."
  exit 1
fi

npm install

if [ -n "$1" ]; then
  echo "Building $1 only..."
  npx tsx build.ts "$1"
else
  echo "Building all templates..."
  npx tsx build.ts
fi

echo ""
echo "========================================="
echo "Done! Add snapshot names to backend/.env:"
echo ""
echo "OPENCOMPUTER_SNAPSHOT_CLAUDE_CODE=claude-code-agent"
echo "OPENCOMPUTER_SNAPSHOT_OPENCODE=opencode-agent"
echo "========================================="
