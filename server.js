// server.js (estratto completo, con aggiunta error handler)
const express = require("express");
const app = express();
const cors = require("cors");
const morgan = require("morgan");
const dotenv = require("dotenv");
dotenv.config();

const userRoutes = require("./routes/userRoutes");
const eventRoutes = require("./routes/eventRoutes");
const welcomeRoutes = require("./routes/welcome");
const { errorHandler } = require("./middleware/error"); // <— AGGIUNTO

// CORS (se in server unico si può rimuovere/lasciare vuoto)
const origins = (process.env.CORS_ORIGIN_FRONTEND || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors(origins.length ? { origin: origins } : {}));
app.use(express.json());
app.use(morgan("dev"));

// DB
require("./db");

// Routes
app.use("/api/users", userRoutes);
app.use("/api/events", eventRoutes);
app.use("/welcome", welcomeRoutes);

// (montaggio condizionale /internal in base ai flag esistenti)
// ... il tuo codice attuale qui resta invariato ...

// Error handler — deve rimanere l’ULTIMO middleware
app.use(errorHandler); // <— AGGIUNTO

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`GoGo.World backend running on port ${PORT}`);
});





















