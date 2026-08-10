const Database = require("better-sqlite3");
const db = new Database("camaras.db");

console.log("✅ SQLite conectado");

/* =========================
TABLA HISTORIAL
========================= */
db.prepare(`
CREATE TABLE IF NOT EXISTS historial (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT,
    data TEXT
)
`).run();

/* =========================
TABLA COORDENADAS
========================= */
db.prepare(`
CREATE TABLE IF NOT EXISTS coordenadas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT UNIQUE,
    lat REAL,
    lng REAL
)
`).run();
/* =========================
TABLA COORDENADAS
     MAPA
========================= */
db.prepare(`
CREATE TABLE IF NOT EXISTS estado_actual (
    nombre TEXT PRIMARY KEY,
    estado TEXT,
    latencia TEXT,
    fecha TEXT
)
`).run();

module.exports = db;