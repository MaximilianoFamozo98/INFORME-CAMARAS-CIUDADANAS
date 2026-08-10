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
// GUARDAR HISTORIAL SQLITE SOLO MAPA
// =============================
async function guardarEstadoActual(resultado) {
  db.prepare(
    `
        DELETE FROM estado_actual
    `,
  ).run();

  const insertar = db.prepare(`
        INSERT INTO estado_actual
        (nombre, estado, latencia, fecha)
        VALUES (?, ?, ?, ?)
    `);

  const ahora = new Date().toISOString();


  console.log("Primeras 10 cámaras a guardar:");
console.table(
  resultado.slice(0, 10).map(c => ({
    nombre: c.DENOMINACION,
    estado: c.ESTADO
  }))
);

  resultado.forEach((cam) => {
    insertar.run(
      normalizarNombre(cam.DENOMINACION),
      cam.ESTADO,
      cam.LATENCIA,
      ahora,
    );
  });

  console.log("✅ Estado actual actualizado");
}

let escaneoEnCurso = false;

async function autoEscaneo() {

  if (escaneoEnCurso) {
    console.log("⚠️ Ya hay un autoescaneo en curso");
    return;
  }

  escaneoEnCurso = true;

  try {

    console.log("");
    console.log("================================");
    console.log("⏰ Autoescaneo iniciado");
    console.log("================================");

    resetProgreso();

    const { resultado } =
      await analizarTodasLasCamaras(progreso);

    await guardarEstadoActual(resultado);

    console.log("✅ Autoescaneo finalizado");

  } catch (err) {

    console.error("❌ Error autoescaneo:", err);

  } finally {

    escaneoEnCurso = false;

  }
}

// =============================
// SINCRONIZAR COORDENADAS
// =============================

async function sincronizarCoordenadas() {
  console.log("");
  console.log("================================");
  console.log("🔄 Sincronizando coordenadas...");
  console.log("================================");

  // Leer Excel (fuente de verdad)
  const excel = await obtenerTodasLasCamarasExcel();

  const nombresExcel = new Set(
    excel.map((c) => normalizarNombre(c["[Denominacion]"])),
  );

  // Leer SQLite
  const coordenadas = db
    .prepare(
      `
    SELECT nombre
    FROM coordenadas
  `,
    )
    .all();

  const nombresDB = new Set(coordenadas.map((c) => normalizarNombre(c.nombre)));

  // =============================
  // AGREGAR NUEVAS
  // =============================
  const insertar = db.prepare(`
  INSERT INTO coordenadas(nombre, lat, lng)
  VALUES (?, NULL, NULL)
`);

  let agregadas = 0;

  for (const nombre of nombresExcel) {
    if (!nombresDB.has(nombre)) {
      insertar.run(nombre);

      console.log("➕ Agregada:", nombre);

      agregadas++;
    }
  }

  // =============================
  // ELIMINAR LAS QUE YA NO EXISTEN
  // =============================
  const eliminar = db.prepare(`
  DELETE FROM coordenadas
  WHERE UPPER(TRIM(nombre)) = ?
`);

  let eliminadas = 0;

  for (const nombre of nombresDB) {
    if (!nombresExcel.has(nombre)) {
      eliminar.run(nombre);

      console.log("➖ Eliminada:", nombre);

      eliminadas++;
    }
  }

  const totalFinal = db
    .prepare(
      `
  SELECT COUNT(*) AS total
  FROM coordenadas
`,
    )
    .get().total;

  console.log("");
  console.log("================================");
  console.log("✅ Sincronización completada");
  console.log("================================");
  console.log(`Excel............... ${nombresExcel.size}`);
  console.log(`Base antes.......... ${nombresDB.size}`);
  console.log(`➕ Agregadas......... ${agregadas}`);
  console.log(`➖ Eliminadas........ ${eliminadas}`);
  console.log(`Base final.......... ${totalFinal}`);
  console.log("================================");
  console.log("");
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

    await guardarEstadoActual(resultado);

    guardarHistorial(resultado);

    await sincronizarCoordenadas();

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

    await guardarEstadoActual(resultado);

    guardarHistorial(resultado);

    await sincronizarCoordenadas();

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
app.get("/historial", async (req, res) => {
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

    const excel = await obtenerTodasLasCamarasExcel();

    const nombresExcel = new Set(
      excel.map((x) => normalizarNombre(x["[Denominacion]"])),
    );

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
        if (!nombresExcel.has(nombre)) {
          return;
        }
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
// ESTADO ACTUAL
// =============================
app.get("/estado-actual", (req, res) => {
  try {
    const rows = db
      .prepare(
        `
      SELECT *
      FROM estado_actual
      ORDER BY nombre
    `,
      )
      .all();

    res.json(rows);
  } catch (err) {
    console.log(err);

    res.status(500).json({
      error: true,
    });
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
app.get("/debug", (req, res) => {
  const historial = db
    .prepare(
      `
    SELECT COUNT(*) AS total
    FROM historial
  `,
    )
    .get();

  const coords = db
    .prepare(
      `
    SELECT COUNT(*) AS total
    FROM coordenadas
  `,
    )
    .get();

  res.json({
    historial,
    coords,
  });
});
app.get("/debug-diferencias", async (req, res) => {
  const excel = await obtenerTodasLasCamarasExcel();

  const excelSet = new Set(
    excel.map((x) => normalizarNombre(x["[Denominacion]"])),
  );

  const coords = db
    .prepare(
      `
    SELECT nombre
    FROM coordenadas
  `,
    )
    .all();

  const coordsSet = new Set(coords.map((x) => normalizarNombre(x.nombre)));

  const soloExcel = [...excelSet].filter((x) => !coordsSet.has(x));
  const soloCoords = [...coordsSet].filter((x) => !excelSet.has(x));

  res.json({
    excel: excelSet.size,
    coords: coordsSet.size,
    soloExcel,
    soloCoords,
  });
});

// ========
// AUTOESCANEO CADA 10 MINUTOS
// ==========
setInterval(
  () => {
    autoEscaneo();
  },
  10 * 60 * 1000,
);
// Ejecutar uno al iniciar
setTimeout(() => {
  autoEscaneo();
}, 5000);

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
