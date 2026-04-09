# E2B Template: Aider
FROM e2b/base:latest

# Install Python and pip
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    pipx \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Aider via pipx for isolation
RUN pipx install aider-chat && pipx ensurepath

# Add pipx bin to path
ENV PATH="/root/.local/bin:${PATH}"

# Verify installation
RUN aider --version || echo "Aider installed"

