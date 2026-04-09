#!/usr/bin/env node

/**
 * Obtuse Schema Test - Oshu SDK
 * 
 * This tests the structured output system with a ridiculously complex schema.
 * Copy the schema from obtuse-schema-example.json into your agent's output schema field.
 */

import { Oshu } from './packages/sdk-typescript/dist/index.js';
import { readFileSync } from 'fs';

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

    // Load the obtuse schema
    const schema = JSON.parse(readFileSync('./examples/obtuse-schema-example.json', 'utf8'));
    console.log('📊 Loaded obtuse schema with', Object.keys(schema.properties).length, 'top-level properties');

    console.log('\n📤 Running obtuse analysis task...');
    console.log('⏳ This may take a while due to the complex schema...');
    
    const result = await oshu.agents.run(AGENT_ID, {
      prompt: `You are a sophisticated system analysis AI. Analyze the current state of a hypothetical distributed web application system.

The system consists of:
- 5 microservices (user-service, order-service, payment-service, inventory-service, notification-service)  
- A PostgreSQL database cluster
- Redis cache layer
- Nginx load balancer
- Kubernetes orchestration

Generate a comprehensive analysis report. Be creative and realistic with the data - include some issues, anomalies, trends, and recommendations. Make sure to follow the exact JSON schema structure provided.

Key requirements:
1. Include at least 3-5 findings with different severity levels
2. Generate realistic statistical data and correlations
3. Identify temporal patterns and anomalies
4. Create a detailed action plan with immediate, short-term, and long-term tasks
5. Assess overall system health across all dimensions

Remember: Your response must be ONLY valid JSON matching the provided schema.`,
      timeout: 120 // Give it 2 minutes for this complex task
    });

    console.log('\n✅ Task completed!');
    
    if (result.output) {
      console.log('\n🎯 Successfully parsed structured output!');
      
      const data = result.output;
      
      // Validate some key fields exist
      console.log('\n📊 Analysis Summary:');
      console.log(`   Confidence: ${(data.meta?.confidence * 100)?.toFixed(1)}%`);
      console.log(`   Processing Time: ${data.meta?.processingTimeMs}ms`);
      console.log(`   Primary Findings: ${data.analysis?.primaryFindings?.length || 0}`);
      console.log(`   Overall Health Score: ${data.systemHealth?.overallScore}/100`);
      console.log(`   System Trajectory: ${data.systemHealth?.trajectory}`);
      
      // Show some findings
      if (data.analysis?.primaryFindings?.length > 0) {
        console.log('\n🔍 Key Findings:');
        data.analysis.primaryFindings.slice(0, 3).forEach((finding, i) => {
          console.log(`   ${i + 1}. [${finding.category?.toUpperCase()}] ${finding.description}`);
          console.log(`      Severity: ${finding.severity}/10`);
          console.log(`      Evidence: ${finding.evidence?.length || 0} pieces`);
          console.log(`      Recommendations: ${finding.recommendations?.length || 0}`);
        });
      }
      
      // Show action plan summary
      if (data.actionPlan) {
        console.log('\n📋 Action Plan:');
        console.log(`   Immediate tasks: ${data.actionPlan.immediate?.length || 0}`);
        console.log(`   Short-term tasks: ${data.actionPlan.shortTerm?.length || 0}`);
        console.log(`   Long-term tasks: ${data.actionPlan.longTerm?.length || 0}`);
        console.log(`   Overall risk: ${data.actionPlan.riskAssessment?.overallRisk}`);
      }
      
      // Show temporal patterns
      if (data.analysis?.temporalPatterns) {
        console.log('\n📈 Temporal Analysis:');
        console.log(`   Trends identified: ${data.analysis.temporalPatterns.trends?.length || 0}`);
        console.log(`   Anomalies detected: ${data.analysis.temporalPatterns.anomalies?.length || 0}`);
      }
      
      console.log('\n💾 Full structured output saved to result.json');
      require('fs').writeFileSync('result.json', JSON.stringify(data, null, 2));
      
    } else {
      console.log('\n❌ No structured output returned!');
      console.log('Make sure you copied the schema from obtuse-schema-example.json');
      console.log('into your agent\'s Configure > General > Structured Output Schema field');
    }

    console.log('\n📄 Raw result length:', result.result?.length || 0, 'characters');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.message.includes('timeout')) {
      console.log('💡 Try increasing the timeout or simplifying the schema');
    }
  } finally {
    console.log('\n🔌 Disconnecting...');
    await oshu.disconnect();
    console.log('✅ Obtuse test completed!');
  }
}

main().catch(console.error);