// =============================
// NORMALIZAR.JS
// Única fuente de verdad para limpiar y comparar
// nombres de cámaras en todo el proyecto.
// =============================

// -----------------------------
// normalizarNombre
// Limpia un nombre de cámara para poder COMPARARLO
// o guardarlo de forma consistente (coordenadas, historial, mapa).
// -----------------------------
function normalizarNombre(txt) {
  if (!txt) return "";

  txt = String(txt)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // saca acentos

  // Las cámaras "PUNTO SEGURO" repiten el mismo nombre base para
  // la unidad DOMO y la unidad FIJA, que son físicamente distintas
  // (coordenadas propias). Para esas conservamos la palabra;
  // para el resto, DOMO/FIJA/INTERCOMUNICADOR es ruido y se descarta.
  const esPuntoSeguro = txt.includes("PUNTO SEGURO");

  if (esPuntoSeguro) {
    txt = txt
      .replace(/\(DOMO\)/g, " DOMO ")
      .replace(/\(FIJA\)/g, " FIJA ")
      .replace(/\(INTERCOMUNICADOR\)/g, " INTERCOMUNICADOR ")
      .replace(/\(.*?\)/g, " "); // cualquier otro paréntesis sobrante
  } else {
    txt = txt
      .replace(/\(.*?\)/g, " ")
      .replace(/FIJA\s*\d*/g, " ")
      .replace(/DOMO/g, " ")
      .replace(/INTERCOMUNICADOR/g, " ");
  }

  txt = txt
    .replace(/[-_/]/g, " ")
    .replace(/\./g, " ")

    // separar letras pegadas a números: "ALT01" => "ALT 01"
    .replace(/([A-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Z])/g, "$1 $2")

    .replace(/\s+/g, " ")
    .trim();

  // ===== ALIASES conocidos =====
  // DJ 6 / DJ O6 / DJO O6 => DJO 06
  txt = txt.replace(/^DJ\s*O?\s*(\d{1,2})$/, "DJO $1");
  txt = txt.replace(/^DJO\s*O?\s*(\d{1,2})$/, "DJO $1");

  // corregir "O" usada como cero: O6 => 06
  txt = txt.replace(/\bO(\d)\b/g, "0$1");

  // DORI / DORI 1 => DORIO
  txt = txt.replace(/^DORI\s*(\d{1,2})$/, "DORIO $1");
  txt = txt.replace(/^DORIO\s*(\d{1,2})$/, "DORIO $1");

  // completar cero a la izquierda: "CEN 6" => "CEN 06"
  txt = txt.replace(/\b([A-Z]{2,10})\s(\d)\b/g, "$1 0$2");

  return txt.trim();
}

// -----------------------------
// extraerCodigo
// A partir de un nombre ya normalizado, se queda solo
// con "PREFIJO NN" (ej: "CEN 88 PLAZA CENTRAL" => "CEN 88")
// -----------------------------
function extraerCodigo(txt) {
  txt = normalizarNombre(txt);

  // casos con sufijo de texto después del código
  txt = txt.replace(/^(CAR\s\d{2}).*/, "$1");
  txt = txt.replace(/^(CEN\s\d{2}).*/, "$1");

  const partes = txt.split(" ");

  if (partes.length >= 2) {
    const prefijo = partes[0];
    const numero = partes[1];

    if (/^\d+$/.test(numero)) {
      return `${prefijo} ${numero.padStart(2, "0")}`;
    }
  }

  return txt;
}

// -----------------------------
// normalizarTexto
// Uso distinto: limpia el texto de la columna "Denominacion"
// del Excel para poder buscar coincidencias de código.
// (Ojo: a propósito NO es igual a normalizarNombre)
// -----------------------------
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

module.exports = {
  normalizarNombre,
  extraerCodigo,
  normalizarTexto,
};