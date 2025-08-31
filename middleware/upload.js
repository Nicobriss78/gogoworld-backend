// middleware/upload.js — GoGoWorld.life
// Upload CSV (multer) per import massivo eventi

const os = require("os");
const path = require("path");
const multer = require("multer");

// Limite dimensione configurabile (default 2MB)
function getMaxBytes() {
  const mb = parseInt(process.env.CSV_MAX_SIZE_MB || "2", 10);
  return (isNaN(mb) || mb <= 0 ? 2 : mb) * 1024 * 1024;
}

// Storage temporaneo su FS (Render: /tmp è supportato)
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, os.tmpdir());
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".csv";
    const base = path.basename(file.originalname, ext).replace(/[^\w.-]+/g, "_");
    cb(null, `${base}-${Date.now()}${ext}`);
  },
});

// Accetta solo CSV (mimetype + fallback estensione .csv)
const CSV_MIMES = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel", // alcuni browser usano questo per CSV
]);

function fileFilter(_req, file, cb) {
  const mimetypeOk = CSV_MIMES.has(file.mimetype);
  const extOk = path.extname(file.originalname || "").toLowerCase() === ".csv";

  if (mimetypeOk || extOk) {
    return cb(null, true);
  }
  const err = new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname);
  err.message = "Tipo file non supportato: carica un file .csv";
  return cb(err);
}

const uploadCsv = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: getMaxBytes(), // es. 2MB (configurabile via CSV_MAX_SIZE_MB)
    files: 1,
    fields: 20, // tollerante
  },
});

module.exports = { uploadCsv };
