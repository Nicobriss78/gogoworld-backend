// backend/src/internal/middleware/auditLog.js — logging NON bloccante su file JSONL
const fs = require("fs");
const path = require("path");
const { config } = require("../../config");
const storageDir = path.join(process.cwd(), "storage");
const auditPath = config.AUDIT_FILE || path.join(storageDir, "audit.jsonl");
try { fs.mkdirSync(storageDir, { recursive: true }); } catch {}

function auditLog(req, res, next) {
  const start = Date.now();
  const { method, originalUrl, headers, body } = req;

  const write = (obj) => {
    try { fs.appendFileSync(auditPath, JSON.stringify(obj) + "\n"); }
    catch { /* non bloccare mai */ }
  };

  write({
    type: "request",
    ts: new Date().toISOString(),
    method,
    url: originalUrl,
    ip: req.ip,
    ua: headers["user-agent"],
    body
  });

  const oldJson = res.json.bind(res);
  res.json = (data) => {
    const dur = Date.now() - start;
    write({ type: "response", ts: new Date().toISOString(), url: originalUrl, status: res.statusCode, durMs: dur });
    return oldJson(data);
  };

  next();
}

module.exports = { auditLog };

