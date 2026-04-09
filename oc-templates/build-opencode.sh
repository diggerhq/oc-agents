#!/bin/bash
set -e

# Build OpenCode agent snapshot on OpenComputer
# Usage: ./build-opencode.sh

API_KEY="${OPENCOMPUTER_API_KEY:-}"
API_URL="https://app.opencomputer.dev/api"

if [ -z "$API_KEY" ]; then
  if [ -f "../backend/.env" ]; then
    API_KEY=$(grep OPENCOMPUTER_API_KEY ../backend/.env | cut -d= -f2)
  fi
fi

if [ -z "$API_KEY" ]; then
  echo "Error: OPENCOMPUTER_API_KEY not set"
  exit 1
fi

echo "=== Building OpenCode Agent Snapshot ==="

echo "Sending snapshot build request..."
curl -s -X POST "$API_URL/snapshots" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "name": "opencode-agent",
    "image": {
      "base": "default",
      "steps": [
        {
          "type": "apt_install",
          "args": {
            "packages": ["git", "ripgrep", "fzf", "curl", "wget", "sudo"]
          }
        },
        {
          "type": "run",
          "args": {
            "commands": [
              "cd /tmp && wget -q -O go.tar.gz https://go.dev/dl/go1.21.5.linux-amd64.tar.gz",
              "tar -C /usr/local -xzf /tmp/go.tar.gz && rm /tmp/go.tar.gz",
              "ln -sf /usr/local/go/bin/go /usr/local/bin/go"
            ]
          }
        },
        {
          "type": "env",
          "args": {
            "vars": { "GOPATH": "/tmp/go", "GOBIN": "/usr/local/bin" }
          }
        },
        {
          "type": "run",
          "args": {
            "commands": ["go install github.com/opencode-ai/opencode@latest"]
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
    if [[ "$line" == data:* ]]; then
      echo "${line#data: }"
    fi
  done

echo ""
echo "=== Done! Snapshot 'opencode-agent' should now be available ==="
