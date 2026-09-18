const bcrypt = require("bcryptjs");
const db = require("./db");

const USUARIO = "admin";
const NOMBRE = "Administrador";
const PASSWORD = "admin123";
const ROL = "ADMIN";

async function crearAdmin() {
  try {
    const existente = db
      .prepare("SELECT id FROM usuarios WHERE usuario = ?")
      .get(USUARIO);

    if (existente) {
      console.log("⚠️ El usuario admin ya existe.");
      return;
    }

    const passwordHash = await bcrypt.hash(PASSWORD, 12);

    db.prepare(`
      INSERT INTO usuarios (
        usuario,
        nombre,
        password_hash,
        rol,
        activo,
        fecha_creacion
      )
      VALUES (?, ?, ?, ?, 1, ?)
    `).run(
      USUARIO,
      NOMBRE,
      passwordHash,
      ROL,
      new Date().toISOString()
    );

    console.log("");
    console.log("=================================");
    console.log("✅ ADMINISTRADOR CREADO");
    console.log("=================================");
    console.log("Usuario: admin");
    console.log("Contraseña temporal: admin123");
    console.log("Rol: ADMIN");
    console.log("=================================");
  } catch (error) {
    console.error("❌ Error creando administrador:", error);
  } finally {
    db.close();
  }
}

crearAdmin();