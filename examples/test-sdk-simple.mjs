#!/usr/bin/env node

/**
 * Simple SDK test - connect, list agents, run a prompt
 */

import { OCAgents } from '../packages/sdk-typescript/dist/index.js';

const API_KEY = process.env.API_KEY || 'flt_mTk8p8ov97g9xPYALhN82J2dq4G7X6g4';
const BASE_URL = 'http://localhost:3000';

async function main() {
  console.log('Testing OpenComputer Agents SDK...\n');

  const client = new OCAgents({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
  });

  console.log('Connecting...');
  await client.connect();
  console.log('Connected!\n');

  // List agents
  console.log('Listing agents...');
  const agents = await client.agents.list();
  console.log(`Found ${agents.length} agent(s)\n`);

  agents.forEach((agent, i) => {
    console.log(`${i + 1}. ${agent.name} (${agent.id})`);
    console.log(`   Type: ${agent.type}, Provider: ${agent.provider}`);
    console.log(`   API Enabled: ${agent.apiEnabled ? 'yes' : 'no'}`);
  });

  // Run a prompt on the first agent that has API enabled
  const target = agents.find(a => a.apiEnabled);
  if (target) {
    console.log(`\nRunning prompt on "${target.name}"...`);
    const task = await client.agents.submit(target.id, {
      prompt: 'Say hello and tell me what you can do in one sentence.',
      timeout: 120,
    });

    task.on('stdout', (data) => process.stdout.write(data));
    task.on('status', (status) => console.log(`\n[status: ${status}]`));

    const result = await task.result();
    console.log(`\n\nResult: ${result.result?.slice(0, 200)}`);
    console.log(`Status: ${result.status}`);
  } else {
    console.log('\nNo agents with API enabled. Enable API on an agent in the UI (Configure tab) to test prompts.');
  }

  client.disconnect();
  console.log('\nDone!');
}

main().catch(err => {
  console.error('Error:', err.message);
  if (err.code === 'AUTHENTICATION_ERROR') {
    console.error('\nSet a valid API key: API_KEY=flt_xxx node test-sdk-simple.mjs');
  }
  process.exit(1);
});
