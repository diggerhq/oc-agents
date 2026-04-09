#!/usr/bin/env python3
"""
Structured Output Example - Oshu Python SDK

This example demonstrates how to use structured output with the Oshu Python SDK.
First, configure your agent with an output schema in the UI, then run this script.
"""

import asyncio
import json
import os
import sys

# Add the SDK to Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'packages', 'sdk-python'))

from oshu import Oshu, RunOptions

API_KEY = os.getenv('API_KEY', 'flt_GkBRHUPABVyy2bbkk-0KHxI73Z8cByN2')
AGENT_ID = os.getenv('AGENT_ID', '53512233-3f2b-4971-b724-ddfbcc433b78')

async def main():
    async with Oshu(api_key=API_KEY, base_url='http://localhost:3000') as oshu:
        print("🔌 Connected to Oshu!")
        
        # Get agent info to check if it has structured output configured
        print("📋 Getting agent info...")
        agents = await oshu.agents.list()
        agent = next((a for a in agents if a.id == AGENT_ID), None)
        
        if not agent:
            print("❌ Agent not found!")
            return
            
        print(f"🤖 Using agent: {agent.name}")
        
        if agent.output_schema:
            print("📊 Agent has structured output configured:")
            print(json.dumps(agent.output_schema, indent=2))
        else:
            print("⚠️  Agent does not have structured output configured.")
            print("   Go to the agent's Configure tab > General section > Structured Output Schema")
            print("   and add a JSON schema like:")
            print("""   {
     "type": "object",
     "properties": {
       "summary": { "type": "string" },
       "status": { "type": "string", "enum": ["success", "error"] },
       "data": { "type": "object" }
     },
     "required": ["summary", "status"]
   }""")

        print("\n📤 Running task with structured output...")
        
        result = await oshu.agents.run(AGENT_ID, RunOptions(
            prompt="""Analyze the current time and date. Provide a summary of what you found.
            
If you have structured output configured, format your response according to the schema.
Otherwise, just provide a regular text response.""",
            timeout=60
        ))

        print("\n✅ Task completed!")
        print(f"\n📄 Raw result:\n{result.result}")

        if result.output:
            print("\n🎯 Structured output:")
            print(json.dumps(result.output, indent=2))
            
            # Type-safe access (if you know the schema)
            if isinstance(result.output, dict):
                if 'summary' in result.output:
                    print(f"\n📝 Summary: {result.output['summary']}")
                if 'status' in result.output:
                    print(f"📊 Status: {result.output['status']}")
        else:
            print("\n💡 No structured output returned (agent may not have schema configured)")

if __name__ == "__main__":
    asyncio.run(main())