#!/bin/bash

# SDK Test Runner
# 
# Run SDK tests for session isolation, task execution, and API access.
#
# Usage:
#   ./scripts/test-sdk.sh [ts|py|all]
#
# Environment variables (required):
#   OSHU_AGENT_ID - Agent ID to test with (must have API enabled)
#
# Optional:
#   OSHU_API_KEY - API key (default: uses flt_test_key)
#   OSHU_BASE_URL - Base URL (default: http://localhost:3000)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check required env
if [ -z "$OSHU_AGENT_ID" ]; then
    echo -e "${RED}Error: OSHU_AGENT_ID environment variable is required${NC}"
    echo ""
    echo "Usage: OSHU_AGENT_ID=<agent-id> $0 [ts|py|all]"
    echo ""
    echo "Make sure the agent has API access enabled."
    exit 1
fi

# Default to testing all
TEST_TYPE="${1:-all}"

echo ""
echo "=================================="
echo "  Oshu SDK Test Runner"
echo "=================================="
echo ""
echo "Agent ID: $OSHU_AGENT_ID"
echo "Base URL: ${OSHU_BASE_URL:-http://localhost:3000}"
echo ""

run_typescript_tests() {
    echo -e "${YELLOW}▶ Running TypeScript SDK Tests...${NC}"
    echo ""
    
    cd "$ROOT_DIR/packages/sdk-typescript"
    
    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        echo "Installing dependencies..."
        npm install
    fi
    
    # Run tests
    npm test
    
    echo ""
    echo -e "${GREEN}✓ TypeScript tests completed${NC}"
    echo ""
}

run_python_tests() {
    echo -e "${YELLOW}▶ Running Python SDK Tests...${NC}"
    echo ""
    
    cd "$ROOT_DIR/packages/sdk-python"
    
    # Check if virtual env exists, create if not
    if [ ! -d ".venv" ]; then
        echo "Creating virtual environment..."
        python3 -m venv .venv
    fi
    
    # Activate venv and install
    source .venv/bin/activate
    pip install -q -e ".[dev]"
    
    # Run tests
    python tests/test_sdk.py
    
    deactivate
    
    echo ""
    echo -e "${GREEN}✓ Python tests completed${NC}"
    echo ""
}

case "$TEST_TYPE" in
    ts|typescript)
        run_typescript_tests
        ;;
    py|python)
        run_python_tests
        ;;
    all)
        run_typescript_tests
        run_python_tests
        ;;
    *)
        echo "Unknown test type: $TEST_TYPE"
        echo "Usage: $0 [ts|py|all]"
        exit 1
        ;;
esac

echo "=================================="
echo "  All tests completed!"
echo "=================================="
