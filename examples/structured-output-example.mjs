#!/usr/bin/env node

/**
 * Structured Output Example - Oshu SDK
 * 
 * This example demonstrates how to use structured output with the Oshu SDK.
 * First, configure your agent with an output schema in the UI, then run this script.
 */

import { Oshu } from './packages/sdk-typescript/dist/index.js';

const API_KEY = process.env.API_KEY || 'flt_GkBRHUPABVyy2bbkk-0KHxI73Z8cByN2';
const AGENT_ID = process.env.AGENT_ID || '53512233-3f2b-4971-b724-ddfbcc433b78';

async function main() {
  const oshu = new Oshu({
    apiKey: API_KEY,
    baseUrl: 'http://localhost:3000'
  });

  try {
    console.log('🔌 Connecting to Oshu...');
    await oshu.connect();
    console.log('✅ Connected!');

    // Get agent info to check if it has structured output configured
    console.log('📋 Getting agent info...');
    const agents = await oshu.agents.list();
    const agent = agents.find(a => a.id === AGENT_ID);
    
    if (!agent) {
      console.error('❌ Agent not found!');
      return;
    }

    console.log(`🤖 Using agent: ${agent.name}`);
    
    if (agent.outputSchema) {
      console.log('📊 Agent has structured output configured:');
      console.log(JSON.stringify(agent.outputSchema, null, 2));
    } else {
      console.log('⚠️  Agent does not have structured output configured.');
      console.log('   Go to the agent\'s Configure tab > General section > Structured Output Schema');
      console.log('   and add a JSON schema like:');
      console.log(`   {
     "type": "object",
     "properties": {
       "summary": { "type": "string" },
       "status": { "type": "string", "enum": ["success", "error"] },
       "data": { "type": "object" }
     },
     "required": ["summary", "status"]
   }`);
    }

    console.log('\n📤 Running task with structured output...');
    
    const result = await oshu.agents.run(AGENT_ID, {
      prompt: `Analyze the current time and date. Provide a summary of what you found.
      
If you have structured output configured, format your response according to the schema.
Otherwise, just provide a regular text response.`,
      timeout: 60
    });

    console.log('\n✅ Task completed!');
    console.log('\n📄 Raw result:');
    console.log(result.result);

    if (result.output) {
      console.log('\n🎯 Structured output:');
      console.log(JSON.stringify(result.output, null, 2));
      
      // Type-safe access (if you know the schema)
      if (typeof result.output === 'object' && result.output !== null) {
        const typed = result.output as any;
        if (typed.summary) {
          console.log(`\n📝 Summary: ${typed.summary}`);
        }
        if (typed.status) {
          console.log(`📊 Status: ${typed.status}`);
        }
      }
    } else {
      console.log('\n💡 No structured output returned (agent may not have schema configured)');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    console.log('\n🔌 Disconnecting...');
    await oshu.disconnect();
    console.log('✅ Example completed!');
  }
}

main().catch(console.error);