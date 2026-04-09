# E2B Template: Claude Code
FROM ubuntu:22.04

# Avoid interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install base dependencies
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    ca-certificates \
    gnupg \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# Create user (E2B expects 'user' with sudo access)
RUN useradd -m -s /bin/bash user && \
    echo "user ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Install Claude Code CLI globally (pinned to 2.0.76 - version that outputs thinking blocks)
RUN npm install -g @anthropic-ai/claude-code@2.0.76

# Install useful tools
RUN apt-get update && apt-get install -y \
    git \
    ripgrep \
    fzf \
    python3 \
    python3-pip \
    unzip \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Install Python libraries for document generation
RUN pip3 install python-pptx openpyxl python-docx

# Set up workspace directory
RUN mkdir -p /home/user/workspace && chown -R user:user /home/user

# Switch to user
USER user
WORKDIR /home/user/workspace

# Verify installation
RUN claude --version || echo "Claude Code installed"

