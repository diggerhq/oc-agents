#!/usr/bin/env python3
"""
Oshu SDK Example - Using context manager (recommended pattern)
"""
import asyncio
import os
from oshu import Oshu, RunOptions

async def main():
    # Using async context manager - automatically handles connect/disconnect
    async with Oshu(
        api_key=os.getenv('OSHU_API_KEY', 'flt_GkBRHUPABVyy2bbkk-0KHxI73Z8cByN2'),
        base_url='http://localhost:3000'
    ) as oshu:
        
        print("✅ Connected via context manager!")
        
        # Get agents
        agents = await oshu.agents.list()
        if not agents:
            print("❌ No agents found.")
            return
            
        agent = agents[0]
        print(f"🤖 Using agent: {agent.name}")
        
        # Multiple tasks in sequence
        tasks = [
            "What's 2 + 2?",
            "Write a haiku about programming",
            "Explain what an API is in simple terms"
        ]
        
        for i, prompt in enumerate(tasks, 1):
            print(f"\n📤 Task {i}: {prompt}")
            
            result = await oshu.agents.run(
                agent.id,
                RunOptions(prompt=prompt)
            )
            
            print(f"✅ Result {i}: {result.output[:100]}{'...' if len(result.output) > 100 else ''}")
        
        print("\n🎉 All tasks completed!")
        # Context manager automatically disconnects here

if __name__ == "__main__":
    asyncio.run(main())