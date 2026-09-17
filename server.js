const express = require("express");
const app = express();
const path = require("path");
const fs = require("fs");
//------  Archivo mapa -------------------
const Database = require("better-sqlite3");
const exeDir = process.pkg
  ? path.dirname(process.execPath)
  : __dirname;

const rutaMapa = path.join(
  exeDir,
  "data",
  "mapa.mbtiles"
);

console.log("🗺️ Ruta MBTiles:", rutaMapa);

const mapaDB = new Database(
  rutaMapa,
  {
    readonly: true,
    fileMustExist: true,
  }
);
//--------------------------
const { exec } = require("child_process");
const db = require("./db");
const {
  analizarCamaras,
  analizarTodasLasCamaras,
  obtenerTodasLasCamarasExcel,
} = require("./index.js");
const { normalizarNombre } = require("./normalizar");

// =============================
// PROGRESO + CONTROL GLOBAL DE ESCANEOS
// =============================
const INTERVALO_AUTOESCANEO = 10 * 60 * 1000;

let progreso = {
  total: 0,
  procesadas: 0,
  online: 0,
  sinRespuesta: 0,
  ipVacia: 0,
  noEncontrada: 0,
};

let escaneoEnCurso = false;
let tipoEscaneo = null;
let iniciadoPor = null;
let horaInicio = null;
let horaFin = null;
let estadoEscaneo = "IDLE";
let cancelarEscaneo = false;
let canceladoPor = null;

let autoescaneoHabilitado = true;
let proximoAutoescaneo = null;
let timerAutoescaneo = null;
let ultimaAccion = null;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// =============================
// AUDITORIA DE ACCIONES
// =============================
db.prepare(`
  CREATE TABLE IF NOT EXISTS acciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL,
    usuario TEXT NOT NULL,
    accion TEXT NOT NULL,
    detalle TEXT
  )
`).run();

try {
  const columnasAcciones = db.prepare("PRAGMA table_info(acciones)").all();

  // Crear columna tipo si todavía no existe
  if (!columnasAcciones.some((c) => c.name === "tipo")) {
    db.prepare(`
      ALTER TABLE acciones
      ADD COLUMN tipo TEXT
    `).run();
  }

  // =============================
  // CLASIFICAR ACCIONES ANTIGUAS
  // =============================

  db.prepare(`
    UPDATE acciones
    SET tipo = 'ANALISIS'
    WHERE accion IN (
      'INICIO_ANALISIS',
      'ANALISIS_FINALIZADO',
      'ANALISIS_CANCELADO',
      'ERROR_ANALISIS',
      'SOLICITO_CANCELACION'
    )
    AND (
      tipo IS NULL
      OR tipo = ''
    )
  `).run();

  db.prepare(`
    UPDATE acciones
    SET tipo = 'AUTOESCANEO'
    WHERE accion IN (
      'PAUSO_AUTOESCANEO',
      'REANUDO_AUTOESCANEO'
    )
    AND (
      tipo IS NULL
      OR tipo = ''
    )
  `).run();

  db.prepare(`
    UPDATE acciones
    SET tipo = 'COORDENADAS'
    WHERE accion IN (
      'GUARDO_COORDENADA',
      'ELIMINO_COORDENADA'
    )
    AND (
      tipo IS NULL
      OR tipo = ''
    )
  `).run();

  db.prepare(`
    UPDATE acciones
    SET tipo = 'OTROS'
    WHERE (
      tipo IS NULL
      OR tipo = ''
    )
  `).run();

  console.log("✅ Historial de acciones clasificado");

} catch (err) {
  console.error(
    "❌ Error preparando tabla de acciones:",
    err
  );
}

function obtenerTipoAccion(accion) {
  if (
    ["PAUSO_AUTOESCANEO", "REANUDO_AUTOESCANEO"].includes(accion)
  ) {
    return "AUTOESCANEO";
  }

  if (
    ["GUARDO_COORDENADA", "ELIMINO_COORDENADA"].includes(accion)
  ) {
    return "COORDENADAS";
  }

  if (
    [
      "INICIO_ANALISIS",
      "ANALISIS_FINALIZADO",
      "ANALISIS_CANCELADO",
      "ERROR_ANALISIS",
      "SOLICITO_CANCELACION",
    ].includes(accion)
  ) {
    return "ANALISIS";
  }

  return "OTROS";
}

