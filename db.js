const Database = require("better-sqlite3");
const path = require("path");

// =============================
// CARPETA REAL DEL PROGRAMA
// =============================
//
// Con Node normal:
//   usa __dirname
//
// Compilado con pkg:
//   usa la carpeta donde está el .exe
//
const baseDir = process.pkg
  ? path.dirname(process.execPath)
  : __dirname;

const rutaDB = path.join(
  baseDir,
  "camaras.db"
);

console.log("📂 Base SQLite:", rutaDB);

// =============================
// ABRIR BASE
// =============================

const db = new Database(rutaDB);

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
TABLA ESTADO ACTUAL
========================= */

db.prepare(`
CREATE TABLE IF NOT EXISTS estado_actual (
    nombre TEXT PRIMARY KEY,
    estado TEXT,
    latencia TEXT,
    fecha TEXT
)
`).run();
/* =========================
TABLA USUARIOS
========================= */

db.prepare(`
CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    rol TEXT NOT NULL DEFAULT 'OPERADOR',
    activo INTEGER NOT NULL DEFAULT 1,
    fecha_creacion TEXT NOT NULL
)
`).run();
// =============================
// OBSERVACIONES DE CAMARAS
// =============================

db.prepare(`
CREATE TABLE IF NOT EXISTS observaciones_camaras (
    nombre TEXT PRIMARY KEY,
    observacion TEXT NOT NULL DEFAULT '',
    fecha_modificacion TEXT,
    usuario_modificacion TEXT
)
`).run();

// MIGRACIÓN - situación especial de la cámara
const columnasObservaciones = db
  .prepare(`PRAGMA table_info(observaciones_camaras)`)
  .all();

const tieneSituacion = columnasObservaciones.some(
  (col) => col.name === "situacion"
);

if (!tieneSituacion) {
  db.prepare(`
    ALTER TABLE observaciones_camaras
    ADD COLUMN situacion TEXT NOT NULL DEFAULT ''
  `).run();

  console.log("✅ Columna situacion agregada a observaciones_camaras");
}

// =============================
// ADMIN INICIAL
// =============================

const bcrypt = require("bcryptjs");

const cantidadUsuarios = db
  .prepare(`
    SELECT COUNT(*) AS total
    FROM usuarios
  `)
  .get();

if (cantidadUsuarios.total === 0) {

  const passwordInicial = "admin123";

  const passwordHash =
    bcrypt.hashSync(passwordInicial, 12);

  db.prepare(`
    INSERT INTO usuarios (
      usuario,
      nombre,
      password_hash,
      rol,
      activo,
      fecha_creacion
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "admin",
    "Administrador",
    passwordHash,
    "ADMIN",
    1,
    new Date().toISOString()
  );

  console.log(
    "👤 Usuario administrador inicial creado"
  );

  console.log(
    "   Usuario: admin"
  );

  console.log(
    "   Contraseña temporal: admin123"
  );
}

module.exports = db;