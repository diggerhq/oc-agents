#!/usr/bin/env python3

"""
Oshu SDK - Sandbox Warmup Example

This example demonstrates how to warm up sandboxes for faster first-request performance.
Warming up creates the sandbox and installs tools ahead of time.
"""

import asyncio
import time
from oshu import Oshu


async def main():
    oshu = Oshu(
        api_key="flt_GkBRHUPABVyy2bbkk-0KHxI73Z8cByN2",
        base_url="http://localhost:3000"
    )
    
    try:
        print("🔌 Connecting to Oshu...")
        await oshu.connect()
        
        print("📋 Getting available agents...")
        agents = await oshu.agents.list()
        
        if not agents:
            print("❌ No agents found. Create an agent first.")
            return
        
        agent = agents[0]
        print(f"✅ Found agent: {agent.name} ({agent.id})")
        
        # Example 1: Warm up a single agent
        print("\n🔥 Warming up sandbox...")
        warmup_result = await oshu.agents.warmup(agent.id)
        
        if warmup_result['success']:
            print("✅ Sandbox warmed up successfully!")
            print(f"   Sandbox ID: {warmup_result['sandbox_id']}")
            print(f"   Status: {warmup_result['status']}")
            
            if warmup_result['status'] == 'extended':
                print("   ℹ️  Sandbox was already warm, lifetime was extended")
            else:
                print("   ℹ️  New sandbox was created")
        else:
            print(f"❌ Warmup failed: {warmup_result['error']}")
        
        # Example 1b: Call warmup again to see 'extended' status
        print("\n🔥 Calling warmup again (should show 'extended' status)...")
        warmup_result2 = await oshu.agents.warmup(agent.id)
        
        if warmup_result2['success']:
            print(f"✅ Sandbox status: {warmup_result2['status']}")
            if warmup_result2['status'] == 'extended':
                print("   ✓ Sandbox was already warm - safe to use concurrently!")
        
        # Example 2: Test performance difference
        print("\n⏱️  Testing performance...")
        
        # First request (should be fast since warmed up)
        print("Making first request (warmed sandbox)...")
        start1 = time.time()
        result1 = await oshu.agents.run(agent.id, {
            "prompt": "Say hello and tell me the current time",
            "timeout": 60
        })
        duration1 = (time.time() - start1) * 1000
        print(f"✅ First request completed in {duration1:.0f}ms")
        print(f"   Response: {result1.result[:100]}...")
        
        # Wait a bit, then make another request
        print("\nWaiting 5 seconds...")
        await asyncio.sleep(5)
        
        print("Making second request...")
        start2 = time.time()
        result2 = await oshu.agents.run(agent.id, {
            "prompt": "List the files in the current directory",
            "timeout": 60
        })
        duration2 = (time.time() - start2) * 1000
        print(f"✅ Second request completed in {duration2:.0f}ms")
        print(f"   Response: {result2.result[:100]}...")
        
        # Example 3: Warm up multiple agents
        if len(agents) > 1:
            print("\n🔥 Warming up multiple agents...")
            agent_ids = [a.id for a in agents[:min(3, len(agents))]]
            
            multi_warmup_result = await oshu.agents.warmup_multiple(agent_ids)
            
            print(f"✅ Bulk warmup completed: {multi_warmup_result['success']}")
            for result in multi_warmup_result['results']:
                agent_name = next((a.name for a in agents if a.id == result['agentId']), result['agentId'])
                status = "✅" if result['success'] else "❌"
                info = result.get('sandboxId', result.get('error', 'Unknown'))
                print(f"   {status} {agent_name}: {info}")
        
        print("\n🎯 Warmup examples completed!")
        print("\n💡 Tips:")
        print("   - Warm up agents before peak usage periods")
        print("   - Sandboxes stay warm for ~30 minutes of inactivity")
        print("   - Use warmup_multiple() for batch operations")
        print("   - Warmup is idempotent - safe to call multiple times")
        
    except Exception as error:
        print(f"❌ Error: {error}")
    finally:
        await oshu.disconnect()


if __name__ == "__main__":
    asyncio.run(main())