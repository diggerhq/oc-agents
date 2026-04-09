#!/usr/bin/env python3
"""
Basic Oshu SDK Example - Simple usage
"""
import asyncio
import os
from oshu import Oshu, RunOptions

async def main():
    # Initialize the Oshu client
    oshu = Oshu(
        api_key=os.getenv('OSHU_API_KEY', 'flt_GkBRHUPABVyy2bbkk-0KHxI73Z8cByN2'),
        base_url='http://localhost:3000'  # Your local server
    )

    try:
        print("🔌 Connecting to Oshu...")
        await oshu.connect()
        print("✅ Connected!")

        # List available agents
        print("📋 Getting agents...")
        agents = await oshu.agents.list()
        print(f"Found {len(agents)} agents:")
        for agent in agents:
            print(f"  - {agent.name} ({agent.id})")
            print(f"    Type: {agent.type}, Provider: {agent.provider}")
            print(f"    API Enabled: {agent.api_enabled}")

        if not agents:
            print("❌ No agents found. Make sure you have agents configured.")
            return

        # Use the first available agent
        agent = agents[0]
        print(f"\n🤖 Using agent: {agent.name}")

        # Simple run - wait for completion
        print("📤 Running simple task...")
        result = await oshu.agents.run(
            agent.id, 
            RunOptions(prompt="Say hello and tell me what you can do in Python!")
        )
        print("✅ Task completed!")
        print(f"📄 Result: {result.output}")

    except Exception as error:
        print(f"❌ Error: {error}")
    finally:
        # Clean up
        print("🔌 Disconnecting...")
        await oshu.disconnect()
        print("✅ Example completed!")

if __name__ == "__main__":
    asyncio.run(main())