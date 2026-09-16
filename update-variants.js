require('dotenv').config();
const { createDatabase } = require('./db');

(async () => {
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL.');
  const db = createDatabase(process.env.DATABASE_URL);

  // Add dimensions to existing 'Chica' and 'Mediana' variants
  await db.run("UPDATE product_variants SET dimensions = '8 × 8 cm' WHERE value = 'Chica'");
  await db.run("UPDATE product_variants SET dimensions = '12 × 12 cm' WHERE value = 'Mediana'");
  await db.close();
  console.log("Variantes actualizadas.");
})();
