"""
SDK Session Isolation Example (Python)

This example demonstrates how to use isolated SDK sessions for sandbox separation.
Each session gets its own sandbox, so multiple users/processes can work with
the same agent without interfering with each other.
"""

import asyncio
import os
from oshu import Oshu
from oshu.types import RunOptions, SubmitOptions

API_KEY = os.environ.get('OSHU_API_KEY', 'flt_your_api_key_here')
BASE_URL = os.environ.get('OSHU_BASE_URL', 'http://localhost:3000')
AGENT_ID = os.environ.get('OSHU_AGENT_ID')


async def main():
    if not AGENT_ID:
        print('Please set OSHU_AGENT_ID environment variable')
        return

    # Initialize the SDK
    oshu = Oshu(
        api_key=API_KEY,
        base_url=BASE_URL,
    )

    try:
        # Connect to WebSocket for real-time updates
        await oshu.connect()
        print('✅ Connected to Oshu\n')

        # ========================================
        # Example 1: Create an isolated session
        # ========================================
        print('📦 Creating isolated session...')
        session = await oshu.agents.new(AGENT_ID)
        print(f'   Session ID: {session.id}')
        print(f'   Agent ID: {session.agent_id}')
        print(f'   Status: {session.status}')
        print()

        # ========================================
        # Example 2: Run tasks in the session
        # ========================================
        print('🚀 Running task in isolated session...')
        result1 = await oshu.agents.run(
            AGENT_ID,
            RunOptions(
                prompt='Create a file called hello.txt with the text "Hello from Python session"',
                session_id=session.id,
                timeout=120,
            )
        )
        print(f'   Task completed: {result1.status}')
        print(f'   Result preview: {(result1.result or "")[:200]}...')
        print()

        # Run another task in the same session (same sandbox)
        print('🔄 Running second task in same session...')
        result2 = await oshu.agents.run(
            AGENT_ID,
            RunOptions(
                prompt='List the files in the current directory and show the contents of hello.txt',
                session_id=session.id,
                timeout=120,
            )
        )
        print(f'   Task completed: {result2.status}')
        print(f'   Result preview: {(result2.result or "")[:300]}...')
        print()

        # ========================================
        # Example 3: Close the session
        # ========================================
        print('🧹 Closing session...')
        close_result = await oshu.agents.close_session(AGENT_ID, session.id)
        print(f'   Closed: {close_result.get("success")}')
        print()

        # ========================================
        # Example 4: Using provision for auto-session
        # ========================================
        print('⚡ Running task with auto-provisioned session...')
        handle = await oshu.agents.submit(
            AGENT_ID,
            SubmitOptions(
                prompt='Echo "This task auto-created its own isolated session"',
                provision=True,  # Automatically create a new session
                timeout=120,
            )
        )
        
        print(f'   Task ID: {handle.id}')
        print(f'   Session ID: {handle.session_id or "auto-created"}')
        
        result3 = await handle.result()
        print(f'   Result: {(result3.result or "")[:200]}...')
        
        # Close the auto-provisioned session if we got one
        if handle.session_id:
            await oshu.agents.close_session(AGENT_ID, handle.session_id)
            print(f'   Cleaned up session: {handle.session_id}')
        print()

        print('✨ All examples completed successfully!')

    except Exception as e:
        print(f'Error: {e}')
    finally:
        # Always disconnect when done
        await oshu.disconnect()


if __name__ == '__main__':
    asyncio.run(main())
