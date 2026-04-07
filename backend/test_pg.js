const pg = require('./config/db_postgres');

async function testPostgres() {
  try {
    console.log('Testing PostgreSQL connection...');
    const res = await pg.query('SELECT NOW()');
    console.log('PostgreSQL connected successfully at:', res.rows[0].now);
    
    console.log('Checking/Creating table...');
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS department_api_stats (
        id SERIAL PRIMARY KEY,
        department VARCHAR(255) UNIQUE NOT NULL,
        author_count INTEGER DEFAULT 0,
        total_papers INTEGER DEFAULT 0,
        top_author_name VARCHAR(255),
        top_author_papers INTEGER DEFAULT 0,
        last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await pg.query(createTableQuery);
    console.log('Table "department_api_stats" is ready.');
    
    process.exit(0);
  } catch (err) {
    console.error('PostgreSQL test failed:', err.message);
    process.exit(1);
  }
}

testPostgres();
