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
        let nombre = cam.DENOMINACION.toUpperCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\./g, "")
          .replace(/[-_/]/g, " ")
          .replace(/\(.*?\)/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        // ALT01 => ALT 01
        nombre = nombre.replace(/^([A-Z]{2,6})(\d{1,2})$/, "$1 $2");

        // DJ 06 => DJO 06
        nombre = nombre.replace(/^DJ\s*(\d{1,2})$/, "DJO $1");

        // DORIO1 / DORI1 / DORI 1 => DORIO 01
        nombre = nombre.replace(/^DORI?O?\s*(\d{1,2})$/, "DORIO $1");

        // completar cero
        nombre = nombre.replace(/\b([A-Z]{2,6})\s(\d)\b/, "$1 0$2");

        // Punto Seguro
        nombre = nombre.replace(
          /^PUNTO SEGURO.*SAN FRANCISCO.*$/,
          "PUNTO SEGURO SAN FRANCISCO",
        );

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
            db.prepare(
              `
      INSERT INTO coordenadas(nombre,lat,lng)
      VALUES(?,?,?)
    `,
            ).run(nombre, 0, 0);

            console.log("📍 Nueva coord creada:", nombre);
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

// =============================
// LIMPIAR COORDENADAS 0
// =============================
app.get("/limpiar-coords", (req, res) => {
  try {
    // borrar coords inválidas
    const borradas = db
      .prepare(
        `
      DELETE FROM coordenadas
      WHERE lat = 0
      OR lng = 0
    `,
      )
      .run();

    // contar finales
    const total = db
      .prepare(
        `
      SELECT COUNT(*) as total
      FROM coordenadas
    `,
      )
      .get();

    res.json({
      ok: true,
      borradas: borradas.changes,
      restantes: total.total,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: true });
  }
});

// =============================
// DEBUG FALTANTES
// =============================
app.get("/comparar-excel-historial", async (req, res) => {
  try {
    function normalizarNombre(txt) {
      txt = (txt || "").toUpperCase();

      txt = txt
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\(.*?\)/g, " ")
        .replace(/FIJA\s*\d*/g, " ")
        .replace(/DOMO/g, " ")
        .replace(/INTERCOMUNICADOR/g, " ")
        .replace(/[-_/]/g, " ")
        .replace(/\./g, " ")
        .replace(/\s+/g, " ")
        .trim();

      // DJ O6 -> DJO 06
      txt = txt.replace(/^DJ\s*O\s*(\d)$/, "DJO 0$1");
      txt = txt.replace(/^DJO\s*O\s*(\d)$/, "DJO 0$1");
      txt = txt.replace(/^DJ\s*(\d)$/, "DJO 0$1");
      txt = txt.replace(/^DJO\s*(\d)$/, "DJO 0$1");

      // DORI -> DORIO
      txt = txt.replace(/^DORI\s+(\d{1,2})$/, "DORIO $1");

      // CEN90 -> CEN 90
      txt = txt.replace(/^([A-Z]{2,10})(\d{1,2})$/, "$1 $2");

      // completar cero
      txt = txt.replace(/\b([A-Z]{2,10})\s(\d)\b/g, "$1 0$2");

      return txt.trim();
    }

    // =========================
    // EXCEL
    // =========================

    const excel = await obtenerTodasLasCamarasExcel();

    const excelSet = new Set(
      excel.map((c) => normalizarNombre(c["[Denominacion]"])),
    );

    // =========================
    // HISTORIAL
    // =========================

    const rows = db
      .prepare(
        `
      SELECT data
      FROM historial
      ORDER BY fecha DESC
      LIMIT 1
    `,
      )
      .all();

    let historico = [];

    if (rows.length) {
      historico = JSON.parse(rows[0].data);
    }

    const historialSet = new Set(
      historico.map((c) => normalizarNombre(c.DENOMINACION)),
    );

    // =========================
    // FALTANTES
    // =========================

    const faltan = [...excelSet].filter((x) => !historialSet.has(x));

    res.json({
      excel: excelSet.size,
      historial: historialSet.size,
      faltan,
    });
  } catch (err) {
    console.log(err);

    res.status(500).json({
      error: true,
      detalle: err.message,
    });
  }
});
app.get("/normalizar-coords", (req, res) => {
  try {
    function normalizarNombre(txt) {
      txt = (txt || "").toUpperCase();

      txt = txt
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\(.*?\)/g, " ")
        .replace(/FIJA\s*\d*/g, " ")
        .replace(/DOMO/g, " ")
        .replace(/INTERCOMUNICADOR/g, " ")
        .replace(/[-_/]/g, " ")
        .replace(/\./g, " ")
        .replace(/\s+/g, " ")
        .trim();

      // DJ O6 -> DJO 06
      txt = txt.replace(/^DJ\s*O\s*(\d)$/, "DJO 0$1");
      txt = txt.replace(/^DJO\s*O\s*(\d)$/, "DJO 0$1");
      txt = txt.replace(/^DJ\s*(\d)$/, "DJO 0$1");
      txt = txt.replace(/^DJO\s*(\d)$/, "DJO 0$1");

      // DORI -> DORIO
      txt = txt.replace(/^DORI\s+(\d{1,2})$/, "DORIO $1");

      // CEN90 -> CEN 90
      txt = txt.replace(/^([A-Z]{2,10})(\d{1,2})$/, "$1 $2");

      // completar cero
      txt = txt.replace(/\b([A-Z]{2,10})\s(\d)\b/g, "$1 0$2");

      return txt.trim();
    }

    const rows = db
      .prepare(
        `
      SELECT *
      FROM coordenadas
    `,
      )
      .all();

    const mapa = {};
    let eliminadas = 0;
    let actualizadas = 0;

    rows.forEach((row) => {
      const normalizado = normalizarNombre(row.nombre);

      // ignorar coords invalidas
      if (row.lat == 0 || row.lng == 0 || row.lat == null || row.lng == null) {
        db.prepare(
          `
          DELETE FROM coordenadas
          WHERE id = ?
        `,
        ).run(row.id);

        eliminadas++;
        return;
      }

      // si ya existe una buena, borrar duplicada
      if (mapa[normalizado]) {
        db.prepare(
          `
          DELETE FROM coordenadas
          WHERE id = ?
        `,
        ).run(row.id);

        eliminadas++;
        return;
      }

      mapa[normalizado] = true;

      // renombrar al formato limpio
      // buscar si ya existe otro con el nombre normalizado
      const existente = db
        .prepare(
          `
  SELECT *
  FROM coordenadas
  WHERE nombre = ?
  AND id != ?
`,
        )
        .get(normalizado, row.id);

      // si existe, borrar el viejo
      if (existente) {
        db.prepare(
          `
    DELETE FROM coordenadas
    WHERE id = ?
  `,
        ).run(existente.id);

        eliminadas++;
      }

      // renombrar limpio
      db.prepare(
        `
  UPDATE coordenadas
  SET nombre = ?
  WHERE id = ?
`,
      ).run(normalizado, row.id);

      actualizadas++;
    });

    res.json({
      ok: true,
      actualizadas,
      eliminadas,
      finales: Object.keys(mapa).length,
    });
  } catch (err) {
    console.log(err);

    res.status(500).json({
      error: true,
      detalle: err.message,
    });
  }
});

