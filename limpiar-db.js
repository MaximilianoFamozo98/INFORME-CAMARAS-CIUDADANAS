const db = require("./db");
console.log(
db.prepare("SELECT COUNT(*) as total FROM coordenadas").get()
);