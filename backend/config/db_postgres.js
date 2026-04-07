const { Pool } = require('pg');
require('dotenv').config();

/**
 * PostgreSQL Connection Pool for Supabase
 * Configuration for Sharda Research Portal Analytics
 */
const pool = new Pool({
  user: 'postgres.fyzesotbpwgcrqjveuxh',
  host: 'aws-0-ap-south-1.pooler.supabase.com',
  database: 'postgres',
  password: 'Arghadeep@15',
  port: 5432,
  // Supabase/PostgreSQL often requires SSL for external connections
  ssl: {
    rejectUnauthorized: false
  },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test connection on startup
pool.on('connect', () => {
  console.log('[POSTGRES] New client connected to Supabase');
});

pool.on('error', (err) => {
  console.error('[POSTGRES] Unexpected error on idle client', err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool: pool
};
