import { Oshu } from '@opencomputer/agents-sdk';

async function main() {
  // Initialize the Oshu client
  const oshu = new Oshu({
    apiKey: process.env.OSHU_API_KEY || 'flt_GkBRHUPABVyy2bbkk-0KHxI73Z8cByN2',
    baseUrl: 'http://localhost:3000'  // Your local server
  });

  try {
    // Connect to the WebSocket
    console.log('🔌 Connecting to Oshu...');
    await oshu.connect();
    console.log('✅ Connected!');

    // List available agents
    console.log('📋 Getting agents...');
    const agents = await oshu.agents.list();
    console.log(`Found ${agents.length} agents:`);
    agents.forEach(agent => {
      console.log(`  - ${agent.name} (${agent.id})`);
    });

    if (agents.length === 0) {
      console.log('❌ No agents found. Make sure you have agents configured.');
      return;
    }

    // Use the first available agent
    const agent = agents[0];
    console.log(`🤖 Using agent: ${agent.name}`);

    // Simple run - wait for completion
    console.log('📤 Running simple task...');
    const result = await oshu.agents.run(agent.id, {
      prompt: 'Say hello and tell me what you can do!',
      timeout: 60  // 60 seconds timeout
    });
    console.log('✅ Task completed!');
    console.log('📄 Result:', result.output);

    // Advanced streaming example
    console.log('\n🌊 Testing streaming task...');
    const task = await oshu.agents.submit(agent.id, {
      prompt: 'Count to 5 slowly, with a pause between each number'
    });
    
    console.log(`📋 Task submitted: ${task.id}`);

    // Listen for real-time updates
    task.on('stdout', (data) => {
      console.log('📝 Output:', data.trim());
    });

    task.on('status', (status) => {
      console.log(`📊 Status: ${status}`);
    });

    // Wait for completion
    const streamingResult = await task.result();
    console.log('✅ Streaming task completed!');
    console.log('📄 Final result:', streamingResult.output);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    // Clean up
    console.log('🔌 Disconnecting...');
    await oshu.disconnect();
    console.log('✅ Example completed!');
  }
}

main().catch(console.error);