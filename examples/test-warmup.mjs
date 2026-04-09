#!/usr/bin/env node

/**
 * Quick test for the warmup functionality
 */

import { Oshu } from '../packages/sdk-typescript/dist/index.js';

const oshu = new Oshu({
  apiKey: 'flt_GkBRHUPABVyy2bbkk-0KHxI73Z8cByN2',
  baseUrl: 'http://localhost:3000'
});

async function test() {
  try {
    console.log('🔌 Connecting...');
    await oshu.connect();
    
    console.log('📋 Getting agents...');
    const agents = await oshu.agents.list();
    
    if (agents.length === 0) {
      console.log('❌ No agents found');
      return;
    }
    
    const agent = agents[0];
    console.log(`✅ Testing with agent: ${agent.name}`);
    
    console.log('🔥 Testing warmup...');
    const result = await oshu.agents.warmup(agent.id);
    
    if (result.success) {
      console.log(`✅ Warmup successful! Sandbox: ${result.sandboxId}`);
    } else {
      console.log(`❌ Warmup failed: ${result.error}`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await oshu.disconnect();
  }
}

test().catch(console.error);