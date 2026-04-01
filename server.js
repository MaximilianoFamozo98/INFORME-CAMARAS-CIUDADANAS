const express = require("express");
const app = express();
const path = require("path");
const fs = require("fs");

let progreso = {
  total: 0,
  procesadas: 0,
  online: 0,
  sinRespuesta: 0,
  ipVacia: 0,
  noEncontrada: 0,
};

const {
  analizarCamaras,
  analizarTodasLasCamaras,
} = require("./index.js");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// =============================
// PROGRESO
// =============================
app.get("/progreso", (req, res) => {
  res.json(progreso);
});

// =============================
// RESET PROGRESO
// =============================
function resetProgreso() {
  progreso.total = 0;
  progreso.procesadas = 0;
  progreso.online = 0;
  progreso.sinRespuesta = 0;
  progreso.ipVacia = 0;
  progreso.noEncontrada = 0;
}

// =============================
// ANALIZAR TEXTO
// =============================
app.post("/analizar", async (req, res) => {
  try {
    resetProgreso(); // 🔥 clave

    const texto = req.body.texto;

    const lista = texto
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);

    const ruta = await analizarCamaras(lista, progreso);

    res.download(ruta, () => fs.unlink(ruta, () => {}));
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

// =============================
// ANALIZAR TODAS
// =============================
app.get("/analizar-todas", async (req, res) => {
  try {
    resetProgreso(); // 🔥 clave

    const ruta = await analizarTodasLasCamaras(progreso);

    res.download(ruta, () => fs.unlink(ruta, () => {}));
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(3000, () => {
  console.log("http://localhost:3000");
});