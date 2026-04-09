"""
Oshu SDK Test Suite (Python)

Run with: python -m pytest tests/test_sdk.py -v
Or directly: python tests/test_sdk.py

Environment variables:
  OSHU_API_KEY - Your API key (default: flt_test_key)
  OSHU_BASE_URL - API base URL (default: http://localhost:3000)
  OSHU_AGENT_ID - Agent ID to test with (required)
"""

import asyncio
import os
import sys
from typing import Optional

# Add parent directory to path for local development
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from oshu import Oshu
from oshu.types import RunOptions, SubmitOptions, SdkSession

API_KEY = os.environ.get('OSHU_API_KEY', 'flt_test_key')
BASE_URL = os.environ.get('OSHU_BASE_URL', 'http://localhost:3000')
AGENT_ID = os.environ.get('OSHU_AGENT_ID')


class TestResult:
    def __init__(self, name: str, passed: bool, error: Optional[str] = None):
        self.name = name
        self.passed = passed
        self.error = error


class TestRunner:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.results: list[TestResult] = []

    async def test(self, name: str, fn):
        """Run a test function and record result"""
        try:
            await fn()
            self.passed += 1
            self.results.append(TestResult(name, True))
            print(f"  ✅ {name}")
        except Exception as e:
            self.failed += 1
            error_msg = str(e)
            self.results.append(TestResult(name, False, error_msg))
            print(f"  ❌ {name}")
            print(f"     Error: {error_msg}")


