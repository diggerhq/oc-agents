import { migrations, Migration } from './index.js';

// Migration runner for SQLite and PostgreSQL
// Tracks applied migrations and runs pending ones

interface MigrationRecord {
  id: number;
  name: string;
  applied_at: string;
}

export async function runMigrations(
  execute: (sql: string, params?: unknown[]) => Promise<any>,
  query: <T>(sql: string, params?: unknown[]) => Promise<T[]>
): Promise<{ applied: string[]; skipped: string[] }> {
  const applied: string[] = [];
  const skipped: string[] = [];

  // Postgres-only migrations tracking table
  await execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Get already applied migrations
  const appliedMigrations = await query<MigrationRecord>(
    'SELECT id, name, applied_at FROM _migrations ORDER BY id'
  );
  const appliedIds = new Set(appliedMigrations.map((m) => m.id));

  console.log(`[Migrations] Found ${appliedMigrations.length} previously applied migrations`);

  // Run pending migrations in order
  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) {
      skipped.push(migration.name);
      continue;
    }

    console.log(`[Migrations] Applying migration ${migration.id}: ${migration.name}...`);

    try {
      const sql = migration.up;
      
      // Split by semicolon and execute each statement
      // This handles multi-statement migrations
      const statements = sql
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const statement of statements) {
        try {
          await execute(statement);
        } catch (err: any) {
          // Ignore "already exists" errors for CREATE TABLE IF NOT EXISTS
          if (
            err.message?.includes('already exists') ||
            err.message?.includes('SQLITE_ERROR: table') ||
            err.code === '42P07' // PostgreSQL: relation already exists
          ) {
            console.log(`[Migrations] Skipping (already exists): ${statement.slice(0, 50)}...`);
            continue;
          }
          throw err;
        }
      }

      // Record the migration
      await execute('INSERT INTO _migrations (id, name) VALUES ($1, $2)', [
        migration.id,
        migration.name,
      ]);

      applied.push(migration.name);
      console.log(`[Migrations] ✓ Applied migration ${migration.id}: ${migration.name}`);
    } catch (error) {
      console.error(`[Migrations] ✗ Failed to apply migration ${migration.id}: ${migration.name}`);
      console.error(error);
      throw error;
    }
  }

  if (applied.length === 0) {
    console.log('[Migrations] Database is up to date');
  } else {
    console.log(`[Migrations] Applied ${applied.length} new migration(s)`);
  }

  return { applied, skipped };
}

export async function rollbackMigration(
  execute: (sql: string, params?: unknown[]) => Promise<any>,
  query: <T>(sql: string, params?: unknown[]) => Promise<T[]>,
  migrationId?: number
): Promise<{ rolledBack: string | null }> {
  // Get the latest applied migration if no specific ID provided
  const appliedMigrations = await query<MigrationRecord>(
    'SELECT id, name FROM _migrations ORDER BY id DESC LIMIT 1'
  );

  if (appliedMigrations.length === 0) {
    console.log('[Migrations] No migrations to rollback');
    return { rolledBack: null };
  }

  const targetId = migrationId ?? appliedMigrations[0].id;
  const migration = migrations.find((m) => m.id === targetId);

  if (!migration) {
    console.error(`[Migrations] Migration ${targetId} not found`);
    return { rolledBack: null };
  }

  console.log(`[Migrations] Rolling back migration ${migration.id}: ${migration.name}...`);

  try {
    const sql = migration.down;
    
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      await execute(statement);
    }

    await execute('DELETE FROM _migrations WHERE id = $1', [migration.id]);

    console.log(`[Migrations] ✓ Rolled back migration ${migration.id}: ${migration.name}`);
    return { rolledBack: migration.name };
  } catch (error) {
    console.error(`[Migrations] ✗ Failed to rollback migration ${migration.id}`);
    throw error;
  }
}

export async function getMigrationStatus(
  query: <T>(sql: string, params?: unknown[]) => Promise<T[]>
): Promise<{ pending: Migration[]; applied: MigrationRecord[] }> {
  let applied: MigrationRecord[] = [];
  
  try {
    applied = await query<MigrationRecord>(
      'SELECT id, name, applied_at FROM _migrations ORDER BY id'
    );
  } catch {
    // Table doesn't exist yet
    applied = [];
  }

  const appliedIds = new Set(applied.map((m) => m.id));
  const pending = migrations.filter((m) => !appliedIds.has(m.id));

  return { pending, applied };
}
