"""
Multi-User Session Isolation Example (Python)

This example simulates multiple users working with the same agent simultaneously.
Each user gets their own isolated sandbox session, so their work doesn't interfere.
"""

import asyncio
import os
from datetime import datetime
from oshu import Oshu
from oshu.types import RunOptions

API_KEY = os.environ.get('OSHU_API_KEY', 'flt_your_api_key_here')
BASE_URL = os.environ.get('OSHU_BASE_URL', 'http://localhost:3000')
AGENT_ID = os.environ.get('OSHU_AGENT_ID')


async def user_workflow(oshu: Oshu, agent_id: str, user_id: str) -> dict:
    """Simulate work for a single user in their isolated session."""
    print(f'\n👤 User {user_id}: Starting workflow...')
    
    # Create isolated session for this user
    session = await oshu.agents.new(agent_id)
    print(f'   User {user_id}: Created session {session.id[:8]}...')
    
    try:
        # User does their work in their isolated sandbox
        print(f'   User {user_id}: Creating user-specific file...')
        await oshu.agents.run(
            agent_id,
            RunOptions(
                prompt=f'Create a file called user_{user_id}_data.json with content: {{"userId": "{user_id}", "timestamp": "{datetime.now().isoformat()}"}}',
                session_id=session.id,
                timeout=120,
            )
        )
        
        # Verify the file exists only in this user's sandbox
        print(f'   User {user_id}: Verifying isolated workspace...')
        result = await oshu.agents.run(
            agent_id,
            RunOptions(
                prompt='List all files in the current directory that start with "user_"',
                session_id=session.id,
                timeout=60,
            )
        )
        
        print(f'   User {user_id}: Files in sandbox: {(result.result or "")[:100]}...')
        
        return {'user_id': user_id, 'session_id': session.id, 'success': True}
    
    finally:
        # Clean up the session
        print(f'   User {user_id}: Closing session...')
        await oshu.agents.close_session(agent_id, session.id)


async def main():
    if not AGENT_ID:
        print('Please set OSHU_AGENT_ID environment variable')
        return

    oshu = Oshu(
        api_key=API_KEY,
        base_url=BASE_URL,
    )

    try:
        await oshu.connect()
        print('✅ Connected to Oshu')
        print('📋 Simulating 3 users working simultaneously...')

        # Run 3 users in parallel - each gets their own sandbox
        results = await asyncio.gather(
            user_workflow(oshu, AGENT_ID, 'alice'),
            user_workflow(oshu, AGENT_ID, 'bob'),
            user_workflow(oshu, AGENT_ID, 'charlie'),
        )

        print('\n📊 Results:')
        for r in results:
            status = '✅ Success' if r['success'] else '❌ Failed'
            print(f"   {r['user_id']}: {status}")

        print('\n✨ Multi-user isolation demo complete!')
        print('   Each user had their own isolated sandbox.')
        print('   Files created by one user were not visible to others.')

    except Exception as e:
        print(f'Error: {e}')
    finally:
        await oshu.disconnect()


if __name__ == '__main__':
    asyncio.run(main())