function obtenerUsuario(req) {
  return (
    req.user?.nombre ||
    req.get?.("X-Usuario") ||
    req.body?.usuario ||
    "SIN LOGIN"
  );
}

function registrarAccion(usuario, accion, detalle = "") {
  const fecha = new Date().toISOString();
  const usuarioFinal = usuario || "SIN LOGIN";

  ultimaAccion = {
    fecha,
    usuario: usuarioFinal,
    accion,
    detalle,
  };

  try {
    db.prepare(`
      INSERT INTO acciones (
        fecha,
        usuario,
        accion,
        detalle,
        tipo
      )
      VALUES (?, ?, ?, ?, ?)
    `).run(
      fecha,
      usuarioFinal,
      accion,
      detalle,
      obtenerTipoAccion(accion),
    );
  } catch (err) {
    console.error("❌ Error registrando acción:", err);
  }
}

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

function limpiarTimerAutoescaneo() {
  if (timerAutoescaneo) {
    clearTimeout(timerAutoescaneo);
    timerAutoescaneo = null;
  }
  proximoAutoescaneo = null;
}

function programarProximoAutoescaneo() {
  limpiarTimerAutoescaneo();

  if (!autoescaneoHabilitado || escaneoEnCurso) return;

  proximoAutoescaneo = new Date(
    Date.now() + INTERVALO_AUTOESCANEO,
  ).toISOString();

  timerAutoescaneo = setTimeout(() => {
    timerAutoescaneo = null;
    proximoAutoescaneo = null;
    autoEscaneo();
  }, INTERVALO_AUTOESCANEO);
}

function iniciarEscaneo(tipo, usuario) {
  if (escaneoEnCurso) return false;

  limpiarTimerAutoescaneo();
  resetProgreso();

  escaneoEnCurso = true;
  tipoEscaneo = tipo;
  iniciadoPor = usuario || "SIN LOGIN";
  horaInicio = new Date().toISOString();
  horaFin = null;
  estadoEscaneo = "EN_CURSO";
  cancelarEscaneo = false;
  canceladoPor = null;

  registrarAccion(iniciadoPor, "INICIO_ANALISIS", tipoEscaneo);
  return true;
}

function finalizarEscaneo({ cancelado = false, error = false } = {}) {
  horaFin = new Date().toISOString();

  // =============================
  // CALCULAR DURACION
  // =============================
  let duracionSegundos = 0;

  if (horaInicio) {
    const inicio = new Date(horaInicio).getTime();
    const fin = new Date(horaFin).getTime();

    duracionSegundos = Math.max(
      0,
      Math.round((fin - inicio) / 1000),
    );
  }

  const minutos = Math.floor(duracionSegundos / 60);
  const segundos = duracionSegundos % 60;

  const duracionTexto =
    minutos > 0
      ? `${minutos}m ${segundos}s`
      : `${segundos}s`;

  // =============================
  // RESUMEN DEL ANALISIS
  // =============================
  const detalleEscaneo =
    `${tipoEscaneo || ""} | ` +
    `Procesadas: ${progreso.procesadas}/${progreso.total} | ` +
    `Online: ${progreso.online} | ` +
    `Sin respuesta: ${progreso.sinRespuesta} | ` +
    `IP vacía: ${progreso.ipVacia} | ` +
    `No encontrada: ${progreso.noEncontrada} | ` +
    `Duración: ${duracionTexto}`;

  if (cancelado) {
    estadoEscaneo = "CANCELADO";

    registrarAccion(
      canceladoPor || iniciadoPor || "SIN LOGIN",
      "ANALISIS_CANCELADO",
      detalleEscaneo,
    );

  } else if (error) {
    estadoEscaneo = "ERROR";

    registrarAccion(
      iniciadoPor || "SIN LOGIN",
      "ERROR_ANALISIS",
      detalleEscaneo,
    );

  } else {
    estadoEscaneo = "FINALIZADO";

    registrarAccion(
      iniciadoPor || "SIN LOGIN",
      "ANALISIS_FINALIZADO",
      detalleEscaneo,
    );
  }

  escaneoEnCurso = false;
  cancelarEscaneo = false;

  if (autoescaneoHabilitado) {
    programarProximoAutoescaneo();
  } else {
    limpiarTimerAutoescaneo();
  }
}

