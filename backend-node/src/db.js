import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'smartdialer',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  waitForConnections: true,
  connectionLimit: 30,
  queueLimit: 0,
  dateStrings: true
});

/**
 * Execute a query with parameters
 */
export async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

/**
 * Execute a query returning first row
 */
export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Run operations inside an ACID MySQL transaction
 */
export async function withTransaction(fn) {
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Seed database with agents, borrowers, and campaign settings
 */
export async function seedData(agentCount = 50, borrowerCount = 300) {
  // Campaign defaults
  const defaults = [
    ['mode', 'PROGRESSIVE'],
    ['target_abandonment_rate', '0.03'],
    ['avg_answer_rate', '0.35'],
    ['avg_talk_time_sec', '90'],
    ['active_provider', 'PROVIDER_A'],
    ['is_running', '1']
  ];

  for (const [key, val] of defaults) {
    await query(
      'INSERT INTO campaign_config (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = `value`;',
      [key, val]
    );
  }

  // Seed Agents if empty
  const [agentCountRow] = await query('SELECT COUNT(*) as cnt FROM agents;');
  if (agentCountRow.cnt === 0) {
    const agentValues = [];
    for (let i = 1; i <= agentCount; i++) {
      const id = `agent_${String(i).padStart(3, '0')}`;
      agentValues.push([id, `Agent ${i}`, 'AVAILABLE', 1]);
    }
    await pool.query(
      'INSERT INTO agents (id, name, state, version) VALUES ?;',
      [agentValues]
    );
    console.log(`[MySQL] Seeded ${agentCount} agents.`);
  }

  // Seed Borrowers if empty
  const [borrowerCountRow] = await query('SELECT COUNT(*) as cnt FROM borrowers;');
  if (borrowerCountRow.cnt === 0) {
    const borrowerValues = [];
    for (let i = 1; i <= borrowerCount; i++) {
      const id = `bor_${String(i).padStart(4, '0')}`;
      const phone = `+1-555-${String(i % 900 + 100).padStart(3, '0')}`;
      const priority = (i % 5) + 1;
      borrowerValues.push([id, `Customer ${i}`, phone, priority, 'UNPROCESSED', 1]);
    }
    await pool.query(
      'INSERT INTO borrowers (id, name, phone, priority, state, version) VALUES ?;',
      [borrowerValues]
    );
    console.log(`[MySQL] Seeded ${borrowerCount} borrowers.`);
  }
}

/**
 * Reset and re-seed tables
 */
export async function resetDatabase() {
  await query('SET FOREIGN_KEY_CHECKS = 0;');
  await query('TRUNCATE TABLE safety_decisions;');
  await query('TRUNCATE TABLE events_log;');
  await query('TRUNCATE TABLE calls;');
  await query('TRUNCATE TABLE agents;');
  await query('TRUNCATE TABLE borrowers;');
  await query('SET FOREIGN_KEY_CHECKS = 1;');
  await seedData(50, 300);
}
