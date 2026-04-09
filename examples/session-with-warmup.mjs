/**
 * Session with Warmup Example
 * 
 * This example shows how to combine session isolation with sandbox warmup
 * for optimal performance. The session is created with warmup=true to
 * pre-provision the sandbox before running tasks.
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

  const oshu = new Oshu({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
  });

  try {
    await oshu.connect();
    console.log('✅ Connected to Oshu\n');

    // ========================================
    // Measure cold start (no warmup)
    // ========================================
    console.log('❄️  Testing cold start (no warmup)...');
    const coldStartTime = Date.now();
    
    const coldSession = await oshu.agents.new(AGENT_ID);
    const coldResult = await oshu.agents.run(AGENT_ID, {
      prompt: 'echo "Hello from cold start"',
      sessionId: coldSession.id,
      timeout: 180,
    });
    
    const coldDuration = Date.now() - coldStartTime;
    console.log(`   Cold start duration: ${coldDuration}ms`);
    await oshu.agents.close(AGENT_ID, coldSession.id);
    console.log('');

    // ========================================
    // Measure with warmup
    // ========================================
    console.log('🔥 Testing with warmup...');
    
    // Step 1: Warmup the agent's sandbox first
    console.log('   Warming up sandbox...');
    const warmupStart = Date.now();
    const warmupResult = await oshu.agents.warmup(AGENT_ID);
    const warmupDuration = Date.now() - warmupStart;
    console.log(`   Warmup completed in ${warmupDuration}ms (status: ${warmupResult.status})`);
    
    // Step 2: Create session and run task (should be faster)
    console.log('   Creating session and running task...');
    const warmStartTime = Date.now();
    
    const warmSession = await oshu.agents.new(AGENT_ID);
    const warmResult = await oshu.agents.run(AGENT_ID, {
      prompt: 'echo "Hello from warm start"',
      sessionId: warmSession.id,
      timeout: 180,
    });
    
    const warmDuration = Date.now() - warmStartTime;
    console.log(`   Warm start duration: ${warmDuration}ms`);
    await oshu.agents.close(AGENT_ID, warmSession.id);
    console.log('');

    // ========================================
    // Summary
    // ========================================
    const improvement = ((coldDuration - warmDuration) / coldDuration * 100).toFixed(1);
    console.log('📊 Performance Summary:');
    console.log(`   Cold start: ${coldDuration}ms`);
    console.log(`   Warm start: ${warmDuration}ms`);
    console.log(`   Improvement: ${improvement}%`);
    console.log('');
    console.log('💡 Tip: Use warmup before user sessions for best experience!');

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await oshu.disconnect();
  }
}

main();
