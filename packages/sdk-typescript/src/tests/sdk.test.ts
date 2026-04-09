/**
 * OpenComputer Agents SDK Test Suite
 * 
 * Run with: npx tsx src/tests/sdk.test.ts
 * 
 * Environment variables:
 *   OC_API_KEY - Your API key (default: flt_test_key)
 *   OC_BASE_URL - API base URL (default: http://localhost:3000)
 *   OC_AGENT_ID - Agent ID to test with (required)
 */

import { OCAgents } from '../client.js';
import type { SdkSession } from '../types.js';

const API_KEY = process.env.OC_API_KEY || 'flt_test_key';
const BASE_URL = process.env.OC_BASE_URL || 'http://localhost:3000';
const AGENT_ID = process.env.OC_AGENT_ID;

// Simple test framework
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertDefined<T>(value: T | undefined | null, message: string): asserts value is T {
  if (value === undefined || value === null) {
    throw new Error(`${message}: value is ${value}`);
  }
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failed++;
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.log(`  ❌ ${name}`);
    console.log(`     Error: ${errorMsg}`);
  }
}

// Test Suite
async function runTests(): Promise<void> {
  if (!AGENT_ID) {
    console.error('❌ OC_AGENT_ID environment variable is required');
    process.exit(1);
  }

  console.log('\n🧪 OpenComputer Agents SDK Test Suite\n');
  console.log(`   API URL: ${BASE_URL}`);
  console.log(`   Agent ID: ${AGENT_ID}\n`);

  const client = new OCAgents({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
  });

  let testSession: SdkSession | null = null;

  try {
    // Connect
    console.log('📡 Connecting to WebSocket...');
    await client.connect();
    console.log('   Connected!\n');

    console.log('─'.repeat(50));
    console.log('Session Management Tests');
    console.log('─'.repeat(50));

    await test('Create SDK session', async () => {
      testSession = await client.agents.new(AGENT_ID);
      assertDefined(testSession.id, 'Session ID should be defined');
      assertEqual(testSession.agentId, AGENT_ID, 'Agent ID should match');
      assertEqual(testSession.status, 'active', 'Session status should be active');
    });

    await test('Session has valid properties', async () => {
      assertDefined(testSession, 'Session should exist');
      assertDefined(testSession.id, 'Session ID should be defined');
      assert(testSession.id.length > 0, 'Session ID should not be empty');
      assertDefined(testSession.createdAt, 'Created at should be defined');
    });

    console.log('\n' + '─'.repeat(50));
    console.log('Task Execution Tests');
    console.log('─'.repeat(50));

    await test('Run task in session', async () => {
      assertDefined(testSession, 'Session should exist');
      
      const result = await client.agents.run(AGENT_ID, {
        prompt: 'Echo "test123" to stdout',
        sessionId: testSession.id,
        timeout: 60,
      });
      
      assertEqual(result.status, 'completed', 'Task should complete');
      assertDefined(result.result, 'Result should be defined');
    });

    await test('Submit task with streaming', async () => {
      assertDefined(testSession, 'Session should exist');
      
      const handle = await client.agents.submit(AGENT_ID, {
        prompt: 'Print "streaming works"',
        sessionId: testSession.id,
      });
      
      assertDefined(handle.id, 'Task ID should be defined');
      
      // Wait for result
      const result = await handle.result();
      assertEqual(result.status, 'completed', 'Task should complete');
    });

    await test('Tasks in same session share state', async () => {
      assertDefined(testSession, 'Session should exist');
      
      // Create a file
      await client.agents.run(AGENT_ID, {
        prompt: 'Create a file named sdk_test_file.txt with content "state test"',
        sessionId: testSession.id,
        timeout: 60,
      });
      
      // Verify file exists in same session
      const result = await client.agents.run(AGENT_ID, {
        prompt: 'Cat the file sdk_test_file.txt and output its contents',
        sessionId: testSession.id,
        timeout: 60,
      });
      
      assertEqual(result.status, 'completed', 'Task should complete');
      assert(
        (result.result?.includes('state test') || result.result?.includes('sdk_test_file')) ?? false,
        'Should be able to see file from previous task'
      );
    });

    console.log('\n' + '─'.repeat(50));
    console.log('Session Isolation Tests');
    console.log('─'.repeat(50));

    let session2: SdkSession | null = null;

    await test('Create second isolated session', async () => {
      session2 = await client.agents.new(AGENT_ID);
      assertDefined(session2.id, 'Session 2 ID should be defined');
      assert(session2.id !== testSession?.id, 'Session IDs should be different');
    });

    await test('Sessions are isolated (no shared files)', async () => {
      assertDefined(session2, 'Session 2 should exist');
      
      // Try to read file from session 1 in session 2
      const result = await client.agents.run(AGENT_ID, {
        prompt: 'Check if sdk_test_file.txt exists and report yes or no',
        sessionId: session2.id,
        timeout: 60,
      });
      
      assertEqual(result.status, 'completed', 'Task should complete');
      // File should NOT exist in session 2 (isolation)
      assert(
        !result.result?.toLowerCase().includes('state test'),
        'Session 2 should NOT see files from Session 1 (isolation)'
      );
    });

    await test('Close second session', async () => {
      assertDefined(session2, 'Session 2 should exist');
      const closeResult = await client.agents.close(AGENT_ID, session2.id);
      assert(closeResult.success, 'Session close should succeed');
    });

    console.log('\n' + '─'.repeat(50));
    console.log('Provision (Auto-Session) Tests');
    console.log('─'.repeat(50));

    let provisionedSessionId: string | undefined;

    await test('Task with provision creates session', async () => {
      const handle = await client.agents.submit(AGENT_ID, {
        prompt: 'Echo "provisioned"',
        provision: true,
      });
      
      assertDefined(handle.id, 'Task ID should be defined');
      // Session ID may come from the task_created event
      provisionedSessionId = handle.sessionId;
      
      const result = await handle.result();
      assertEqual(result.status, 'completed', 'Task should complete');
    });

    await test('Clean up provisioned session', async () => {
      if (provisionedSessionId) {
        const closeResult = await client.agents.close(AGENT_ID, provisionedSessionId);
        assert(closeResult.success, 'Provisioned session close should succeed');
      }
    });

    console.log('\n' + '─'.repeat(50));
    console.log('Cleanup');
    console.log('─'.repeat(50));

    await test('Close original test session', async () => {
      assertDefined(testSession, 'Session should exist');
      const closeResult = await client.agents.close(AGENT_ID, testSession.id);
      assert(closeResult.success, 'Session close should succeed');
    });

  } catch (error) {
    console.error('Fatal error:', error);
    failed++;
  } finally {
    client.disconnect();
  }

  // Summary
  console.log('\n' + '═'.repeat(50));
  console.log('Test Results');
  console.log('═'.repeat(50));
  console.log(`  Total:  ${passed + failed}`);
  console.log(`  Passed: ${passed} ✅`);
  console.log(`  Failed: ${failed} ❌`);
  console.log('═'.repeat(50) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
