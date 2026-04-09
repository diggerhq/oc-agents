import { Snapshots, Image } from "@opencomputer/sdk/node";

/**
 * Build an OpenCode agent snapshot using the declarative Image builder.
 * The server builds the image, checkpoints it, and stores it as a named snapshot.
 */
export async function buildOpenCodeSnapshot(apiKey: string): Promise<void> {
  const snapshots = new Snapshots({ apiKey });

  const image = Image.base()
    .runCommands(
      "sudo apt-get update && sudo apt-get install -y git ripgrep fzf curl wget",
    )
    .runCommands(
      // Install OpenCode from pre-built .deb (compiling from source OOMs the sandbox)
      "wget -q -O /tmp/opencode.deb https://github.com/opencode-ai/opencode/releases/download/v0.0.55/opencode-linux-amd64.deb && sudo dpkg -i /tmp/opencode.deb && rm /tmp/opencode.deb",
      "sudo mkdir -p /home/user/workspace",
    )
    .workdir("/home/user/workspace");

  console.log("Building snapshot: opencode-agent (this may take a few minutes)...");

  await snapshots.create({
    name: "opencode-agent",
    image,
    onBuildLogs: (log: string) => console.log(`  build: ${log}`),
  });

  console.log("Snapshot 'opencode-agent' created successfully.");
}
