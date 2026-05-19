const db = require("./db");

console.log("HISTORIAL:");
console.log(
  db.prepare("PRAGMA table_info(historial)").all()
);

console.log("COORDENADAS:");
console.log(
  db.prepare("PRAGMA table_info(coordenadas)").all()
);