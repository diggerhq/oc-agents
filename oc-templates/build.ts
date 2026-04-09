import "dotenv/config";

import { TEMPLATES, type TemplateSpec } from "./manifest.ts";
import { buildClaudeCodeSnapshot } from "./templates/claude-code.ts";
import { buildOpenCodeSnapshot } from "./templates/opencode.ts";

const API_KEY = process.env.OPENCOMPUTER_API_KEY;
if (!API_KEY) {
  console.error("Error: OPENCOMPUTER_API_KEY not set. Add it to .env or export it.");
  process.exit(1);
}

async function buildSnapshot(spec: TemplateSpec): Promise<void> {
  switch (spec.name) {
    case "claude-code":
      return buildClaudeCodeSnapshot(API_KEY!);
    case "opencode":
      return buildOpenCodeSnapshot(API_KEY!);
    default:
      throw new Error(`Unknown template: ${spec.name}`);
  }
}

async function main() {
  const [, , maybeTemplateName] = process.argv;

  const specs = maybeTemplateName
    ? TEMPLATES.filter(t => t.name === maybeTemplateName)
    : TEMPLATES;

  if (specs.length === 0) {
    console.error(`No templates match: ${maybeTemplateName}`);
    console.error("Available templates:", TEMPLATES.map(t => t.name).join(", "));
    process.exit(1);
  }

  const results: { name: string; alias: string; success: boolean; error?: string }[] = [];

  for (const spec of specs) {
    console.log(`\n${"=".repeat(50)}`);
    console.log(`Building ${spec.alias}`);
    console.log(`Description: ${spec.description}`);
    console.log("=".repeat(50));

    try {
      await buildSnapshot(spec);
      console.log(`\n✅ Successfully built: ${spec.alias}`);
      results.push({ name: spec.name, alias: spec.alias, success: true });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`\n❌ Failed to build ${spec.alias}: ${error}`);
      results.push({ name: spec.name, alias: spec.alias, success: false, error });
    }
  }

  // Summary
  console.log(`\n${"=".repeat(50)}`);
  console.log("BUILD SUMMARY");
  console.log("=".repeat(50));

  for (const result of results) {
    if (result.success) {
      console.log(`✅ ${result.name}: ${result.alias}`);
    } else {
      console.log(`❌ ${result.name}: ${result.error}`);
    }
  }

  const successful = results.filter(r => r.success);
  if (successful.length > 0) {
    console.log(`\nSnapshots are ready. backend/.env should have:`);
    for (const result of successful) {
      const envKey = `OPENCOMPUTER_SNAPSHOT_${result.name.toUpperCase().replace(/-/g, "_")}`;
      console.log(`${envKey}=${result.alias}`);
    }
  }

  if (results.some(r => !r.success)) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
