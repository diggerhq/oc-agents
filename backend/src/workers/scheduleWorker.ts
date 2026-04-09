import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, execute } from '../db/index.js';
import { ocService, getSandboxKey } from '../services/oc.js';
import type { SdkSession } from '../types/index.js';

interface Schedule {
  id: string;
  user_id: string;
  session_id: string;
  name: string;
  cron_expression: string;
  timezone: string;
  prompt: string;
  is_active: boolean | number;
  last_run_at: string | null;
  next_run_at: string | null;
  run_count: number;
}

// Calculate next run time from cron expression
function getNextRunTime(cronExpression: string, timezone: string = 'UTC'): Date {
  const now = new Date();
  const parts = cronExpression.split(' ');
  
  if (parts.length !== 5) {
    return new Date(now.getTime() + 60 * 60 * 1000);
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const nextRun = new Date(now);
  
  // Handle "* * * * *" (every minute)
  if (minute === '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    nextRun.setMinutes(nextRun.getMinutes() + 1);
    nextRun.setSeconds(0);
    nextRun.setMilliseconds(0);
    return nextRun;
  }
  
  // Handle */n patterns (run every n units)
  if (minute.startsWith('*/')) {
    const interval = parseInt(minute.slice(2));
    const currentMinute = now.getMinutes();
    const nextMinute = Math.ceil((currentMinute + 1) / interval) * interval;
    if (nextMinute >= 60) {
      nextRun.setHours(nextRun.getHours() + 1);
      nextRun.setMinutes(nextMinute - 60);
    } else {
      nextRun.setMinutes(nextMinute);
    }
    nextRun.setSeconds(0);
    nextRun.setMilliseconds(0);
    return nextRun;
  }
  
  if (hour.startsWith('*/')) {
    const interval = parseInt(hour.slice(2));
    const currentHour = now.getHours();
    const nextHour = Math.ceil((currentHour + 1) / interval) * interval;
    nextRun.setHours(nextHour >= 24 ? nextHour - 24 : nextHour);
    nextRun.setMinutes(minute === '*' ? 0 : parseInt(minute));
    nextRun.setSeconds(0);
    if (nextHour >= 24) {
      nextRun.setDate(nextRun.getDate() + 1);
    }
    return nextRun;
  }

  // Handle specific times (e.g., "0 9 * * *" = 9:00 AM daily)
  if (minute !== '*' && hour !== '*') {
    const targetHour = parseInt(hour);
    const targetMinute = parseInt(minute);
    nextRun.setHours(targetHour);
    nextRun.setMinutes(targetMinute);
    nextRun.setSeconds(0);
    
    // If the time has passed today, schedule for tomorrow
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }
    return nextRun;
  }

  // Default: 1 hour from now
  return new Date(now.getTime() + 60 * 60 * 1000);
}

async function processSchedule(schedule: Schedule): Promise<void> {
  console.log(`[Scheduler] Executing schedule: ${schedule.name} (${schedule.id})`);
  
  // Calculate next run time FIRST and update schedule atomically to prevent race condition
  const nextRunAt = getNextRunTime(schedule.cron_expression, schedule.timezone);
  const now = new Date().toISOString();
  
  // Atomically claim this schedule run by updating next_run_at
  // If another worker already claimed it, this will update 0 rows
  const claimResult = await execute(
    `UPDATE schedules 
     SET next_run_at = $1, last_run_at = $2, run_count = run_count + 1, updated_at = $3 
     WHERE id = $4 AND next_run_at = $5`,
    [nextRunAt.toISOString(), now, now, schedule.id, schedule.next_run_at]
  );
  
  // Check if we successfully claimed it (rowCount check for postgres, changes for sqlite)
  // If the update didn't match, another worker already processed this schedule
  if (!claimResult) {
    console.log(`[Scheduler] Schedule ${schedule.name} already processed by another worker`);
    return;
  }
  
  try {
    // Create a schedule run
    const runId = uuidv4();
    await execute(
      `INSERT INTO schedule_runs (id, schedule_id, status, started_at) VALUES ($1, $2, 'running', $3)`,
      [runId, schedule.id, now]
    );

    // Create the task in tasks table
    const taskId = uuidv4();
    await execute(
      `INSERT INTO tasks (id, session_id, prompt, status) VALUES ($1, $2, $3, 'pending')`,
      [taskId, schedule.session_id, schedule.prompt]
    );

    // Queue the task for processing with correct columns
    await execute(
      `INSERT INTO task_queue (id, agent_id, user_id, prompt, status, source) 
       VALUES ($1, $2, $3, $4, 'pending', 'schedule')`,
      [uuidv4(), schedule.session_id, schedule.user_id, schedule.prompt]
    );

    // Update the schedule run with the task ID
    await execute(
      `UPDATE schedule_runs SET task_id = $1 WHERE id = $2`,
      [taskId, runId]
    );

    console.log(`[Scheduler] Schedule ${schedule.name} queued task ${taskId}, next run at ${nextRunAt.toISOString()}`);

  } catch (error: any) {
    console.error(`[Scheduler] Failed to execute schedule ${schedule.name}:`, error);
    
    // Log the failure in schedule_runs
    const runId = uuidv4();
    await execute(
      `INSERT INTO schedule_runs (id, schedule_id, status, error, started_at, completed_at) 
       VALUES ($1, $2, 'failed', $3, $4, $5)`,
      [runId, schedule.id, error.message, now, now]
    );
  }
}

