const { Pool } = require('pg');

// Supabase ofrece PostgreSQL administrado. Esta capa conserva la interfaz que
// usaba la app, pero nunca vuelve a crear una base local en producción.
const toPostgres = (sql) => {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
};

class Database {
  constructor(connectionString, client = null) {
    this.client = client;
    if (client) this.pool = null;
    else if (connectionString === 'pgmem') {
      const { newDb } = require('pg-mem');
      const memory = newDb({ autoCreateForeignKeyIndices: true });
      const MemoryPool = memory.adapters.createPg().Pool;
      this.pool = new MemoryPool();
    } else this.pool = new Pool({
      connectionString,
      ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
    });
  }

  async query(sql, values = []) {
    return (this.client || this.pool).query(toPostgres(sql), values);
  }

  async all(sql, ...values) {
    return (await this.query(sql, values)).rows;
  }

  async get(sql, ...values) {
    return (await this.query(sql, values)).rows[0];
  }

  async run(sql, ...values) {
    const insert = /^\s*insert\s+into\s+/i.test(sql);
    const statement = insert && !/\breturning\b/i.test(sql) ? `${sql} RETURNING id` : sql;
    const result = await this.query(statement, values);
    return { lastID: result.rows[0]?.id, changes: result.rowCount };
  }

  async exec(sql) {
    return this.query(sql);
  }

  async prepare(sql) {
    return { run: (...values) => this.run(sql, ...values), finalize: async () => {} };
  }

  async close() {
    await this.pool.end();
  }

  async transaction(work) {
    const client = await this.pool.connect();
    const transaction = new Database(null, client);
    try {
      await client.query('BEGIN');
      const result = await work(transaction);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

const createDatabase = (connectionString) => new Database(connectionString);
module.exports = { createDatabase, toPostgres };
