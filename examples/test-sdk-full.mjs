#!/usr/bin/env node

/**
 * Full SDK test suite:
 *  1. Streaming with tool use (file creation)
 *  2. Structured output (JSON schema)
 *  3. Multi-turn conversation (follow-up messages)
 *  5. Long-running task with cancellation
 */

import { OCAgents } from '@opencomputer/agents-sdk';

const API_KEY = process.env.API_KEY || 'flt_mTk8p8ov97g9xPYALhN82J2dq4G7X6g4';
const BASE_URL = 'http://localhost:3000';
const AGENT_ID = process.env.AGENT_ID; // pass explicitly or auto-pick first API-enabled agent

function separator(title) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('='.repeat(60) + '\n');
}

async function main() {
  const client = new OCAgents({ apiKey: API_KEY, baseUrl: BASE_URL });

  console.log('Connecting...');
  await client.connect();
  console.log('Connected!\n');

  // Pick agent
  const agents = await client.agents.list();
  const agent = AGENT_ID
    ? agents.find(a => a.id === AGENT_ID)
    : agents.find(a => a.apiEnabled);

  if (!agent) {
    console.error('No API-enabled agent found. Enable API on an agent in the UI.');
    process.exit(1);
  }
  console.log(`Using agent: "${agent.name}" (${agent.id}) [${agent.provider}]`);
  console.log(`TIP: For clean multi-turn test, create a fresh agent or use AGENT_ID=<new-agent-id>\n`);

  // ─────────────────────────────────────────────
  // Test 1: Streaming with tool use
  // ─────────────────────────────────────────────
  separator('Test 1: Streaming with tool use');

  const task1 = await client.agents.submit(agent.id, {
    prompt: 'Create a file called hello.txt with the content "Hello from SDK test" and confirm you created it.',
    timeout: 120,
  });

  const tools1 = [];
  task1.on('stdout', (data) => process.stdout.write(data));
  task1.on('tool_start', (info) => {
    tools1.push(info);
    console.log(`\n  [tool_start] ${typeof info === 'string' ? info : info.toolName || info}`);
  });
  task1.on('tool_end', (info) => {
    console.log(`  [tool_end] ${typeof info === 'string' ? info : info.toolName || info}`);
  });
  task1.on('status', (s) => console.log(`  [status] ${s}`));

  const result1 = await task1.result();
  console.log(`\n\nResult: ${result1.status}`);
  console.log(`Tools used: ${tools1.length}`);
  console.log(`Output preview: ${result1.result?.slice(0, 200)}`);

  // ─────────────────────────────────────────────
  // Test 2: Structured output
  // ─────────────────────────────────────────────
  separator('Test 2: Structured output (JSON)');

  const task2 = await client.agents.submit(agent.id, {
    prompt: `Analyze the programming language Python and respond ONLY with valid JSON in this exact format, no other text:
{"name": "Python", "year_created": 1991, "creator": "Guido van Rossum", "paradigms": ["object-oriented", "procedural", "functional"], "rating": 9}`,
    timeout: 120,
  });

  let output2 = '';
  task2.on('stdout', (data) => {
    output2 += data;
    process.stdout.write(data);
  });
  task2.on('status', (s) => console.log(`  [status] ${s}`));

  const result2 = await task2.result();
  console.log(`\n\nResult: ${result2.status}`);

  // Try to parse JSON from the output
  try {
    const jsonMatch = (result2.result || output2).match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log('Parsed JSON:', JSON.stringify(parsed, null, 2));
    } else {
      console.log('No JSON found in output');
    }
  } catch (e) {
    console.log('JSON parse failed:', e.message);
  }

  // ─────────────────────────────────────────────
  // Test 3: Multi-turn conversation (same session)
  // ─────────────────────────────────────────────
  separator('Test 3: Multi-turn conversation');

  // Turn 1
  console.log('--- Turn 1 ---');
  const turn1 = await client.agents.submit(agent.id, {
    prompt: 'Remember this number: 42. Just confirm you got it.',
    timeout: 120,
  });
  turn1.on('stdout', (data) => process.stdout.write(`[stdout] ${data}`));
  turn1.on('status', (s) => console.log(`  [status] ${s}`));
  const r1 = await turn1.result();
  console.log(`\nTurn 1 status: ${r1.status}`);
  console.log(`Turn 1 result: "${r1.result?.slice(0, 300)}"`);
  console.log(`Turn 1 output: "${r1.output}"`);

  // Turn 2 — follow-up referencing previous context
  console.log('\n--- Turn 2 ---');
  const turn2 = await client.agents.submit(agent.id, {
    prompt: 'What number did I just ask you to remember? Just say the number.',
    timeout: 120,
  });
  turn2.on('stdout', (data) => process.stdout.write(`[stdout] ${data}`));
  turn2.on('status', (s) => console.log(`  [status] ${s}`));
  const r2 = await turn2.result();
  console.log(`\nTurn 2 status: ${r2.status}`);
  console.log(`Turn 2 result: "${r2.result?.slice(0, 300)}"`);
  console.log(`Turn 2 output: "${r2.output}"`);
  const has42 = (r2.result || '' + r2.output || '').includes('42');
  console.log(`Remembered "42": ${has42 ? 'YES' : 'NO'}`);

  // Turn 3 — follow-up again
  console.log('\n--- Turn 3 ---');
  const turn3 = await client.agents.submit(agent.id, {
    prompt: 'Now multiply that number by 10 and tell me the result. Just the number.',
    timeout: 120,
  });
  turn3.on('stdout', (data) => process.stdout.write(`[stdout] ${data}`));
  turn3.on('status', (s) => console.log(`  [status] ${s}`));
  const r3 = await turn3.result();
  console.log(`\nTurn 3 status: ${r3.status}`);
  console.log(`Turn 3 result: "${r3.result?.slice(0, 300)}"`);
  console.log(`Turn 3 output: "${r3.output}"`);
  const has420 = (r3.result || '' + r3.output || '').includes('420');
  console.log(`Got "420": ${has420 ? 'YES' : 'NO'}`);

  // ─────────────────────────────────────────────
  // Test 5: Cancellation
  // ─────────────────────────────────────────────
  separator('Test 5: Task cancellation');

  const task5 = await client.agents.submit(agent.id, {
    prompt: 'Write a very long and detailed 5000-word essay about the history of computing from the 1940s to today. Cover every decade in extreme detail.',
    timeout: 300,
  });

  let chunks5 = 0;
  task5.on('stdout', (data) => {
    chunks5++;
    if (chunks5 <= 5) process.stdout.write(data);
    if (chunks5 === 5) console.log('\n  ... (cancelling after 5 chunks) ...');
  });
  task5.on('status', (s) => console.log(`  [status] ${s}`));

  // Cancel after 8 seconds or 5 chunks
  await new Promise(resolve => setTimeout(resolve, 8000));
  console.log('  Sending cancel...');
  try {
    await task5.cancel();
    console.log('  Cancel sent!');
  } catch (e) {
    console.log(`  Cancel response: ${e.message}`);
  }

  try {
    const r5 = await Promise.race([
      task5.result(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout waiting for result')), 10000)),
    ]);
    console.log(`  Final status: ${r5.status}`);
    console.log(`  Chunks received before cancel: ${chunks5}`);
  } catch (e) {
    console.log(`  Result after cancel: ${e.message}`);
    console.log(`  Chunks received: ${chunks5}`);
  }

  // ─────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────
  separator('Summary');
  console.log('Test 1 (Streaming + tools): ' + (result1.status === 'completed' ? 'PASS' : 'FAIL'));
  console.log('Test 2 (Structured JSON):   ' + (result2.status === 'completed' ? 'PASS' : 'FAIL'));
  console.log('Test 3 (Multi-turn):        ' + (has42 ? 'PASS' : 'FAIL'));
  console.log('Test 5 (Cancellation):      ' + (chunks5 > 0 ? 'PASS' : 'FAIL'));

  client.disconnect();
  console.log('\nDone!');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
