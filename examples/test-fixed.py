#!/usr/bin/env python3

API_KEY = "flt_GkBRHUPABVyy2bbkk-0KHxI73Z8cByN2" 
AGENT_ID = "53512233-3f2b-4971-b724-ddfbcc433b78"

import sys
import os

# Add the SDK to Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'packages', 'sdk-python'))

from oshu import Oshu, RunOptions

async def main():
    print("🔌 Connecting to Oshu...")
    
    # Method 1: Manual connect/disconnect
    oshu = Oshu(api_key=API_KEY, base_url='http://localhost:3000')
    await oshu.connect()  # Don't forget await!
    
    try:
        print("📤 Running task...")
        result = await oshu.agents.run(AGENT_ID, RunOptions(prompt="whats up"))
        print(f"✅ Result: {result.output}")
        return result
    finally:
        print("🔌 Disconnecting...")
        await oshu.disconnect()  # Clean up

async def main_context_manager():
    print("🔌 Using context manager...")
    
    # Method 2: Context manager (recommended)
    async with Oshu(api_key=API_KEY, base_url='http://localhost:3000') as oshu:
        print("📤 Running task...")
        result = await oshu.agents.run(AGENT_ID, RunOptions(prompt="whats up"))
        print(f"✅ Result: {result.output}")
        return result
    # Automatically disconnects here

if __name__ == "__main__":
    import asyncio
    
    print("=== Method 1: Manual connect/disconnect ===")
    asyncio.run(main())
    
    print("\n=== Method 2: Context manager (recommended) ===")
    asyncio.run(main_context_manager())