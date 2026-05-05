const Database = require("better-sqlite3");

const db = new Database("camaras.db");

db.exec(`
CREATE TABLE IF NOT EXISTS historial (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  data TEXT NOT NULL
);
`);

console.log("✅ SQLite conectado");

module.exports = db;