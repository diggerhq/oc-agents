#!/usr/bin/env node

/**
 * Test the Digger agent on production
 */

import { OCAgents } from '@opencomputer/agents-sdk';

const API_KEY = process.env.API_KEY || 'flt_mTk8p8ov97g9xPYALhN82J2dq4G7X6g4';
const BASE_URL = 'https://agents.opencomputer.dev';
const AGENT_ID = '29dbd27d-f838-4602-a396-04709afd6718';

async function main() {
  console.log('Connecting to OC Agents (production)...\n');

  const client = new OCAgents({ apiKey: API_KEY, baseUrl: BASE_URL });
  await client.connect();
  console.log('Connected!\n');

  // Create an isolated session for a fresh sandbox
  console.log('Creating isolated session...');
  const session = await client.agents.new(AGENT_ID);
  console.log(`Session: ${session.id}\n`);

  const prompt = process.argv[2] || 'Please check the MCP tools you have access to and tell me what you can do with them.';
  console.log(`Prompt: ${prompt}\n`);
  console.log('--- Response ---');

  const task = await client.agents.submit(AGENT_ID, {
    prompt,
    timeout: 120,
    sessionId: session.id,
  });

  let fullOutput = '';
  task.on('stdout', (data) => {
    // Extract text from Claude Code stream_event JSON, skip raw JSON
    try {
      const json = JSON.parse(data);
      if (json.type === 'stream_event' && json.event?.delta?.text) {
        const text = json.event.delta.text;
        fullOutput += text;
        process.stdout.write(text);
      }
      return;
    } catch {}
    // Plain text (opencode or non-JSON output)
    fullOutput += data;
    process.stdout.write(data);
  });
  task.on('stderr', (data) => process.stderr.write(`[stderr] ${data}`));
  task.on('status', (s) => console.log(`\n[status: ${s}]`));
  task.on('tool_start', (info) => console.log(`\n[tool] ${typeof info === 'string' ? info : info.toolName || JSON.stringify(info)}`));

  const result = await task.result();
  console.log(`\n--- Done ---`);
  console.log(`Status: ${result.status}`);
  console.log(`Result length: ${result.result?.length || 0} chars`);
  console.log(`Streamed length: ${fullOutput.length} chars`);

  // If result is shorter than streamed output, print the full version
  if (fullOutput.length > (result.result?.length || 0)) {
    console.log(`\n--- Full streamed output ---`);
    console.log(fullOutput);
  }

  // Clean up session
  await client.agents.close(AGENT_ID, session.id);
  client.disconnect();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
