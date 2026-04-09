#!/usr/bin/env node

/**
 * Debug SDK test - just try to submit one task
 */

import { Oshu } from '@opencomputer/agents-sdk';

const API_KEY = process.env.API_KEY || 'flt_GkBRHUPABVyy2bbkk-0KHxI73Z8cByN2';
const BASE_URL = 'http://localhost:3000';

async function debugTest() {
  console.log('🚀 Debug test - submitting one task...\n');
  
  try {
    const oshu = new Oshu({ 
      apiKey: API_KEY,
      baseUrl: BASE_URL 
    });
    
    console.log('📡 Connecting...');
    await oshu.connect();
    console.log('✅ Connected!\n');
    
    console.log('📋 Getting agents...');
    const agents = await oshu.agents.list();
    const agent = agents.find(a => a.apiEnabled);
    
    if (!agent) {
      console.log('❌ No API-enabled agents found');
      return;
    }
    
    console.log(`🤖 Using agent: ${agent.name} (${agent.id})\n`);
    
    console.log('📤 Submitting task...');
    try {
      const task = await oshu.agents.submit(agent.id, {
        prompt: 'Just say hello',
        timeout: 10000
      });
      
      console.log(`✅ Task submitted: ${task.id}`);
      
      // Try to get result
      console.log('⏳ Waiting for result...');
      const result = await task.result();
      console.log('✅ Got result:', result.result?.slice(0, 100));
      
    } catch (error) {
      console.error('❌ Task submission failed:', error.message);
      console.error('Error details:', error);
    }
    
    await oshu.disconnect();
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

debugTest();