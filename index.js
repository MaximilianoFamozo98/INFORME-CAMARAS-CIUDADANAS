const XLSX = require("xlsx");
const ExcelJS = require("exceljs");
const ping = require("ping");
const path = require("path");
const pLimit = require("p-limit").default;

const archivoExcel = path.join(
  __dirname,
  "12-02-2026) INFORME CAMARAS APAGADAS FEBRERO.xlsx"
);

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
// PROCESAR CAMARA
// =============================
async function procesarCamara(fila, index, progreso) {
  let ip = fila["[IP]"] ? fila["[IP]"].toString() : "";
  ip = ip.replace(/[, ]/g, ".").trim();

  if (!ip) {
    progreso.ipVacia++;
    return {
      DENOMINACION: fila["[Denominacion]"],
      PROVEEDOR: fila["[Empresa Mantenimiento]"] || "-",
      UBICACION: fila["[Ubicacion]"] || "-",
      IP: "",
      ESTADO: "IP VACIA",
      filaIndex: index + 7,
    };
  }

  try {
    const res = await ping.promise.probe(ip, { timeout: 4 });

    if (res.alive) {
      progreso.online++;
      return {
        DENOMINACION: fila["[Denominacion]"],
        PROVEEDOR: fila["[Empresa Mantenimiento]"] || "-",
        UBICACION: fila["[Ubicacion]"] || "-",
        IP: ip,
        ESTADO: "ONLINE",
        filaIndex: index + 7,
      };
    } else {
      progreso.sinRespuesta++;
      return {
        DENOMINACION: fila["[Denominacion]"],
        PROVEEDOR: fila["[Empresa Mantenimiento]"] || "-",
        UBICACION: fila["[Ubicacion]"] || "-",
        IP: ip,
        ESTADO: "SIN RESPUESTA",
        filaIndex: index + 7,
      };
    }
  } catch {
    progreso.sinRespuesta++;
    return {
      DENOMINACION: fila["[Denominacion]"],
      PROVEEDOR: fila["[Empresa Mantenimiento]"] || "-",
      UBICACION: fila["[Ubicacion]"] || "-",
      IP: ip,
      ESTADO: "ERROR",
      filaIndex: index + 7,
    };
  }
}

// =============================
// FILA ROJA
// =============================
function esFilaRoja(filaExcel) {
  let esRoja = false;

  filaExcel.eachCell({ includeEmpty: true }, (cell) => {
    if (cell.fill?.fgColor?.argb) {
      const color = cell.fill.fgColor.argb.toUpperCase();
      const r = parseInt(color.substring(2, 4), 16);
      const g = parseInt(color.substring(4, 6), 16);
      const b = parseInt(color.substring(6, 8), 16);

      if (r > 200 && g < 100 && b < 100) esRoja = true;
    }
  });

  return esRoja;
}

// =============================
// EXCEL
// =============================
async function generarExcel(resultado, nombre) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Resultado");

  ws.columns = [
    { header: "DENOMINACION", key: "DENOMINACION", width: 40 },
    { header: "PROVEEDOR", key: "PROVEEDOR", width: 20 },
    { header: "UBICACION", key: "UBICACION", width: 40 },
    { header: "IP", key: "IP", width: 18 },
    { header: "ESTADO", key: "ESTADO", width: 20 },
  ];

  const wbEstilos = new ExcelJS.Workbook();
  await wbEstilos.xlsx.readFile(archivoExcel);
  const sheetEstilos = wbEstilos.getWorksheet("RESUMEN TOTAL");

  resultado.forEach((r) => {
    const row = ws.addRow(r);

    if (r.filaIndex) {
      const filaExcel = sheetEstilos.getRow(r.filaIndex);
      if (esFilaRoja(filaExcel)) {
        row.eachCell((cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFFF0000" },
          };
        });
      }
    }
  });

  const ruta = path.join(__dirname, nombre);
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

  const limit = pLimit(2);

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
  return generarExcel(resultado, "todas_las_camaras.xlsx");
}

// =============================
// TEXTO
// =============================
async function analizarCamaras(lista, progreso) {
  const workbook = XLSX.readFile(archivoExcel);
  const sheet = workbook.Sheets["RESUMEN TOTAL"];
  const data = XLSX.utils.sheet_to_json(sheet, { range: 6 });

  const limit = pLimit(2);

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
        IP: "",
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
  return generarExcel(resultado, "resultado_texto.xlsx");
}

module.exports = {
  analizarCamaras,
  analizarTodasLasCamaras,
};