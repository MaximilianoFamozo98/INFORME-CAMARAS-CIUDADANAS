const XLSX = require("xlsx");
const ExcelJS = require("exceljs");
const ping = require("ping");
const path = require("path");
const pLimit = require("p-limit");
const fs = require("fs");
const axios = require("axios");

const outputDir = path.join(process.cwd(), "informes");

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

const archivoExcel = path.join(
  process.cwd(),
  "data",
  "camaras.xlsx"
);

// =============================
// CONFIG
// =============================
const INTENTOS = 4;
const TIMEOUT = 1.5;
const CONCURRENCIA = 5;

// =============================
// NORMALIZAR
// =============================
function normalizarTexto(txt) {
  if (!txt) return "";

  return txt
    .toString()
    .toUpperCase()
    .replace(/^\d+\)\s*/, "")
    .replace(/PUNTO SEGURO/g, "")
    .replace(/INGENIERO/g, "ING")
    .replace(/ING\./g, "ING")
    .replace(/[-().]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// =============================
function extraerCodigo(txt) {
  if (!txt) return null;
  const match = txt.toUpperCase().match(/[A-Z]{2,3}\s?\d{1,3}/);
  return match ? match[0].replace(/\s/g, "") : null;
}

// =============================
function parsearPuntoSeguro(nombre) {
  const limpio = normalizarTexto(nombre);

  let tipo = "";
  if (limpio.includes("DOMO")) tipo = "DOMO";
  if (limpio.includes("FIJA")) tipo = "FIJA";
  if (limpio.includes("INTERCOMUNICADOR")) tipo = "INTERCOMUNICADOR";

  const base = limpio
    .replace("DOMO", "")
    .replace("FIJA", "")
    .replace("INTERCOMUNICADOR", "")
    .trim();

  return { base, tipo };
}

// =============================
// ORDENAR RESULTADOS
// =============================
function ordenarResultados(data) {
  return data.sort((a, b) => {
    const estadoPrioridad = (estado) => {
      if (estado === "SIN RESPUESTA" || estado === "ERROR") return 1;
      if (estado === "INESTABLE") return 2;
      if (estado.includes("ONLINE")) return 3;
      return 4;
    };

    const proveedorPrioridad = (prov) => {
      if (!prov) return 3;

      const p = prov.toUpperCase();

      if (p.includes("BONOMO")) return 1;
      if (p.includes("COSEIDI")) return 2;

      return 3;
    };

    const estadoA = estadoPrioridad(a.ESTADO);
    const estadoB = estadoPrioridad(b.ESTADO);

    if (estadoA !== estadoB) return estadoA - estadoB;

    const provA = proveedorPrioridad(a.PROVEEDOR);
    const provB = proveedorPrioridad(b.PROVEEDOR);

    return provA - provB;
  });
}

// =============================
// PING INTELIGENTE
// =============================
async function hacerPing(ip) {
  let exitos = 0;
  let latencias = [];

  for (let i = 0; i < INTENTOS; i++) {
    const res = await ping.promise.probe(ip, { timeout: TIMEOUT });

    if (res.alive) {
      exitos++;

      if (res.time !== "unknown") {
        latencias.push(Number(res.time));
      }

      // si ya confirmó estabilidad → corta antes
      if (exitos >= 3) break;
    }
  }

  const latenciaPromedio =
    latencias.length > 0
      ? Math.round(latencias.reduce((a, b) => a + b, 0) / latencias.length)
      : null;

  return { exitos, latenciaPromedio };
}

// =============================
// CHECK HTTP
// =============================
async function checkHTTP(ip) {
  try {
    await axios.get(`http://${ip}`, { timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}

// =============================
// PROCESAR CAMARA
// =============================
async function procesarCamara(fila, index, progreso) {
  let ip = fila["[IP]"] ? fila["[IP]"].toString() : "";
  ip = ip.replace(/[, ]/g, ".").trim();

  const conexion = (fila["[Tipo de Conexion]"] || "-").toUpperCase();

  if (!ip) {
    progreso.ipVacia++;
    return {
      DENOMINACION: fila["[Denominacion]"],
      PROVEEDOR: fila["[Empresa Mantenimiento]"] || "-",
      UBICACION: fila["[Ubicacion]"] || "-",
      CONEXION: conexion,
      IP: "",
      LATENCIA: "-",
      ESTADO: "IP VACIA",
      filaIndex: index + 7,
    };
  }

  try {
    const { exitos, latenciaPromedio } = await hacerPing(ip);

    let estado = "";

    if (exitos === 0) {
      await new Promise(r => setTimeout(r, 1000));

      const segundoIntento = await hacerPing(ip);

      if (segundoIntento.exitos > 0) {
        estado = "INESTABLE";
        progreso.sinRespuesta++;
      } else {
        const httpOk = await checkHTTP(ip);

        if (httpOk) {
          estado = "ONLINE (HTTP)";
          progreso.online++;
        } else {
          estado = "SIN RESPUESTA";
          progreso.sinRespuesta++;
        }
      }

    } else if (exitos <= 2) {
      estado = "INESTABLE";
      progreso.sinRespuesta++;

    } else {
      estado = "ONLINE";
      progreso.online++;
    }

    return {
      DENOMINACION: fila["[Denominacion]"],
      PROVEEDOR: fila["[Empresa Mantenimiento]"] || "-",
      UBICACION: fila["[Ubicacion]"] || "-",
      CONEXION: conexion,
      IP: ip,
      LATENCIA: latenciaPromedio ? `${latenciaPromedio} ms` : "-",
      ESTADO: estado,
      filaIndex: index + 7,
    };

  } catch {
    progreso.sinRespuesta++;
    return {
      DENOMINACION: fila["[Denominacion]"],
      PROVEEDOR: fila["[Empresa Mantenimiento]"] || "-",
      UBICACION: fila["[Ubicacion]"] || "-",
      CONEXION: conexion,
      IP: ip,
      LATENCIA: "-",
      ESTADO: "ERROR",
      filaIndex: index + 7,
    };
  }
}

// =============================
// GENERAR EXCEL
// =============================
async function generarExcel(resultado, nombre) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Resultado");

  ws.columns = [
    { header: "DENOMINACION", key: "DENOMINACION", width: 40 },
    { header: "PROVEEDOR", key: "PROVEEDOR", width: 20 },
    { header: "UBICACION", key: "UBICACION", width: 40 },
    { header: "CONEXION", key: "CONEXION", width: 20 },
    { header: "IP", key: "IP", width: 18 },
    { header: "LATENCIA", key: "LATENCIA", width: 15 },
    { header: "ESTADO", key: "ESTADO", width: 20 },
  ];

  resultado.forEach((r) => {
    ws.addRow(r); 
  });

  const ruta = path.join(outputDir, nombre);
  await wb.xlsx.writeFile(ruta);
  return ruta;
}

// =============================
// TODAS
// =============================
async function analizarTodasLasCamaras(progreso) {
  const workbook = XLSX.readFile(archivoExcel);
  const sheet = workbook.Sheets["RESUMEN TOTAL"];
  const data = XLSX.utils.sheet_to_json(sheet, { range: 6 });

  const limit = pLimit(CONCURRENCIA);

  progreso.total = data.length;
  progreso.procesadas = 0;
  progreso.online = 0;
  progreso.sinRespuesta = 0;
  progreso.ipVacia = 0;
  progreso.noEncontrada = 0;

  const tareas = data.map((fila, i) =>
    limit(async () => {
      const res = await procesarCamara(fila, i, progreso);
      progreso.procesadas++;
      return res;
    })
  );

  const resultado = await Promise.all(tareas);
  const ordenado = ordenarResultados(resultado);

  return generarExcel(ordenado, "todas_las_camaras.xlsx");
}

// =============================
// TEXTO
// =============================
async function analizarCamaras(lista, progreso) {
  const workbook = XLSX.readFile(archivoExcel);
  const sheet = workbook.Sheets["RESUMEN TOTAL"];
  const data = XLSX.utils.sheet_to_json(sheet, { range: 6 });

  const limit = pLimit(CONCURRENCIA);

  progreso.total = lista.length;
  progreso.procesadas = 0;
  progreso.online = 0;
  progreso.sinRespuesta = 0;
  progreso.ipVacia = 0;
  progreso.noEncontrada = 0;

  const tareas = lista.map((nombre) => {
    let fila = null;

    const codigo = extraerCodigo(nombre);

    if (codigo) {
      fila = data.find((r) => {
        const codExcel = extraerCodigo(normalizarTexto(r["[Denominacion]"]));
        return codExcel === codigo;
      });
    }

    if (!fila && nombre.toUpperCase().includes("PUNTO SEGURO")) {
      const { base, tipo } = parsearPuntoSeguro(nombre);

      fila = data.find((r) => {
        const denom = normalizarTexto(r["[Denominacion]"]);
        return denom.includes(base) && (!tipo || denom.includes(tipo));
      });
    }

    if (!fila) {
      progreso.noEncontrada++;
      progreso.procesadas++;
      return Promise.resolve({
        DENOMINACION: nombre,
        PROVEEDOR: "-",
        UBICACION: "-",
        CONEXION: "-",
        IP: "",
        LATENCIA: "-",
        ESTADO: "NO ENCONTRADA",
      });
    }

    const index = data.indexOf(fila);

    return limit(async () => {
      const res = await procesarCamara(fila, index, progreso);
      progreso.procesadas++;
      return res;
    });
  });

  const resultado = await Promise.all(tareas);
  const ordenado = ordenarResultados(resultado);

  return generarExcel(ordenado, "resultado_texto.xlsx");
}

module.exports = {
  analizarCamaras,
  analizarTodasLasCamaras,
};