#!/usr/bin/env python3
"""
Advanced Oshu SDK Example - Streaming and task management
"""
import asyncio
import os
from oshu import Oshu, RunOptions

async def main():
    # Initialize the Oshu client
    oshu = Oshu(
        api_key=os.getenv('OSHU_API_KEY', 'flt_GkBRHUPABVyy2bbkk-0KHxI73Z8cByN2'),
        base_url='http://localhost:3000'
    )

    try:
        print("🔌 Connecting to Oshu...")
        await oshu.connect()
        print("✅ Connected!")

        # Get agents
        agents = await oshu.agents.list()
        if not agents:
            print("❌ No agents found.")
            return

        agent = agents[0]
        print(f"🤖 Using agent: {agent.name}")

        # Advanced streaming example
        print("\n🌊 Testing streaming task...")
        task = await oshu.agents.submit(
            agent.id,
            RunOptions(prompt="Count to 10 slowly, explaining what you're doing at each step")
        )
        
        print(f"📋 Task submitted: {task.id}")

        # Set up event handlers
        def on_stdout(data: str):
            print(f"📝 Output: {data.strip()}")

        def on_stderr(data: str):
            print(f"⚠️  Error: {data.strip()}")

        def on_status(status: str):
            print(f"📊 Status: {status}")

        # Register event handlers
        task.on('stdout', on_stdout)
        task.on('stderr', on_stderr) 
        task.on('status', on_status)

        # Wait for completion with timeout
        try:
            result = await asyncio.wait_for(task.result(), timeout=60.0)
            print("✅ Streaming task completed!")
            print(f"📄 Final result: {result.output}")
        except asyncio.TimeoutError:
            print("⏰ Task timed out, cancelling...")
            await task.cancel()
            print("🛑 Task cancelled")

        # Example: Quick task cancellation test
        print("\n🛑 Testing task cancellation...")
        cancel_task = await oshu.agents.submit(
            agent.id,
            RunOptions(prompt="Count to 100 very slowly, with long pauses")
        )
        
        print(f"📋 Task submitted: {cancel_task.id}")
        
        # Wait a moment then cancel
        await asyncio.sleep(2)
        print("🛑 Cancelling task...")
        await cancel_task.cancel()
        print("✅ Task successfully cancelled")

    except Exception as error:
        print(f"❌ Error: {error}")
        import traceback
        traceback.print_exc()
    finally:
        print("🔌 Disconnecting...")
        await oshu.disconnect()
        print("✅ Advanced example completed!")

if __name__ == "__main__":
    asyncio.run(main())