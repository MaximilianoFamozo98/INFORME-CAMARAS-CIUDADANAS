const db = require("./db");

/* =========================
NORMALIZADOR
========================= */

function normalizarNombre(txt){

if(!txt) return "";

return txt
.toUpperCase()

.normalize("NFD")
.replace(/[\u0300-\u036f]/g,"")

.replace(/\(.*?\)/g," ")
.replace(/FIJA\s*\d*/g," ")
.replace(/DOMO/g," ")
.replace(/INTERCOMUNICADOR/g," ")

// DJO
.replace(/^DJ\s*O?\s*(\d{1,2})$/,"DJO $1")
.replace(/^DJO\s*O?\s*(\d{1,2})$/,"DJO $1")

// corregir O6
.replace(/\bO(\d)\b/g,"0$1")

// símbolos
.replace(/[-_/]/g," ")
.replace(/\./g," ")

// separar letras/numeros
.replace(/([A-Z])(\d)/g,"$1 $2")
.replace(/(\d)([A-Z])/g,"$1 $2")

// cero adelante
.replace(/\b([A-Z]{2,10})\s(\d)\b/g,"$1 0$2")

// espacios
.replace(/\s+/g," ")
.trim();

}

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