// =============================
// RUTA PROGRESO GLOBAL
// =============================
app.get("/progreso", (req, res) => {
  res.json({
    ...progreso,
    escaneoEnCurso,
    tipoEscaneo,
    iniciadoPor,
    horaInicio,
    horaFin,
    estadoEscaneo,
    cancelarSolicitado: cancelarEscaneo,
    canceladoPor,
    autoescaneoHabilitado,
    proximoAutoescaneo,
    intervaloAutoescaneoMs: INTERVALO_AUTOESCANEO,
    ultimaAccion,
  });
});

// =============================
// HISTORIAL DE ACCIONES
// =============================
app.get(["/api/auditoria", "/acciones"], (req, res) => {
  try {
    const limite = Math.min(
      Math.max(Number(req.query.limit) || 100, 1),
      500,
    );

    const tipo = String(
      req.query.tipo || "TODOS",
    ).toUpperCase();

    const buscar = String(
      req.query.buscar || "",
    ).trim();
    const desde = String(
  req.query.desde || "",
).trim();

const hasta = String(
  req.query.hasta || "",
).trim();

    let sql = `
      SELECT
        id,
        fecha,
        usuario,
        accion,
        detalle,
        COALESCE(tipo, '') AS tipo
      FROM acciones
      WHERE 1 = 1
    `;

    const params = [];

    // FILTRAR POR TIPO
    if (tipo !== "TODOS") {
      sql += `
        AND COALESCE(tipo, '') = ?
      `;

      params.push(tipo);
    }

    // BUSCADOR
    if (buscar) {
      sql += `
        AND (
          usuario LIKE ?
          OR accion LIKE ?
          OR COALESCE(detalle, '') LIKE ?
          OR COALESCE(tipo, '') LIKE ?
        )
      `;

      const termino = `%${buscar}%`;

      params.push(
        termino,
        termino,
        termino,
        termino,
      );
    }
    // =============================
// FILTRAR DESDE
// =============================
if (desde) {
  sql += `
    AND fecha >= ?
  `;

  params.push(
    `${desde}T00:00:00.000Z`
  );
}

// =============================
// FILTRAR HASTA
// =============================
if (hasta) {
  const fechaHasta = new Date(
    `${hasta}T00:00:00`
  );

  fechaHasta.setDate(
    fechaHasta.getDate() + 1
  );

  sql += `
    AND fecha < ?
  `;

  params.push(
    fechaHasta.toISOString()
  );
}

    // MÁS NUEVAS PRIMERO
    sql += `
      ORDER BY id DESC
      LIMIT ?
    `;

    params.push(limite);

    const acciones = db
      .prepare(sql)
      .all(...params);

    res.json(acciones);

  } catch (err) {
    console.error(
      "❌ Error leyendo historial de acciones:",
      err,
    );

    res.status(500).json({
      error: true,
      mensaje:
        "No se pudo cargar el historial de acciones",
    });
  }
});
// =============================
// RESUMEN HISTORIAL ACCIONES
// =============================
app.get("/api/auditoria/resumen", (req, res) => {
  try {

    const total = db.prepare(`
      SELECT COUNT(*) AS cantidad
      FROM acciones
    `).get().cantidad;

    const analisis = db.prepare(`
      SELECT COUNT(*) AS cantidad
      FROM acciones
      WHERE tipo = 'ANALISIS'
    `).get().cantidad;

    const autoescaneo = db.prepare(`
      SELECT COUNT(*) AS cantidad
      FROM acciones
      WHERE tipo = 'AUTOESCANEO'
    `).get().cantidad;

    const coordenadas = db.prepare(`
      SELECT COUNT(*) AS cantidad
      FROM acciones
      WHERE tipo = 'COORDENADAS'
    `).get().cantidad;

    const finalizados = db.prepare(`
      SELECT COUNT(*) AS cantidad
      FROM acciones
      WHERE accion = 'ANALISIS_FINALIZADO'
    `).get().cantidad;

    const cancelados = db.prepare(`
      SELECT COUNT(*) AS cantidad
      FROM acciones
      WHERE accion = 'ANALISIS_CANCELADO'
    `).get().cantidad;

    const errores = db.prepare(`
      SELECT COUNT(*) AS cantidad
      FROM acciones
      WHERE accion = 'ERROR_ANALISIS'
    `).get().cantidad;

    res.json({
      total,
      analisis,
      autoescaneo,
      coordenadas,
      finalizados,
      cancelados,
      errores,
    });

  } catch (err) {

    console.error(
      "❌ Error generando resumen:",
      err
    );

    res.status(500).json({
      error: true,
    });
  }
});
// =============================
// PAGINA HISTORIAL DE ACCIONES
// =============================
app.get("/historial-acciones", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "historial.html",
    ),
  );
});