async def run_tests():
    if not AGENT_ID:
        print("❌ OSHU_AGENT_ID environment variable is required")
        sys.exit(1)

    print("\n🧪 Oshu SDK Test Suite (Python)\n")
    print(f"   API URL: {BASE_URL}")
    print(f"   Agent ID: {AGENT_ID}\n")

    runner = TestRunner()
    client = Oshu(api_key=API_KEY, base_url=BASE_URL)

    test_session: Optional[SdkSession] = None
    session2: Optional[SdkSession] = None
    provisioned_session_id: Optional[str] = None

    try:
        # Connect
        print("📡 Connecting to WebSocket...")
        await client.connect()
        print("   Connected!\n")

        print("─" * 50)
        print("Session Management Tests")
        print("─" * 50)

        async def test_create_session():
            nonlocal test_session
            test_session = await client.agents.new(AGENT_ID)
            assert test_session.id, "Session ID should be defined"
            assert test_session.agent_id == AGENT_ID, f"Agent ID should match, got {test_session.agent_id}"
            assert test_session.status == "active", f"Session status should be active, got {test_session.status}"

        await runner.test("Create SDK session", test_create_session)

        async def test_session_properties():
            assert test_session, "Session should exist"
            assert test_session.id, "Session ID should be defined"
            assert len(test_session.id) > 0, "Session ID should not be empty"
            assert test_session.created_at, "Created at should be defined"

        await runner.test("Session has valid properties", test_session_properties)

        print("\n" + "─" * 50)
        print("Task Execution Tests")
        print("─" * 50)

        async def test_run_task_in_session():
            assert test_session, "Session should exist"
            result = await client.agents.run(
                AGENT_ID,
                RunOptions(
                    prompt='Echo "test123" to stdout',
                    session_id=test_session.id,
                    timeout=60,
                )
            )
            assert result.status == "completed", f"Task should complete, got {result.status}"
            assert result.result, "Result should be defined"

        await runner.test("Run task in session", test_run_task_in_session)

        async def test_submit_task_streaming():
            assert test_session, "Session should exist"
            handle = await client.agents.submit(
                AGENT_ID,
                SubmitOptions(
                    prompt='Print "streaming works"',
                    session_id=test_session.id,
                )
            )
            assert handle.id, "Task ID should be defined"
            result = await handle.result()
            assert result.status == "completed", f"Task should complete, got {result.status}"

        await runner.test("Submit task with streaming", test_submit_task_streaming)

        async def test_session_state_sharing():
            assert test_session, "Session should exist"
            
            # Create a file
            await client.agents.run(
                AGENT_ID,
                RunOptions(
                    prompt='Create a file named sdk_test_file.txt with content "state test"',
                    session_id=test_session.id,
                    timeout=60,
                )
            )
            
            # Verify file exists in same session
            result = await client.agents.run(
                AGENT_ID,
                RunOptions(
                    prompt='Cat the file sdk_test_file.txt and output its contents',
                    session_id=test_session.id,
                    timeout=60,
                )
            )
            
            assert result.status == "completed", f"Task should complete, got {result.status}"
            assert result.result and ("state test" in result.result or "sdk_test_file" in result.result), \
                "Should be able to see file from previous task"

        await runner.test("Tasks in same session share state", test_session_state_sharing)

        print("\n" + "─" * 50)
        print("Session Isolation Tests")
        print("─" * 50)

        async def test_create_second_session():
            nonlocal session2
            session2 = await client.agents.new(AGENT_ID)
            assert session2.id, "Session 2 ID should be defined"
            assert session2.id != test_session.id, "Session IDs should be different"

        await runner.test("Create second isolated session", test_create_second_session)

        async def test_session_isolation():
            assert session2, "Session 2 should exist"
            
            # Try to read file from session 1 in session 2
            result = await client.agents.run(
                AGENT_ID,
                RunOptions(
                    prompt='Check if sdk_test_file.txt exists and report yes or no',
                    session_id=session2.id,
                    timeout=60,
                )
            )
            
            assert result.status == "completed", f"Task should complete, got {result.status}"
            # File should NOT exist in session 2 (isolation)
            result_lower = (result.result or "").lower()
            assert "state test" not in result_lower, \
                "Session 2 should NOT see file contents from Session 1 (isolation)"

        await runner.test("Sessions are isolated (no shared files)", test_session_isolation)

        async def test_close_second_session():
            assert session2, "Session 2 should exist"
            close_result = await client.agents.close_session(AGENT_ID, session2.id)
            assert close_result.get("success"), "Session close should succeed"

        await runner.test("Close second session", test_close_second_session)

        print("\n" + "─" * 50)
        print("Provision (Auto-Session) Tests")
        print("─" * 50)

        async def test_provision_creates_session():
            nonlocal provisioned_session_id
            handle = await client.agents.submit(
                AGENT_ID,
                SubmitOptions(
                    prompt='Echo "provisioned"',
                    provision=True,
                )
            )
            
            assert handle.id, "Task ID should be defined"
            provisioned_session_id = handle.session_id
            
            result = await handle.result()
            assert result.status == "completed", f"Task should complete, got {result.status}"

        await runner.test("Task with provision creates session", test_provision_creates_session)

        async def test_cleanup_provisioned_session():
            if provisioned_session_id:
                close_result = await client.agents.close_session(AGENT_ID, provisioned_session_id)
                assert close_result.get("success"), "Provisioned session close should succeed"

        await runner.test("Clean up provisioned session", test_cleanup_provisioned_session)

        print("\n" + "─" * 50)
        print("Cleanup")
        print("─" * 50)

        async def test_close_original_session():
            assert test_session, "Session should exist"
            close_result = await client.agents.close_session(AGENT_ID, test_session.id)
            assert close_result.get("success"), "Session close should succeed"

        await runner.test("Close original test session", test_close_original_session)

    except Exception as e:
        print(f"Fatal error: {e}")
        runner.failed += 1
    finally:
        await client.disconnect()

    # Summary
    print("\n" + "═" * 50)
    print("Test Results")
    print("═" * 50)
    print(f"  Total:  {runner.passed + runner.failed}")
    print(f"  Passed: {runner.passed} ✅")
    print(f"  Failed: {runner.failed} ❌")
    print("═" * 50 + "\n")

    sys.exit(1 if runner.failed > 0 else 0)


if __name__ == "__main__":
    asyncio.run(run_tests())
