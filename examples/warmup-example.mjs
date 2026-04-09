#!/usr/bin/env node

/**
 * Oshu SDK - Sandbox Warmup Example
 * 
 * This example demonstrates how to warm up sandboxes for faster first-request performance.
 * Warming up creates the sandbox and installs tools ahead of time.
 */

import { Oshu } from '@opencomputer/agents-sdk';

const oshu = new Oshu({
  apiKey: 'flt_GkBRHUPABVyy2bbkk-0KHxI73Z8cByN2',
  baseUrl: 'http://localhost:3000'
});

async function main() {
  try {
    console.log('🔌 Connecting to Oshu...');
    await oshu.connect();
    
    console.log('📋 Getting available agents...');
    const agents = await oshu.agents.list();
    
    if (agents.length === 0) {
      console.log('❌ No agents found. Create an agent first.');
      return;
    }
    
    const agent = agents[0];
    console.log(`✅ Found agent: ${agent.name} (${agent.id})`);
    
    // Example 1: Warm up a single agent
    console.log('\n🔥 Warming up sandbox...');
    const warmupResult = await oshu.agents.warmup(agent.id);
    
    if (warmupResult.success) {
      console.log(`✅ Sandbox warmed up successfully!`);
      console.log(`   Sandbox ID: ${warmupResult.sandboxId}`);
      console.log(`   Status: ${warmupResult.status}`);
      
      if (warmupResult.status === 'extended') {
        console.log(`   ℹ️  Sandbox was already warm, lifetime was extended`);
      } else {
        console.log(`   ℹ️  New sandbox was created`);
      }
    } else {
      console.log(`❌ Warmup failed: ${warmupResult.error}`);
    }
    
    // Example 1b: Call warmup again to see 'extended' status
    console.log('\n🔥 Calling warmup again (should show "extended" status)...');
    const warmupResult2 = await oshu.agents.warmup(agent.id);
    
    if (warmupResult2.success) {
      console.log(`✅ Sandbox status: ${warmupResult2.status}`);
      if (warmupResult2.status === 'extended') {
        console.log(`   ✓ Sandbox was already warm - safe to use concurrently!`);
      }
    }
    
    // Example 2: Test performance difference
    console.log('\n⏱️  Testing performance...');
    
    // First request (should be fast since warmed up)
    console.log('Making first request (warmed sandbox)...');
    const start1 = Date.now();
    const result1 = await oshu.agents.run(agent.id, {
      prompt: 'Say hello and tell me the current time',
      timeout: 60
    });
    const duration1 = Date.now() - start1;
    console.log(`✅ First request completed in ${duration1}ms`);
    console.log(`   Response: ${result1.result.substring(0, 100)}...`);
    
    // Wait a bit, then make another request
    console.log('\nWaiting 5 seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log('Making second request...');
    const start2 = Date.now();
    const result2 = await oshu.agents.run(agent.id, {
      prompt: 'List the files in the current directory',
      timeout: 60
    });
    const duration2 = Date.now() - start2;
    console.log(`✅ Second request completed in ${duration2}ms`);
    console.log(`   Response: ${result2.result.substring(0, 100)}...`);
    
    // Example 3: Warm up multiple agents
    if (agents.length > 1) {
      console.log('\n🔥 Warming up multiple agents...');
      const agentIds = agents.slice(0, Math.min(3, agents.length)).map(a => a.id);
      
      const multiWarmupResult = await oshu.agents.warmupMultiple(agentIds);
      
      console.log(`✅ Bulk warmup completed: ${multiWarmupResult.success}`);
      multiWarmupResult.results.forEach(result => {
        const agent = agents.find(a => a.id === result.agentId);
        const status = result.success ? '✅' : '❌';
        console.log(`   ${status} ${agent?.name || result.agentId}: ${result.success ? result.sandboxId : result.error}`);
      });
    }
    
    console.log('\n🎯 Warmup examples completed!');
    console.log('\n💡 Tips:');
    console.log('   - Warm up agents before peak usage periods');
    console.log('   - Sandboxes stay warm for ~30 minutes of inactivity');
    console.log('   - Use warmupMultiple() for batch operations');
    console.log('   - Warmup is idempotent - safe to call multiple times');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await oshu.disconnect();
  }
}

main().catch(console.error);