app.post("/cancelar-escaneo", (req, res) => {
  const usuario = obtenerUsuario(req);

  if (!escaneoEnCurso) {
    return res.status(409).json({
      ok: false,
      mensaje: "No hay ningún análisis en ejecución",
    });
  }

  if (cancelarEscaneo) {
    return res.json({
      ok: true,
      mensaje: "La cancelación ya fue solicitada",
    });
  }

  cancelarEscaneo = true;
  canceladoPor = usuario;
  registrarAccion(usuario, "SOLICITO_CANCELACION", tipoEscaneo || "");

  res.json({
    ok: true,
    mensaje: "Cancelación solicitada. Se detendrá al terminar las tareas activas.",
  });
});

app.post("/autoescaneo/pausar", (req, res) => {
  const usuario = obtenerUsuario(req);

  if (!autoescaneoHabilitado) {
    return res.json({ ok: true, mensaje: "El autoescaneo ya está pausado" });
  }

  autoescaneoHabilitado = false;
  limpiarTimerAutoescaneo();
  registrarAccion(usuario, "PAUSO_AUTOESCANEO");

  res.json({ ok: true, mensaje: "Autoescaneo pausado" });
});

app.post("/autoescaneo/reanudar", (req, res) => {
  const usuario = obtenerUsuario(req);

  if (autoescaneoHabilitado) {
    return res.json({ ok: true, mensaje: "El autoescaneo ya está activo" });
  }

  autoescaneoHabilitado = true;
  registrarAccion(usuario, "REANUDO_AUTOESCANEO");

  if (!escaneoEnCurso) {
    programarProximoAutoescaneo();
  }

  res.json({ ok: true, mensaje: "Autoescaneo reanudado" });
});

// =============================
// GUARDAR HISTORIAL SQLITE
// =============================
// =============================
// HISTORIAL DIARIO SQLITE
// =============================

function obtenerFechaLocal() {
  const ahora = new Date();

  const anio = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, "0");
  const dia = String(ahora.getDate()).padStart(2, "0");

  return `${anio}-${mes}-${dia}`;
}

function existeHistorialDeHoy() {
  const fechaHoy = obtenerFechaLocal();

  const registros = db
    .prepare(`
      SELECT fecha
      FROM historial
      ORDER BY fecha DESC
    `)
    .all();

  return registros.some((registro) => {
    const fecha = new Date(registro.fecha);

    const anio = fecha.getFullYear();
    const mes = String(fecha.getMonth() + 1).padStart(2, "0");
    const dia = String(fecha.getDate()).padStart(2, "0");

    return `${anio}-${mes}-${dia}` === fechaHoy;
  });
}

function guardarHistorial(resultado) {
  db.prepare(`
    INSERT INTO historial (fecha, data)
    VALUES (?, ?)
  `).run(
    new Date().toISOString(),
    JSON.stringify(resultado),
  );

  console.log("✅ Historial guardado en SQLite");
}

