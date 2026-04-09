#!/usr/bin/env node
/**
 * Migration script to create default "Files" buckets for all existing organizations
 * and attach them to all existing TASK agents (not code agents, which have repos).
 * 
 * Run against production: 
 *   fly ssh console -a primeintuition -C "node /app/scripts/migrate-default-buckets.mjs"
 * 
 * Or locally for testing:
 *   DATABASE_URL="your-db-url" node scripts/migrate-default-buckets.mjs
 */

import pg from 'pg';
import { v4 as uuidv4 } from 'uuid';

const { Pool } = pg;

const DEFAULT_BUCKET_NAME = 'Files';

async function migrate() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
  });

  console.log('[Migration] Starting default bucket migration for TASK agents...');

  try {
    // Step 1: Get all organizations
    const orgsResult = await pool.query(`
      SELECT o.id as org_id, o.name as org_name, o.owner_id 
      FROM organizations o
      ORDER BY o.created_at ASC
    `);
    
    console.log(`[Migration] Found ${orgsResult.rows.length} organizations`);
    
    let bucketsCreated = 0;
    let bucketsSkipped = 0;
    let attachmentsCreated = 0;
    let attachmentsSkipped = 0;
    let codeAgentsSkipped = 0;

    for (const org of orgsResult.rows) {
      const { org_id, org_name, owner_id } = org;
      
      // Check if default bucket already exists for this org
      const existingBucket = await pool.query(`
        SELECT id FROM buckets 
        WHERE organization_id = $1 AND name = $2
      `, [org_id, DEFAULT_BUCKET_NAME]);
      
      let bucketId;
      
      if (existingBucket.rows.length > 0) {
        bucketId = existingBucket.rows[0].id;
        bucketsSkipped++;
        console.log(`  [Skip] Org "${org_name}" already has default bucket`);
      } else {
        // Create the default bucket
        bucketId = uuidv4();
        await pool.query(`
          INSERT INTO buckets (id, user_id, organization_id, name, description)
          VALUES ($1, $2, $3, $4, $5)
        `, [bucketId, owner_id, org_id, DEFAULT_BUCKET_NAME, 'Default file bucket for task agents']);
        
        bucketsCreated++;
        console.log(`  [Created] Default bucket for org "${org_name}"`);
      }
      
      // Step 2: Attach bucket to all TASK agents in this org that don't have it
      // Code agents have repos, so they don't need the default file bucket
      const agentsResult = await pool.query(`
        SELECT s.id as session_id, s.repo_name, s.agent_type
        FROM sessions s
        WHERE s.organization_id = $1
      `, [org_id]);
      
      for (const agent of agentsResult.rows) {
        const { session_id, repo_name, agent_type } = agent;
        
        // Skip code agents - they have repos
        if (agent_type === 'code') {
          codeAgentsSkipped++;
          continue;
        }
        
        // Check if already attached
        const existingAttachment = await pool.query(`
          SELECT id FROM agent_buckets 
          WHERE session_id = $1 AND bucket_id = $2
        `, [session_id, bucketId]);
        
        if (existingAttachment.rows.length > 0) {
          attachmentsSkipped++;
        } else {
          // Attach the bucket
          const attachmentId = uuidv4();
          await pool.query(`
            INSERT INTO agent_buckets (id, session_id, bucket_id, mount_path, read_only)
            VALUES ($1, $2, $3, $4, $5)
          `, [attachmentId, session_id, bucketId, '/home/user/workspace/files', false]);
          
          attachmentsCreated++;
          console.log(`    [Attached] Bucket to task agent "${repo_name || session_id}"`);
        }
      }
    }
    
    // Also handle agents without an organization (legacy/personal)
    console.log('[Migration] Checking agents without organization...');
    
    const noOrgAgentsResult = await pool.query(`
      SELECT s.id as session_id, s.user_id, s.repo_name, s.agent_type
      FROM sessions s
      WHERE s.organization_id IS NULL
    `);
    
    for (const agent of noOrgAgentsResult.rows) {
      const { session_id, user_id, repo_name, agent_type } = agent;
      
      // Skip code agents - they have repos
      if (agent_type === 'code') {
        codeAgentsSkipped++;
        continue;
      }
      
      // Get or create bucket for this user (no org)
      let bucketResult = await pool.query(`
        SELECT id FROM buckets 
        WHERE user_id = $1 AND organization_id IS NULL AND name = $2
      `, [user_id, DEFAULT_BUCKET_NAME]);
      
      let bucketId;
      if (bucketResult.rows.length > 0) {
        bucketId = bucketResult.rows[0].id;
      } else {
        bucketId = uuidv4();
        await pool.query(`
          INSERT INTO buckets (id, user_id, organization_id, name, description)
          VALUES ($1, $2, NULL, $3, $4)
        `, [bucketId, user_id, DEFAULT_BUCKET_NAME, 'Default file bucket for task agents']);
        bucketsCreated++;
        console.log(`  [Created] Default bucket for user ${user_id} (no org)`);
      }
      
      // Check if already attached
      const existingAttachment = await pool.query(`
        SELECT id FROM agent_buckets 
        WHERE session_id = $1 AND bucket_id = $2
      `, [session_id, bucketId]);
      
      if (existingAttachment.rows.length === 0) {
        const attachmentId = uuidv4();
        await pool.query(`
          INSERT INTO agent_buckets (id, session_id, bucket_id, mount_path, read_only)
          VALUES ($1, $2, $3, $4, $5)
        `, [attachmentId, session_id, bucketId, '/home/user/workspace/files', false]);
        
        attachmentsCreated++;
        console.log(`    [Attached] Bucket to task agent "${repo_name || session_id}" (no org)`);
      } else {
        attachmentsSkipped++;
      }
    }

    console.log('\n[Migration] Summary:');
    console.log(`  Buckets created: ${bucketsCreated}`);
    console.log(`  Buckets skipped (already existed): ${bucketsSkipped}`);
    console.log(`  Attachments created: ${attachmentsCreated}`);
    console.log(`  Attachments skipped (already existed): ${attachmentsSkipped}`);
    console.log(`  Code agents skipped (have repos): ${codeAgentsSkipped}`);
    console.log('[Migration] Complete!');

  } catch (error) {
    console.error('[Migration] Error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
