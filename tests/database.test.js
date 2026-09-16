const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { toPostgres } = require('../db');

test('traduce parámetros SQLite a PostgreSQL manteniendo su orden', () => {
  assert.equal(
    toPostgres('UPDATE products SET stock=stock-? WHERE id=?'),
    'UPDATE products SET stock=stock-$1 WHERE id=$2',
  );
});

test('la migración crea las restricciones esenciales para pedidos y catálogo', () => {
  const schema = fs.readFileSync('migrations/001_initial.sql', 'utf8');
  for (const fragment of [
    'CREATE TABLE IF NOT EXISTS products',
    'CREATE TABLE IF NOT EXISTS orders',
    'quantity INTEGER NOT NULL CHECK (quantity > 0)',
    'REFERENCES products(id) ON DELETE CASCADE',
    'products_active_sort_idx',
  ]) assert.match(schema, new RegExp(fragment.replace(/[()]/g, '\\$&')));
});
