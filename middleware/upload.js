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

// Istanza multer (NOTA: niente 'files:1' globale)
// 'single' a volte conteggia in modo conservativo; useremo 'fields' con maxCount per forza 1
const uploadCsv = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: getMaxBytes(), // es. 2MB (configurabile via CSV_MAX_SIZE_MB)
    // files: 1, // <- rimosso: evitiamo LIMIT_FILE_COUNT conservativo
    fields: 20, // tollerante
  },
});

/**
 * Wrapper sicuro che incapsula parsing 'fields([{name:"file",maxCount:1}])',
 * normalizza req.files -> req.file e mappa errori Multer in 4xx leggibili.
 *
 * Uso in rotta:
 * router.post("/import-csv", protect, authorize("organizer"), uploadCsvSafe, importCsv);
 */
function uploadCsvSafe(req, res, next) {
  const parse = uploadCsv.fields([{ name: "file", maxCount: 1 }]);
  parse(req, res, (err) => {
    if (!err) {
      // normalizza: controller si aspetta req.file
      if (!req.file && req.files && Array.isArray(req.files.file) && req.files.file[0]) {
        req.file = req.files.file[0];
      }
      return next();
    }

    if (err instanceof multer.MulterError) {
      // Mappa errori più comuni
      let status = 400;
      let msg = "Upload non valido";
      switch (err.code) {
        case "LIMIT_FILE_COUNT":
          msg = "Too many files (atteso 1 file CSV)";
          break;
        case "LIMIT_UNEXPECTED_FILE":
          msg = "Campo file non valido o tipo non consentito (solo .csv)";
          break;
        case "LIMIT_FILE_SIZE":
          status = 413;
          msg = "File troppo grande";
          break;
        default:
          msg = err.message || "Errore upload";
      }
      return res.status(status).json({ ok: false, error: msg, code: err.code });
    }

    // Altri errori runtime
    return res.status(400).json({ ok: false, error: err.message || "Errore upload" });
  });
}

module.exports = { uploadCsv, uploadCsvSafe };
