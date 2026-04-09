#!/usr/bin/env node

/**
 * Test script for Oshu SDK
 * 
 * Usage:
 * 1. Create an API key in your Oshu dashboard
 * 2. Set the API_KEY environment variable
 * 3. Run: node test-sdk.mjs
 */

import { Oshu } from '@opencomputer/agents-sdk';

const API_KEY = process.env.API_KEY;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

if (!API_KEY) {
  console.error('❌ Please set the API_KEY environment variable');
  console.error('   Example: API_KEY=flt_your_key_here node test-sdk.mjs');
  process.exit(1);
}

async function testSDK() {
  console.log('🚀 Testing Oshu SDK...\n');
  
  try {
    // Create client
    const oshu = new Oshu({ 
      apiKey: API_KEY,
      baseUrl: BASE_URL 
    });
    
    console.log('📡 Connecting to Oshu...');
    await oshu.connect();
    console.log('✅ Connected!\n');
    
    // List agents
    console.log('📋 Listing agents...');
    const agents = await oshu.agents.list();
    console.log(`Found ${agents.length} agents:`);
    
    if (agents.length === 0) {
      console.log('❌ No agents found. Please create an agent first in the UI.');
      await oshu.disconnect();
      return;
    }
    
    agents.forEach((agent, i) => {
      console.log(`  ${i + 1}. ${agent.name} (${agent.id})`);
      console.log(`     Type: ${agent.type}, Provider: ${agent.provider}`);
      console.log(`     API Enabled: ${agent.apiEnabled}`);
      if (agent.outputSchema) {
        console.log(`     Output Schema: ${JSON.stringify(agent.outputSchema, null, 2)}`);
      }
    });
    
    // Find an API-enabled agent
    const apiAgent = agents.find(a => a.apiEnabled);
    if (!apiAgent) {
      console.log('\n❌ No API-enabled agents found. Please enable API access for an agent.');
      await oshu.disconnect();
      return;
    }
    
    console.log(`\n🤖 Testing with agent: ${apiAgent.name}`);
    
    // Test simple run
    console.log('\n📤 Running simple task...');
    try {
      const result = await oshu.agents.run(apiAgent.id, {
        prompt: 'Say hello and tell me what you can do. Keep it brief.',
        timeout: 30000 // 30 seconds
      });
      
      console.log('✅ Task completed!');
      console.log('📄 Result:', result.result?.slice(0, 200) + (result.result?.length > 200 ? '...' : ''));
      
      if (result.output) {
        console.log('📊 Structured Output:', JSON.stringify(result.output, null, 2));
      }
    } catch (error) {
      console.error('❌ Task failed:', error.message);
    }
    
    // Test streaming task
    console.log('\n🌊 Testing streaming task...');
    try {
      const task = await oshu.agents.submit(apiAgent.id, {
        prompt: 'Count from 1 to 5, explaining each number.',
        timeout: 30000
      });
      
      console.log(`📋 Task submitted: ${task.id}`);
      
      // Set up event listeners
      task.on('stdout', (data) => {
        process.stdout.write(data);
      });
      
      task.on('tool_start', (tool, input) => {
        console.log(`\n🔧 Using tool: ${tool}`);
      });
      
      task.on('tool_end', (tool, output, duration) => {
        console.log(`\n✅ Tool ${tool} completed in ${duration}ms`);
      });
      
      task.on('status', (status) => {
        console.log(`\n📊 Status: ${status}`);
      });
      
      // Wait for result
      const streamResult = await task.result();
      console.log('\n✅ Streaming task completed!');
      
      if (streamResult.output) {
        console.log('📊 Structured Output:', JSON.stringify(streamResult.output, null, 2));
      }
      
    } catch (error) {
      console.error('❌ Streaming task failed:', error.message);
    }
    
    // Test cancellation
    console.log('\n🛑 Testing task cancellation...');
    try {
      const cancelTask = await oshu.agents.submit(apiAgent.id, {
        prompt: 'This is a test task that will be cancelled. Please wait 10 seconds before responding.',
        timeout: 60000
      });
      
      console.log(`📋 Task submitted: ${cancelTask.id}`);
      
      // Cancel after 2 seconds
      setTimeout(async () => {
        console.log('🛑 Cancelling task...');
        await cancelTask.cancel();
      }, 2000);
      
      try {
        await cancelTask.result();
        console.log('❌ Task should have been cancelled');
      } catch (error) {
        if (error.name === 'TaskCancelledError') {
          console.log('✅ Task successfully cancelled');
        } else {
          console.error('❌ Unexpected error:', error.message);
        }
      }
      
    } catch (error) {
      console.error('❌ Cancellation test failed:', error.message);
    }
    
    console.log('\n🔌 Disconnecting...');
    await oshu.disconnect();
    console.log('✅ SDK test completed!');
    
  } catch (error) {
    console.error('❌ SDK test failed:', error);
    process.exit(1);
  }
}

// Run the test
testSDK().catch(console.error);