require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { createDatabase } = require('../db');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Falta DATABASE_URL en .env. Copiá la URI de conexión de Supabase antes de migrar.');

const tables = ['categories', 'products', 'product_variants', 'product_images', 'orders', 'order_items', 'settings'];

async function copyTable(source, target, table) {
  const rows = await source.all(`SELECT * FROM ${table}`);
  if (!rows.length) return 0;
  const columns = Object.keys(rows[0]);
  const fields = columns.map((_, index) => `$${index + 1}`).join(',');
  const primaryKey = table === 'settings' ? 'key' : 'id';
  const update = columns.filter(c => c !== primaryKey).map(c => `${c}=EXCLUDED.${c}`).join(',');
  const override = primaryKey === 'id' ? ' OVERRIDING SYSTEM VALUE' : '';
  const sql = `INSERT INTO ${table} (${columns.join(',')})${override} VALUES (${fields}) ON CONFLICT (${primaryKey}) DO UPDATE SET ${update}`;
  for (const row of rows) await target.query(sql, columns.map(column => row[column]));
  return rows.length;
}

async function resetSequences(target) {
  for (const table of tables.filter(t => t !== 'settings')) {
    await target.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1), true)`);
  }
}

(async () => {
  const sourcePath = path.join(__dirname, '..', 'nuba.db');
  if (!fs.existsSync(sourcePath)) throw new Error('No se encontró nuba.db para importar.');
  const source = await open({ filename: sourcePath, driver: sqlite3.Database });
  const target = createDatabase(databaseUrl);
  await target.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_initial.sql'), 'utf8'));
  const copied = {};
  for (const table of tables) copied[table] = await copyTable(source, target, table);
  await resetSequences(target);
  await source.close();
  await target.close();
  console.log('Migración completada:', copied);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
