# E2B Template: OpenCode
FROM e2b/base:latest

# Install dependencies
RUN apt-get update && apt-get install -y \
    git \
    ripgrep \
    fzf \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Go
RUN curl -fsSL https://go.dev/dl/go1.21.5.linux-amd64.tar.gz | tar -C /usr/local -xzf -
ENV PATH="/usr/local/go/bin:/root/go/bin:${PATH}"
ENV GOPATH="/root/go"

# Install OpenCode
RUN go install github.com/opencode-ai/opencode@latest

# Verify installation
RUN opencode -v || echo "OpenCode installed"