function guardarHistorialDiarioSiCorresponde(resultado) {
  const ahora = new Date();

  // Antes de las 08:00 no guardamos historial diario
  if (ahora.getHours() < 8) {
    console.log("📅 Historial diario: esperando las 08:00");
    return false;
  }

  // No aceptar un resultado vacío
  // Solo guardar si el análisis fue realmente completo
if (
  !Array.isArray(resultado) ||
  resultado.length === 0 ||
  progreso.procesadas !== progreso.total
) {
  console.warn(
    `⚠️ Historial diario: análisis incompleto (${progreso.procesadas}/${progreso.total}). No se guardó.`,
  );
  return false;
}

  // Ya tenemos la foto oficial de hoy
  if (existeHistorialDeHoy()) {
    console.log(
      "📅 Historial diario: la foto de hoy ya está guardada",
    );
    return false;
  }

  guardarHistorial(resultado);

  console.log(
    `📅 Foto diaria guardada: ${obtenerFechaLocal()} - ${resultado.length} cámaras`,
  );

  return true;
}

// =============================
// GUARDAR ESTADO ACTUAL SQLITE
// =============================
async function guardarEstadoActual(resultado) {
  db.prepare(`
    DELETE FROM estado_actual
  `).run();

  const insertar = db.prepare(`
    INSERT INTO estado_actual
    (nombre, estado, latencia, fecha)
    VALUES (?, ?, ?, ?)
  `);

  const ahora = new Date().toISOString();

  const camarasUnicas = new Map();

  resultado.forEach((cam) => {
    const nombre = normalizarNombre(cam.DENOMINACION);

    if (!nombre) return;

    if (camarasUnicas.has(nombre)) {
      console.warn(
        `⚠ Cámara duplicada detectada: ${nombre} - se conservará una sola`,
      );
    }

    camarasUnicas.set(nombre, cam);
  });

  camarasUnicas.forEach((cam, nombre) => {
    insertar.run(
      nombre,
      cam.ESTADO,
      cam.LATENCIA,
      ahora,
    );
  });

  console.log(
    `✅ Estado actual actualizado: ${camarasUnicas.size} cámaras únicas`,
  );
}

async function autoEscaneo() {
  if (!autoescaneoHabilitado) return;

  if (!iniciarEscaneo("AUTOMATICO", "SISTEMA")) {
    console.log("⚠️ Ya hay un análisis en curso. Autoescaneo reprogramado.");
    programarProximoAutoescaneo();
    return;
  }

  try {
    console.log("");
    console.log("================================");
    console.log("⏰ Autoescaneo iniciado");
    console.log("================================");

    const { resultado, cancelado } = await analizarTodasLasCamaras(
      progreso,
      () => cancelarEscaneo,
    );

    if (cancelado || cancelarEscaneo) {
      console.log("⛔ Autoescaneo cancelado");
      finalizarEscaneo({ cancelado: true });
      return;
    }

    await guardarEstadoActual(resultado);

guardarHistorialDiarioSiCorresponde(resultado);

console.log("✅ Autoescaneo finalizado");
finalizarEscaneo();
  } catch (err) {
    console.error("❌ Error autoescaneo:", err);
    finalizarEscaneo({ error: true });
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
  const texto = req.body.texto;

  if (!texto || !texto.trim()) {
    return res.status(400).send("No se recibió una lista de cámaras");
  }

  const usuario = obtenerUsuario(req);

  if (!iniciarEscaneo("MANUAL_TEXTO", usuario)) {
    return res.status(409).json({
      ok: false,
      mensaje: `Ya hay un análisis en curso iniciado por ${iniciadoPor || "otro usuario"}`,
    });
  }

  try {
    const lista = texto
      .split("\n")
      .map((x) => x.trim().replace(/^\d+\s*[\)\.\-]\s*/, ""))
      .filter(Boolean);

    const { ruta, resultado, cancelado } = await analizarCamaras(
      lista,
      progreso,
      () => cancelarEscaneo,
    );

    if (cancelado || cancelarEscaneo) {
      finalizarEscaneo({ cancelado: true });
      return res.status(409).json({
        ok: false,
        cancelado: true,
        mensaje: "Análisis cancelado. No se modificó el estado actual.",
      });
    }

    finalizarEscaneo();

    res.download(ruta, () => {
      fs.unlink(ruta, () => {});
    });
  } catch (error) {
    console.error(error);
    finalizarEscaneo({ error: true });
    res.status(500).send("Error al analizar");
  }
});

