const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('nuba.db');

// Add dimensions to existing 'Chica' and 'Mediana' variants
db.prepare("UPDATE product_variants SET dimensions = '8 × 8 cm' WHERE value = 'Chica'").run();
db.prepare("UPDATE product_variants SET dimensions = '12 × 12 cm' WHERE value = 'Mediana'").run();

console.log("Variantes actualizadas.");