function normalizarNombre(txt) {
  txt = String(txt || "").toUpperCase();

  txt = txt
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/FIJA\s*\d*/g, " ")
    .replace(/DOMO/g, " ")
    .replace(/INTERCOMUNICADOR/g, " ")
    .replace(/[-_/]/g, " ")
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // DJ O6 -> DJO 06
  txt = txt.replace(/^DJ\s*O\s*(\d)$/, "DJO 0$1");
  txt = txt.replace(/^DJO\s*O\s*(\d)$/, "DJO 0$1");
  txt = txt.replace(/^DJ\s*(\d)$/, "DJO 0$1");
  txt = txt.replace(/^DJO\s*(\d)$/, "DJO 0$1");

  // DORI -> DORIO
  txt = txt.replace(/^DORI\s+(\d{1,2})$/, "DORIO $1");

  // completar ceros
  txt = txt.replace(/\b([A-Z]{2,10})\s(\d)\b/g, "$1 0$2");

  return txt.trim();
}
// =============================
// LIMPIAR HUERFANAS
// =============================
app.get("/sync-coords", async (req, res) => {
  try {
    const { obtenerTodasLasCamarasExcel } = require("./index");

    const camsExcel = await obtenerTodasLasCamarasExcel();

    console.log("PRIMERA CAMARA:");
    console.log(JSON.stringify(camsExcel[0], null, 2));

    const validas = camsExcel
      .map((c) => c["[Denominacion]"])
      .filter(Boolean)
      .map(normalizarNombre);

    console.log("PRIMERAS 20 VALIDAS:");
    console.log(validas.slice(0, 20));

    console.log("TOTAL VALIDAS:", validas.length);

    const coords = db
      .prepare(
        `
      SELECT nombre, lat, lng
      FROM coordenadas
    `,
      )
      .all();

    const faltantes = [];
    const invalidas = [];

    coords.forEach((c) => {
      const nombre = normalizarNombre(c.nombre);

      const existe = validas.includes(nombre);

      const invalida = Number(c.lat) === 0 || Number(c.lng) === 0;

      if (!existe) {
        faltantes.push(c.nombre);
        console.log("NO EXISTE EN EXCEL:", c.nombre);
      }

      if (invalida) {
        invalidas.push(c.nombre);
        console.log("COORD INVALIDA:", c.nombre, c.lat, c.lng);
      }
    });

    res.json({
      ok: true,
      totalExcel: validas.length,
      totalCoords: coords.length,
      faltantes: faltantes.length,
      invalidas: invalidas.length,
      listaFaltantes: faltantes,
      listaInvalidas: invalidas,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

app.get("/debug-tablas", (req, res) => {
  const tablas = db
    .prepare(
      `
    SELECT name
    FROM sqlite_master
    WHERE type='table'
  `,
    )
    .all();

  res.json(tablas);
});

app.get("/debug-coords-detalle", (req, res) => {
  const total = db
    .prepare(
      `
    SELECT COUNT(*) total
    FROM coordenadas
  `,
    )
    .get().total;

  const cero = db
    .prepare(
      `
    SELECT COUNT(*) total
    FROM coordenadas
    WHERE lat = 0 OR lng = 0
  `,
    )
    .get().total;

  const validas = db
    .prepare(
      `
    SELECT COUNT(*) total
    FROM coordenadas
    WHERE lat <> 0
    AND lng <> 0
  `,
    )
    .get().total;

  res.json({
    total,
    cero,
    validas,
  });
});

app.get("/debug-coords-validas", (req, res) => {
  const rows = db
    .prepare(
      `
    SELECT *
    FROM coordenadas
    WHERE lat != 0
    AND lng != 0
  `,
    )
    .all();

  res.json({
    total: rows.length,
  });
});

app.get("/debug-historial-camaras", async (req, res) => {
  try {
    const h = await generarHistorial();

    res.json({
      total: Object.keys(h.camaras).length,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: true });
  }
});

app.get("/debug-total-historial", (req, res) => {
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

    rows.forEach((h) => {
      const camaras = JSON.parse(h.data);

      camaras.forEach((cam) => {
        let nombre = cam.DENOMINACION.toUpperCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\./g, "")
          .replace(/[-_/]/g, " ")
          .replace(/\(.*?\)/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        nombre = nombre.replace(/^([A-Z]{2,6})(\d{1,2})$/, "$1 $2");
        nombre = nombre.replace(/^DJ\s*(\d{1,2})$/, "DJO $1");
        nombre = nombre.replace(/^DORI?O?\s*(\d{1,2})$/, "DORIO $1");
        nombre = nombre.replace(/\b([A-Z]{2,6})\s(\d)\b/, "$1 0$2");

        mapa[nombre] = true;
      });
    });

    res.json({
      total: Object.keys(mapa).length,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: true });
  }
});
app.get("/debug-cantidad-historial", (req, res) => {
  try {
    const rows = db
      .prepare(`
        SELECT * FROM historial
        ORDER BY fecha ASC
      `)
      .all();

    const originales = new Set();
    const normalizadas = new Set();
    const colisiones = {};

    rows.forEach((h) => {
      const camaras = JSON.parse(h.data);

      camaras.forEach((cam) => {
        const original = cam.DENOMINACION;

        originales.add(original);

        let nombre = original
          .toUpperCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\./g, "")
          .replace(/[-_/]/g, " ")
          .replace(/\(.*?\)/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        nombre = nombre.replace(/^([A-Z]{2,6})(\d{1,2})$/, "$1 $2");
        nombre = nombre.replace(/^DJ\s*(\d{1,2})$/, "DJO $1");
        nombre = nombre.replace(/^DORI?O?\s*(\d{1,2})$/, "DORIO $1");
        nombre = nombre.replace(/\b([A-Z]{2,6})\s(\d)\b/, "$1 0$2");

        normalizadas.add(nombre);

        if (!colisiones[nombre]) {
          colisiones[nombre] = new Set();
        }

        colisiones[nombre].add(original);
      });
    });

    const conflictos = {};

    Object.keys(colisiones).forEach((k) => {
      if (colisiones[k].size > 1) {
        conflictos[k] = [...colisiones[k]];
      }
    });

    res.json({
      originales: originales.size,
      normalizadas: normalizadas.size,
      conflictos,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: true });
  }
});

app.get("/debug-coords-vacias", (req, res) => {
  const rows = db.prepare(`
    SELECT *
    FROM coordenadas
    WHERE lat = 0 OR lng = 0
    ORDER BY nombre
  `).all();

  res.json({
    total: rows.length,
    rows
  });
});

app.get("/debug-historial-conflictos", (req, res) => {

  const rows = db.prepare(`
    SELECT data
    FROM historial
    ORDER BY fecha DESC
    LIMIT 1
  `).get();

  const cams = JSON.parse(rows.data);

  const grupos = {};

  cams.forEach(cam => {

    const normalizado = normalizarNombre(
      cam.DENOMINACION
    );

    if (!grupos[normalizado]) {
      grupos[normalizado] = [];
    }

    grupos[normalizado].push(cam.DENOMINACION);

  });

  const conflictos = {};

  Object.entries(grupos).forEach(([k,v]) => {

    const unicos = [...new Set(v)];

    if(unicos.length > 1){
      conflictos[k] = unicos;
    }

  });

  res.json(conflictos);

});
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