async function checkSchedules(): Promise<void> {
  try {
    const now = new Date().toISOString();
    
    // Find all active schedules that are due
    const dueSchedules = await query<Schedule>(
      `SELECT * FROM schedules 
       WHERE is_active = $1 
       AND next_run_at IS NOT NULL 
       AND next_run_at <= $2`,
      [1, now]
    );

    if (dueSchedules.length > 0) {
      console.log(`[Scheduler] Found ${dueSchedules.length} due schedule(s)`);
    }

    for (const schedule of dueSchedules) {
      await processSchedule(schedule);
    }
  } catch (error) {
    console.error('[Scheduler] Error checking schedules:', error);
  }
}

// SDK Session TTL cleanup (30 minutes inactive by default)
const SDK_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function cleanupExpiredSdkSessions(): Promise<void> {
  try {
    // Find active SDK sessions that have been inactive for longer than TTL
    const cutoffTime = new Date(Date.now() - SDK_SESSION_TTL_MS).toISOString();
    
    const expiredSessions = await query<SdkSession>(
      `SELECT * FROM sdk_sessions 
       WHERE status = 'active' 
       AND last_used_at < $1`,
      [cutoffTime]
    );

    if (expiredSessions.length === 0) {
      return;
    }

    console.log(`[Scheduler] Found ${expiredSessions.length} expired SDK session(s) to cleanup`);

    for (const session of expiredSessions) {
      try {
        // Close the sandbox
        const sandboxKey = getSandboxKey({
          agentId: session.agent_id,
          surface: 'sdk',
          sdkSessionId: session.id,
        });

        try {
          await ocService.closeSandbox(sandboxKey);
          console.log(`[Scheduler] Closed sandbox ${sandboxKey} for expired session ${session.id}`);
        } catch (sandboxErr) {
          // Sandbox may not exist, which is fine
          console.log(`[Scheduler] Sandbox ${sandboxKey} not found or already closed`);
        }

        // Mark session as closed
        await execute(
          `UPDATE sdk_sessions SET status = 'closed', closed_at = NOW() WHERE id = $1`,
          [session.id]
        );

        console.log(`[Scheduler] Closed expired SDK session ${session.id} (last used: ${session.last_used_at})`);
      } catch (sessionErr) {
        console.error(`[Scheduler] Failed to cleanup SDK session ${session.id}:`, sessionErr);
      }
    }
  } catch (error) {
    console.error('[Scheduler] Error cleaning up expired SDK sessions:', error);
  }
}

export function startScheduleWorker(intervalMs: number = 60000): void {
  console.log(`[Scheduler] Worker started, checking every ${intervalMs / 1000}s`);
  
  // Initial check
  setTimeout(() => {
    checkSchedules();
    cleanupExpiredSdkSessions();
  }, 5000); // Wait 5 seconds after startup
  
  // Regular interval checks for schedules
  setInterval(checkSchedules, intervalMs);
  
  // Cleanup expired SDK sessions every 5 minutes
  setInterval(cleanupExpiredSdkSessions, 5 * 60 * 1000);
}
