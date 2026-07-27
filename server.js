const express = require("express");
const app = express();
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const db = require("./db");
const {
  analizarCamaras,
  analizarTodasLasCamaras,
  obtenerTodasLasCamarasExcel,
} = require("./index.js");
const { normalizarNombre } = require("./normalizar");

console.log("SERVER MODIFICADO OK");

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
// RESET PROGRESO
// =============================
function resetProgreso() {
  progreso = {
    total: 0,
    procesadas: 0,
    online: 0,
    sinRespuesta: 0,
    ipVacia: 0,
    noEncontrada: 0,
  };
}

// =============================
// RUTA PROGRESO
// =============================
app.get("/progreso", (req, res) => {
  res.json(progreso);
});

// =============================
// GUARDAR HISTORIAL SQLITE
// =============================
function guardarHistorial(resultado) {
  db.prepare(
    `
    INSERT INTO historial (fecha, data)
    VALUES (?, ?)
  `,
  ).run(new Date().toISOString(), JSON.stringify(resultado));

  console.log("✅ Historial guardado en SQLite");
}

// =============================
// ANALIZAR TEXTO
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

    guardarHistorial(resultado);

    res.download(ruta, () => {
      fs.unlink(ruta, () => {});
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error al analizar");
  }
});

// =============================
// ANALIZAR TODAS
// =============================
app.get("/analizar-todas", async (req, res) => {
  try {
    resetProgreso();

    const { ruta, resultado } = await analizarTodasLasCamaras(progreso);

    guardarHistorial(resultado);

    res.download(ruta, () => {
      fs.unlink(ruta, () => {});
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error al analizar todas");
  }
});

// =============================
// HISTORIAL
// =============================
app.get("/historial", (req, res) => {
  try {
    const rows = db
      .prepare(
        `
      SELECT * FROM historial
      ORDER BY fecha ASC
    `,
      )
      .all();

    const mapa = {};
    const fechasSet = new Set();

    rows.forEach((h) => {
      const fechaObj = new Date(h.fecha);

      const fecha = fechaObj.toLocaleDateString("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });

      fechasSet.add(fecha);

      const camaras = JSON.parse(h.data);

      camaras.forEach((cam) => {
        let nombre = normalizarNombre(cam.DENOMINACION);
        if (!mapa[nombre]) {
          // =========================
          // CREAR COORD VACIA SI NO EXISTE
          // =========================

          const existeCoord = db
            .prepare(
              `
    SELECT id
    FROM coordenadas
    WHERE UPPER(TRIM(nombre)) = ?
  `,
            )
            .get(nombre);

          if (!existeCoord) {
            console.log("⚠️ Cámara sin coordenadas:", nombre);
          }
          if (mapa[nombre]) {
            console.log("COLISION HISTORIAL:", nombre);
          }

          mapa[nombre] = {
            info: {
              proveedor: cam.PROVEEDOR || "",
              ubicacion: cam.UBICACION || "",
              conexion: cam.CONEXION || "",
              ip: cam.IP || "",
            },
            estados: {},
          };
        }

        mapa[nombre].estados[fecha] = cam.ESTADO;
      });
    });

    const fechas = Array.from(fechasSet).sort((a, b) => {
      const fa = new Date(a.split("/").reverse().join("-"));
      const fb = new Date(b.split("/").reverse().join("-"));
      return fa - fb;
    });

    res.json({
      fechas,
      camaras: mapa,
    });
  } catch (error) {
    console.error(error);
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
// MAPA
// =============================
app.get("/mapa", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "mapa.html"));
});

// =====================
// COORDENADAS
// =====================

// traer todas
// =====================
// TRAER COORDENADAS
// =====================
app.get("/api/coords", (req, res) => {
  try {
    const rows = db
      .prepare(
        `
SELECT
TRIM(UPPER(nombre)) as nombre,
lat,
lng
FROM coordenadas
ORDER BY nombre
`,
      )
      .all();

    res.json(rows);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: true });
  }
});

// guardar / editar
app.post("/api/coords", (req, res) => {
  try {
    const { nombre, lat, lng } = req.body;

    if (!lat || !lng || lat == 0 || lng == 0) {
      return res.status(400).json({
        error: "Coordenadas inválidas",
      });
    }

    db.prepare(
      `
      INSERT INTO coordenadas(nombre,lat,lng)
      VALUES(?,?,?)
      ON CONFLICT(nombre)
      DO UPDATE SET
      lat=?,
      lng=?
    `,
    ).run(nombre, lat, lng, lat, lng);

    res.json({ ok: true });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: true });
  }
});

app.delete("/api/coords/:nombre", (req, res) => {
  try {
    db.prepare(
      `
    DELETE FROM coordenadas
    WHERE nombre = ?
  `,
    ).run(req.params.nombre);

    res.json({ ok: true });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: true });
  }
});

//DEBUGSS//

// =============================
// SERVER
// =============================
app.listen(3000, () => {
  const url = "http://localhost:3000";

  console.log("🚀 Servidor corriendo:");
  console.log(url);

  setTimeout(() => {
    exec(`start ${url}`);
  }, 500);
});
