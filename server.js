const express = require("express");
const app = express();
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");

require("./db");
const Historial = require("./models/Historial");

const { analizarCamaras, analizarTodasLasCamaras } = require("./index.js");

// =============================
// PROGRESO
// =============================
let progreso = {
  total: 0,
  procesadas: 0,
  online: 0,
  sinRespuesta: 0,
  ipVacia: 0,
  noEncontrada: 0,
};

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
// RESET
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
// ANALIZAR TEXTO (NO GUARDA HISTORIAL)
// =============================
app.post("/analizar", async (req, res) => {
  try {
    resetProgreso();

    const texto = req.body.texto;

    const lista = texto
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);

    const { ruta, resultado } = await analizarCamaras(lista, progreso);

    console.log("📦 Resultado:", resultado?.length);
    console.log("🧪 Primera:", resultado?.[0]);

    // ✅ GUARDAR EN MONGO (IGUAL QUE ANALIZAR TODAS)
    await Historial.create({
      fecha: new Date(),
      camaras: resultado.map((c) => ({
        DENOMINACION: c.DENOMINACION,
        ESTADO: c.ESTADO,
        PROVEEDOR: c.PROVEEDOR || "-",
        UBICACION: c.UBICACION || "-",
        CONEXION: c.CONEXION || "-",
        IP: c.IP || "-",
      })),
    });

    console.log("✅ Guardado desde analizar texto");

    res.download(ruta, () => fs.unlink(ruta, () => {}));
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

// =============================
// ANALIZAR TODAS (GUARDA HISTORIAL)
// =============================
app.get("/analizar-todas", async (req, res) => {
  try {
    resetProgreso();

    const { ruta, resultado } = await analizarTodasLasCamaras(progreso);

    console.log("📦 Primera cámara:", resultado[0]);

    // ✅ GUARDAR BIEN EN MONGO
    await Historial.create({
      fecha: new Date(),
      camaras: resultado.map((c) => ({
        DENOMINACION: c.DENOMINACION,
        ESTADO: c.ESTADO,
        PROVEEDOR: c.PROVEEDOR || "-",
        UBICACION: c.UBICACION || "-",
        CONEXION: c.CONEXION || "-",
        IP: c.IP || "-",
      })),
    });

    console.log("✅ Guardado en Mongo OK");

    res.download(ruta, () => fs.unlink(ruta, () => {}));
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

// =============================
// HISTORIAL
// =============================
app.get("/historial", async (req, res) => {
  try {
    const historiales = await Historial.find().sort({ fecha: 1 });

    const mapa = {};
    const fechasSet = new Set();

    historiales.forEach((h) => {
      const fechaObj = new Date(h.fecha);

      const fecha = fechaObj.toLocaleDateString("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });

      fechasSet.add(fecha);

      h.camaras.forEach((cam) => {
        if (!mapa[cam.DENOMINACION]) {
  mapa[cam.DENOMINACION] = {
    info: {
      proveedor: cam.PROVEEDOR || "",
      ubicacion: cam.UBICACION || "",
      conexion: cam.CONEXION || "",
      ip: cam.IP || "",
    },
    estados: {},
  };
} else {
  // 🔥 SI YA EXISTE, ACTUALIZA SI VIENE INFORMACIÓN NUEVA
  if (cam.PROVEEDOR) {
    mapa[cam.DENOMINACION].info.proveedor = cam.PROVEEDOR;
  }
  if (cam.UBICACION) {
    mapa[cam.DENOMINACION].info.ubicacion = cam.UBICACION;
  }
  if (cam.CONEXION) {
    mapa[cam.DENOMINACION].info.conexion = cam.CONEXION;
  }
  if (cam.IP) {
    mapa[cam.DENOMINACION].info.ip = cam.IP;
  }
}

        mapa[cam.DENOMINACION].estados[fecha] = cam.ESTADO;
      });
    });

    const fechas = Array.from(fechasSet).sort((a, b) => {
      const fechaA = new Date(a.split("/").reverse().join("-"));
      const fechaB = new Date(b.split("/").reverse().join("-"));
      return fechaA - fechaB;
    });

    res.json({ fechas, camaras: mapa });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error historial");
  }
});

// =============================
// HOME
// =============================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// =============================
// SERVER
// =============================
app.listen(3000, () => {
  const url = "http://localhost:3000";
  console.log(url);

  setTimeout(() => {
    exec(`start ${url}`);
  }, 500);
});