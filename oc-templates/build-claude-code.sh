#!/bin/bash
set -e

# Build Claude Code agent snapshot on OpenComputer
# Usage: ./build-claude-code.sh

API_KEY="${OPENCOMPUTER_API_KEY:-}"
API_URL="https://app.opencomputer.dev/api"

if [ -z "$API_KEY" ]; then
  # Try loading from backend/.env
  if [ -f "../backend/.env" ]; then
    API_KEY=$(grep OPENCOMPUTER_API_KEY ../backend/.env | cut -d= -f2)
  fi
fi

if [ -z "$API_KEY" ]; then
  echo "Error: OPENCOMPUTER_API_KEY not set"
  exit 1
fi

echo "=== Building Claude Code Agent Snapshot ==="

# Create snapshot via REST API with declarative image
echo "Sending snapshot build request..."
curl -s -X POST "$API_URL/snapshots" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "name": "claude-code-agent",
    "image": {
      "base": "default",
      "steps": [
        {
          "type": "apt_install",
          "args": {
            "packages": ["curl", "wget", "git", "ripgrep", "fzf", "ca-certificates", "gnupg", "sudo", "python3", "python3-pip", "unzip", "jq"]
          }
        },
        {
          "type": "run",
          "args": {
            "commands": [
              "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
              "apt-get install -y nodejs"
            ]
          }
        },
        {
          "type": "run",
          "args": {
            "commands": ["npm install -g @anthropic-ai/claude-code"]
          }
        },
        {
          "type": "pip_install",
          "args": {
            "packages": ["python-pptx", "openpyxl", "python-docx"]
          }
        },
        {
          "type": "run",
          "args": {
            "commands": [
              "useradd -m -s /bin/bash user || true",
              "echo \"user ALL=(ALL) NOPASSWD:ALL\" >> /etc/sudoers",
              "mkdir -p /home/user/workspace",
              "chown -R user:user /home/user"
            ]
          }
        },
        {
          "type": "workdir",
          "args": { "path": "/home/user/workspace" }
        }
      ]
    }
  }' | while IFS= read -r line; do
    # Parse SSE events
    if [[ "$line" == data:* ]]; then
      echo "${line#data: }"
    fi
  done

echo ""
echo "=== Done! Snapshot 'claude-code-agent' should now be available ==="
