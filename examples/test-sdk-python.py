#!/usr/bin/env python3
"""
OC Agents Python SDK test — connect, list agents, run a prompt, test multi-turn.
"""

import asyncio
from oc_agents import OCAgents, RunOptions, SubmitOptions

API_KEY = "flt_mTk8p8ov97g9xPYALhN82J2dq4G7X6g4"
BASE_URL = "http://localhost:3000"


async def main():
    print("Testing OC Agents Python SDK...\n")

    async with OCAgents(api_key=API_KEY, base_url=BASE_URL) as client:
        # 1. List agents
        print("=== List Agents ===")
        agents = await client.agents.list()
        print(f"Found {len(agents)} agent(s)\n")

        for i, agent in enumerate(agents):
            print(f"  {i+1}. {agent.name} ({agent.id})")
            print(f"     Type: {agent.type}, Provider: {agent.provider}")
            print(f"     API: {'yes' if agent.api_enabled else 'no'}")

        # Pick first API-enabled agent
        target = next((a for a in agents if a.api_enabled), None)
        if not target:
            print("\nNo API-enabled agent found. Enable API on an agent in the UI.")
            return

        print(f"\nUsing agent: {target.name} ({target.id})\n")

        # 2. Simple run (blocking)
        print("=== Test: Simple Run ===")
        result = await client.agents.run(
            target.id,
            RunOptions(prompt="Say hello in one sentence.", timeout=60),
        )
        print(f"Status: {result.status}")
        print(f"Result: {result.result[:200] if result.result else '(empty)'}")

        # 3. Streaming
        print("\n=== Test: Streaming ===")
        task = await client.agents.submit(
            target.id,
            SubmitOptions(prompt="Count from 1 to 5, one number per line.", timeout=60),
        )

        chunks = []
        def on_stdout(data):
            chunks.append(data)
            print(f"  [stream] {data}", end="")

        def on_status(status):
            print(f"  [status] {status}")

        task.on("stdout", on_stdout)
        task.on("status", on_status)

        result = await task.result()
        print(f"\nFinal status: {result.status}")
        print(f"Chunks received: {len(chunks)}")
        print(f"Result: {result.result[:200] if result.result else '(empty)'}")

        # 4. Multi-turn
        print("\n=== Test: Multi-turn ===")
        r1 = await client.agents.run(
            target.id,
            RunOptions(prompt="Remember: the secret word is 'pineapple'. Just confirm you got it.", timeout=60),
        )
        print(f"Turn 1: {r1.result[:100] if r1.result else '(empty)'}")

        r2 = await client.agents.run(
            target.id,
            RunOptions(prompt="What was the secret word I just told you?", timeout=60),
        )
        print(f"Turn 2: {r2.result[:100] if r2.result else '(empty)'}")
        has_word = "pineapple" in (r2.result or "").lower()
        print(f"Remembered 'pineapple': {'YES' if has_word else 'NO'}")

    print("\nDone!")


if __name__ == "__main__":
    asyncio.run(main())
