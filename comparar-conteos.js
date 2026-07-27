const db = require("./db");
const { normalizarNombre } = require("./normalizar");

// 1) Nombres vistos en el historial (lo que cuenta index.html y mapa.html)
const rows = db.prepare("SELECT data FROM historial").all();
const vistosEnHistorial = new Set();

rows.forEach((h) => {
  let camaras;
  try {
    camaras = JSON.parse(h.data);
  } catch {
    return;
  }
  camaras.forEach((cam) => {
    if (!cam.DENOMINACION) return;
    vistosEnHistorial.add(normalizarNombre(cam.DENOMINACION));
  });
});

// 2) Nombres en la tabla coordenadas (lo que cuenta admin-coords.html)
const coords = db.prepare("SELECT nombre FROM coordenadas").all();
const enCoordenadas = new Set(coords.map((c) => c.nombre));

console.log("Distintas en historial:", vistosEnHistorial.size);
console.log("Filas en coordenadas:", enCoordenadas.size);
console.log("");

console.log("=== En 'coordenadas' pero NUNCA vistas en el historial ===");
let sobran = 0;
enCoordenadas.forEach((n) => {
  if (!vistosEnHistorial.has(n)) {
    console.log(" -", n);
    sobran++;
  }
});
console.log("Total:", sobran);

console.log("");
console.log("=== Vistas en el historial pero SIN fila en 'coordenadas' ===");
let faltan = 0;
vistosEnHistorial.forEach((n) => {
  if (!enCoordenadas.has(n)) {
    console.log(" -", n);
    faltan++;
  }
});
console.log("Total:", faltan);