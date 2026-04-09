#!/usr/bin/env node
import 'dotenv/config';
import { runMigrations, rollbackMigration, getMigrationStatus } from './runner.js';
import { migrations } from './index.js';
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required (Postgres-only mode).');
}

console.log('[Migrations CLI] Using PostgreSQL');

let pgPool: pg.Pool | null = null;

async function initPostgres() {
  const { Pool } = pg;

  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  console.log('[Migrations CLI] Connected to PostgreSQL');
}

function requirePool(): pg.Pool {
  if (!pgPool) throw new Error('PostgreSQL not initialized');
  return pgPool;
}

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await requirePool().query(sql, params);
  return result.rows as T[];
}

async function execute(sql: string, params: unknown[] = []): Promise<{ rowCount: number }> {
  const result = await requirePool().query(sql, params);
  return { rowCount: result.rowCount || 0 };
}

async function close() {
  if (pgPool) await pgPool.end();
}

// ============================================
// CLI Commands
// ============================================

async function main() {
  const command = process.argv[2] || 'status';
  
  try {
    // Initialize database connection
    await initPostgres();
    
    switch (command) {
      case 'up':
      case 'migrate': {
        console.log('\n📦 Running migrations...\n');
        const result = await runMigrations(execute, query);
        
        if (result.applied.length > 0) {
          console.log('\n✅ Applied migrations:');
          result.applied.forEach(name => console.log(`   - ${name}`));
        }
        if (result.skipped.length > 0) {
          console.log(`\n⏭️  Skipped ${result.skipped.length} already applied migration(s)`);
        }
        break;
      }
      
      case 'down':
      case 'rollback': {
        const migrationId = process.argv[3] ? parseInt(process.argv[3]) : undefined;
        console.log(`\n⏪ Rolling back ${migrationId ? `migration ${migrationId}` : 'latest migration'}...\n`);
        const result = await rollbackMigration(execute, query, migrationId);
        
        if (result.rolledBack) {
          console.log(`\n✅ Rolled back: ${result.rolledBack}`);
        } else {
          console.log('\n⚠️  Nothing to rollback');
        }
        break;
      }
      
      case 'status': {
        console.log('\n📊 Migration Status\n');
        const status = await getMigrationStatus(query);
        
        console.log('Available migrations:');
        migrations.forEach(m => {
          const applied = status.applied.find(a => a.id === m.id);
          const icon = applied ? '✅' : '⏳';
          const appliedAt = applied ? ` (applied ${new Date(applied.applied_at).toLocaleString()})` : '';
          console.log(`   ${icon} ${m.id}: ${m.name}${appliedAt}`);
        });
        
        if (status.pending.length > 0) {
          console.log(`\n⚠️  ${status.pending.length} pending migration(s). Run 'npm run migrate' to apply.`);
        } else {
          console.log('\n✅ Database is up to date!');
        }
        break;
      }
      
      case 'list': {
        console.log('\n📋 All migrations:\n');
        migrations.forEach(m => {
          console.log(`   ${m.id}: ${m.name}`);
        });
        break;
      }
      
      default:
        console.log(`
Migration CLI

Usage:
  npm run migrate           Run all pending migrations
  npm run migrate:status    Show migration status
  npm run migrate:rollback  Rollback the last migration
  npm run migrate:rollback [id]  Rollback a specific migration

Commands:
  up, migrate     Run pending migrations
  down, rollback  Rollback migrations
  status          Show migration status
  list            List all migrations
        `);
    }
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  } finally {
    await close();
  }
}

main();
