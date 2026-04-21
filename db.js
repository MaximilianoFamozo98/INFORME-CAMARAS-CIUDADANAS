const mongoose = require("mongoose");

mongoose.connect("mongodb://127.0.0.1:27017/camaras");

mongoose.connection.on("open", () => {
  console.log("✅ MongoDB conectado LOCAL");
});

mongoose.connection.on("error", (err) => {
  console.log("❌ Error Mongo:", err);
});