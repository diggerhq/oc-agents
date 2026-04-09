import pg from 'pg';
import { runMigrations } from './migrations/runner.js';

// PostgreSQL-only database layer
console.log('[DB] Using PostgreSQL database');

let pgPool: pg.Pool | null = null;

async function initPostgres() {
  const { Pool } = pg;

  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  pgPool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
  });

  console.log('PostgreSQL connection pool initialized');
}

function requirePool(): pg.Pool {
  if (!pgPool) throw new Error('PostgreSQL not initialized');
  return pgPool;
}

export async function initializeDatabase(): Promise<void> {
  await initPostgres();
  console.log('[DB] Running migrations...');
  await runMigrations(execute, query);
}

/**
 * Query multiple rows from the database
 * Use native PostgreSQL placeholders ($1, $2, ...)
 */
export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await requirePool().query(sql, params);
  return result.rows as T[];
}

/**
 * Query a single row from the database
 * Use native PostgreSQL placeholders ($1, $2, ...)
 */
export async function queryOne<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  const result = await requirePool().query(sql, params);
  return result.rows[0] as T | undefined;
}

/**
 * Execute a statement (INSERT, UPDATE, DELETE)
 * Use native PostgreSQL placeholders ($1, $2, ...)
 */
export async function execute(sql: string, params: unknown[] = []): Promise<{ rowCount: number }> {
  const result = await requirePool().query(sql, params);
  return { rowCount: result.rowCount || 0 };
}

// Legacy aliases (still used across the codebase)
export const getOne = queryOne;
export const getAll = query;
export const run = execute;

export async function closeDatabase(): Promise<void> {
  if (pgPool) {
    await pgPool.end();
    console.log('PostgreSQL connection pool closed');
  }
}

/**
 * Execute multiple statements in a transaction
 * If any statement fails, all changes are rolled back
 */
export async function withTransaction<T>(
  fn: (client: {
    query: <R>(sql: string, params?: unknown[]) => Promise<R[]>;
    queryOne: <R>(sql: string, params?: unknown[]) => Promise<R | undefined>;
    execute: (sql: string, params?: unknown[]) => Promise<{ rowCount: number }>;
  }) => Promise<T>
): Promise<T> {
  const client = await requirePool().connect();
  try {
    await client.query('BEGIN');
    
    const result = await fn({
      query: async <R>(sql: string, params: unknown[] = []): Promise<R[]> => {
        const res = await client.query(sql, params);
        return res.rows as R[];
      },
      queryOne: async <R>(sql: string, params: unknown[] = []): Promise<R | undefined> => {
        const res = await client.query(sql, params);
        return res.rows[0] as R | undefined;
      },
      execute: async (sql: string, params: unknown[] = []): Promise<{ rowCount: number }> => {
        const res = await client.query(sql, params);
        return { rowCount: res.rowCount || 0 };
      },
    });
    
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function isPostgres(): true {
  return true;
}