// =============================
// ANALIZAR TODAS + DESCARGAR EXCEL
// =============================
app.get("/analizar-todas", async (req, res) => {
  const usuario = obtenerUsuario(req);

  if (!iniciarEscaneo("MANUAL_TODAS", usuario)) {
    return res.status(409).json({
      ok: false,
      mensaje: `Ya hay un análisis en curso iniciado por ${iniciadoPor || "otro usuario"}`,
    });
  }

  try {
    const { ruta, resultado, cancelado } = await analizarTodasLasCamaras(
      progreso,
      () => cancelarEscaneo,
    );

    if (cancelado || cancelarEscaneo) {
      finalizarEscaneo({ cancelado: true });
      return res.status(409).json({
        ok: false,
        cancelado: true,
        mensaje: "Análisis cancelado. No se modificó el estado actual.",
      });
    }

    await guardarEstadoActual(resultado);
guardarHistorialDiarioSiCorresponde(resultado);
await sincronizarCoordenadas();

    finalizarEscaneo();

    res.download(ruta, () => {
      fs.unlink(ruta, () => {});
    });
  } catch (error) {
    console.error(error);
    finalizarEscaneo({ error: true });
    res.status(500).send("Error al analizar todas");
  }
});

// =============================
// ANALIZAR TODAS DESDE EL MAPA (SIN DESCARGA)
// =============================
app.post("/iniciar-analisis-todas", (req, res) => {
  const usuario = obtenerUsuario(req);

  if (!iniciarEscaneo("MANUAL_TODAS", usuario)) {
    return res.status(409).json({
      ok: false,
      mensaje: `Ya hay un análisis en curso iniciado por ${iniciadoPor || "otro usuario"}`,
    });
  }

  res.status(202).json({
    ok: true,
    mensaje: "Análisis iniciado",
  });

  (async () => {
    let ruta = null;

    try {
      const datos = await analizarTodasLasCamaras(
        progreso,
        () => cancelarEscaneo,
      );

      ruta = datos.ruta;

      if (datos.cancelado || cancelarEscaneo) {
        finalizarEscaneo({ cancelado: true });
        return;
      }

      await guardarEstadoActual(datos.resultado);
guardarHistorialDiarioSiCorresponde(datos.resultado);
await sincronizarCoordenadas();

      finalizarEscaneo();
    } catch (error) {
      console.error(error);
      finalizarEscaneo({ error: true });
    } finally {
      if (ruta) fs.unlink(ruta, () => {});
    }
  })();
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
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "mapa.html"
    )
  );
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

    registrarAccion(obtenerUsuario(req), "GUARDO_COORDENADA", nombre);
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

    registrarAccion(obtenerUsuario(req), "ELIMINO_COORDENADA", req.params.nombre);
    res.json({ ok: true });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: true });
  }
});




// =============================
// PROGRAMAR PRIMER AUTOESCANEO
// =============================
programarProximoAutoescaneo();

// =============================
// MAPA OFFLINE - MBTILES
// =============================

app.get("/tiles/:z/:x/:y.pbf", (req, res) => {
  try {
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);

    // MBTiles usa coordenadas TMS.
    // MapLibre usa XYZ.
    const tmsY = Math.pow(2, z) - 1 - y;

    const tile = mapaDB
      .prepare(`
        SELECT tile_data
        FROM tiles
        WHERE zoom_level = ?
          AND tile_column = ?
          AND tile_row = ?
      `)
      .get(z, x, tmsY);

    if (!tile) {
      return res.status(404).end();
    }

    res.setHeader("Content-Type", "application/x-protobuf");
    res.setHeader("Content-Encoding", "gzip");

    res.send(tile.tile_data);
  } catch (err) {
    console.error("❌ Error cargando tile:", err);
    res.status(500).end();
  }
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
