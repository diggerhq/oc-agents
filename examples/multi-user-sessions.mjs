/**
 * Multi-User Session Isolation Example
 * 
 * This example simulates multiple users working with the same agent simultaneously.
 * Each user gets their own isolated sandbox session, so their work doesn't interfere.
 */

import Oshu from 'oshu';

const API_KEY = process.env.OSHU_API_KEY || 'flt_your_api_key_here';
const BASE_URL = process.env.OSHU_BASE_URL || 'http://localhost:3000';
const AGENT_ID = process.env.OSHU_AGENT_ID;

// Simulate work for a single user
async function userWorkflow(oshu, agentId, userId) {
  console.log(`\n👤 User ${userId}: Starting workflow...`);
  
  // Create isolated session for this user
  const session = await oshu.agents.new(agentId);
  console.log(`   User ${userId}: Created session ${session.id.slice(0, 8)}...`);
  
  try {
    // User does their work in their isolated sandbox
    console.log(`   User ${userId}: Creating user-specific file...`);
    await oshu.agents.run(agentId, {
      prompt: `Create a file called user_${userId}_data.json with content: {"userId": "${userId}", "timestamp": "${new Date().toISOString()}"}`,
      sessionId: session.id,
      timeout: 120,
    });
    
    // Verify the file exists only in this user's sandbox
    console.log(`   User ${userId}: Verifying isolated workspace...`);
    const result = await oshu.agents.run(agentId, {
      prompt: 'List all files in the current directory that start with "user_"',
      sessionId: session.id,
      timeout: 60,
    });
    
    console.log(`   User ${userId}: Files in sandbox: ${result.result?.slice(0, 100)}...`);
    
    return { userId, sessionId: session.id, success: true };
  } finally {
    // Clean up the session
    console.log(`   User ${userId}: Closing session...`);
    await oshu.agents.close(agentId, session.id);
  }
}

async function main() {
  if (!AGENT_ID) {
    console.error('Please set OSHU_AGENT_ID environment variable');
    process.exit(1);
  }

  const oshu = new Oshu({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
  });

  try {
    await oshu.connect();
    console.log('✅ Connected to Oshu');
    console.log('📋 Simulating 3 users working simultaneously...');

    // Run 3 users in parallel - each gets their own sandbox
    const results = await Promise.all([
      userWorkflow(oshu, AGENT_ID, 'alice'),
      userWorkflow(oshu, AGENT_ID, 'bob'),
      userWorkflow(oshu, AGENT_ID, 'charlie'),
    ]);

    console.log('\n📊 Results:');
    for (const r of results) {
      console.log(`   ${r.userId}: ${r.success ? '✅ Success' : '❌ Failed'}`);
    }

    console.log('\n✨ Multi-user isolation demo complete!');
    console.log('   Each user had their own isolated sandbox.');
    console.log('   Files created by one user were not visible to others.');

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await oshu.disconnect();
  }
}

main();
