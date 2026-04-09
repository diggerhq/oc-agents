/**
 * SDK Session Isolation Example
 * 
 * This example demonstrates how to use isolated SDK sessions for sandbox separation.
 * Each session gets its own sandbox, so multiple users/processes can work with
 * the same agent without interfering with each other.
 */

import Oshu from 'oshu';

const API_KEY = process.env.OSHU_API_KEY || 'flt_your_api_key_here';
const BASE_URL = process.env.OSHU_BASE_URL || 'http://localhost:3000';
const AGENT_ID = process.env.OSHU_AGENT_ID;

async function main() {
  if (!AGENT_ID) {
    console.error('Please set OSHU_AGENT_ID environment variable');
    process.exit(1);
  }

  // Initialize the SDK
  const oshu = new Oshu({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
  });

  try {
    // Connect to WebSocket for real-time updates
    await oshu.connect();
    console.log('✅ Connected to Oshu\n');

    // ========================================
    // Example 1: Create an isolated session
    // ========================================
    console.log('📦 Creating isolated session...');
    const session = await oshu.agents.new(AGENT_ID);
    console.log(`   Session ID: ${session.id}`);
    console.log(`   Agent ID: ${session.agentId}`);
    console.log(`   Status: ${session.status}`);
    console.log('');

    // ========================================
    // Example 2: Run tasks in the session
    // ========================================
    console.log('🚀 Running task in isolated session...');
    const result1 = await oshu.agents.run(AGENT_ID, {
      prompt: 'Create a file called hello.txt with the text "Hello from session 1"',
      sessionId: session.id,
      timeout: 120,
    });
    console.log(`   Task completed: ${result1.status}`);
    console.log(`   Result preview: ${result1.result?.slice(0, 200)}...`);
    console.log('');

    // Run another task in the same session (same sandbox)
    console.log('🔄 Running second task in same session...');
    const result2 = await oshu.agents.run(AGENT_ID, {
      prompt: 'List the files in the current directory and show the contents of hello.txt',
      sessionId: session.id,
      timeout: 120,
    });
    console.log(`   Task completed: ${result2.status}`);
    console.log(`   Result preview: ${result2.result?.slice(0, 300)}...`);
    console.log('');

    // ========================================
    // Example 3: Close the session
    // ========================================
    console.log('🧹 Closing session...');
    const closeResult = await oshu.agents.close(AGENT_ID, session.id);
    console.log(`   Closed: ${closeResult.success}`);
    console.log('');

    // ========================================
    // Example 4: Using provision for auto-session
    // ========================================
    console.log('⚡ Running task with auto-provisioned session...');
    const handle = await oshu.agents.submit(AGENT_ID, {
      prompt: 'Echo "This task auto-created its own isolated session"',
      provision: true,  // Automatically create a new session
      timeout: 120,
    });
    
    console.log(`   Task ID: ${handle.id}`);
    console.log(`   Session ID: ${handle.sessionId || 'auto-created'}`);
    
    const result3 = await handle.result();
    console.log(`   Result: ${result3.result?.slice(0, 200)}...`);
    
    // Close the auto-provisioned session if we got one
    if (handle.sessionId) {
      await oshu.agents.close(AGENT_ID, handle.sessionId);
      console.log(`   Cleaned up session: ${handle.sessionId}`);
    }
    console.log('');

    console.log('✨ All examples completed successfully!');

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    // Always disconnect when done
    await oshu.disconnect();
  }
}

main();
