const mongoose = require("mongoose");

const HistorialSchema = new mongoose.Schema({
  fecha: {
    type: Date,
    default: Date.now,
  },
  camaras: [
    {
      DENOMINACION: String,
      ESTADO: String,
      PROVEEDOR: String,
      UBICACION: String,
      CONEXION: String,
      IP: String,
    },
  ],
});

module.exports = mongoose.model("Historial", HistorialSchema);