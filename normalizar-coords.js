const db = require("./db");
const { normalizarNombre } = require("./normalizar");

/* =========================
NORMALIZADOR
========================= */



/* =========================
NORMALIZAR SQLITE
========================= */

const rows = db
.prepare("SELECT * FROM coordenadas")
.all();

let cambios = 0;

rows.forEach(r=>{

const nuevo = normalizarNombre(r.nombre);

if(nuevo !== r.nombre){

console.log(r.nombre,"=>",nuevo);

db.prepare(`
UPDATE coordenadas
SET nombre = ?
WHERE id = ?
`).run(nuevo,r.id);

cambios++;

}

});

console.log("");
console.log("✅ Cambios:",cambios);