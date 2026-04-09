// Template manifest for agent orchestrator (OpenComputer snapshots)

export interface TemplateSpec {
  name: string;
  alias: string;
  description: string;
}

export const TEMPLATES: TemplateSpec[] = [
  {
    name: "claude-code",
    alias: "claude-code-agent",
    description: "Claude Code CLI for agentic coding",
  },
  {
    name: "opencode",
    alias: "opencode-agent",
    description: "OpenCode open-source coding agent",
  },
];

export function getTemplate(name: string): TemplateSpec | undefined {
  return TEMPLATES.find(t => t.name === name);
}
