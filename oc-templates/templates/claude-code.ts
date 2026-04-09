import { Snapshots, Image } from "@opencomputer/sdk/node";

/**
 * Build a Claude Code agent snapshot using the declarative Image builder.
 * The server builds the image, checkpoints it, and stores it as a named snapshot.
 */
export async function buildClaudeCodeSnapshot(apiKey: string): Promise<void> {
  const snapshots = new Snapshots({ apiKey });

  const image = Image.base()
    // Install system deps + Node.js 20 + Claude Code + Python libs (all as root via sudo)
    .runCommands(
      "sudo apt-get update && sudo apt-get install -y curl wget git ripgrep fzf ca-certificates gnupg sudo python3 python3-pip unzip jq",
      "curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -",
      "sudo apt-get install -y nodejs",
      "sudo npm install -g @anthropic-ai/claude-code",
      "sudo pip3 install python-pptx openpyxl python-docx",
      "sudo useradd -m -s /bin/bash user || true",
      'echo "user ALL=(ALL) NOPASSWD:ALL" | sudo tee -a /etc/sudoers',
      "sudo mkdir -p /home/user/workspace",
      "sudo chown -R user:user /home/user",
    )
    .workdir("/home/user/workspace");

  console.log("Building snapshot: claude-code-agent (this may take a few minutes)...");

  await snapshots.create({
    name: "claude-code-agent",
    image,
    onBuildLogs: (log: string) => console.log(`  build: ${log}`),
  });

  console.log("Snapshot 'claude-code-agent' created successfully.");
}
