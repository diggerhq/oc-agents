#!/usr/bin/env node
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const agentId = process.argv[2] || '48a02c61-13f1-42d5-be30-c1b557dec92f';

async function check() {
  try {
    const agent = await pool.query(
      'SELECT id, agent_type, repo_url, repo_name, organization_id FROM sessions WHERE id = $1',
      [agentId]
    );
    console.log('Agent:', agent.rows[0]);
    
    const buckets = await pool.query(
      `SELECT ab.*, b.name as bucket_name 
       FROM agent_buckets ab 
       JOIN buckets b ON b.id = ab.bucket_id 
       WHERE ab.session_id = $1`,
      [agentId]
    );
    console.log('Attached buckets:', buckets.rows);
    
    // Also check if org has a default bucket
    if (agent.rows[0]?.organization_id) {
      const orgBucket = await pool.query(
        `SELECT * FROM buckets WHERE organization_id = $1 AND name = 'Files'`,
        [agent.rows[0].organization_id]
      );
      console.log('Org default bucket:', orgBucket.rows[0]);
    }
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}

check();
