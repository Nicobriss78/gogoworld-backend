// src/internal/middleware/auditLog.js
const fs = require('fs');
const path = require('path');

const auditPath = process.env.AUDIT_FILE || path.join(process.cwd(), 'storage', 'audit.jsonl');

function auditLog(req, res, next) {
  const start = Date.now();
  const { method, originalUrl, headers, body } = req;
  const entry = {
    ts: new Date().toISOString(),
    method,
    url: originalUrl,
    ip: req.ip,
    ua: headers['user-agent'],
    body
  };
  const write = (obj) => {
    try {
      fs.appendFileSync(auditPath, JSON.stringify(obj) + '\n');
    } catch (err) {
      // non bloccare la request per errori di logging
      // console.error('Audit write error', err);
    }
  };
  write({ type: 'request', ...entry });
  const oldJson = res.json.bind(res);
  res.json = (data) => {
    const dur = Date.now() - start;
    write({ type: 'response', url: originalUrl, status: res.statusCode, durMs: dur });
    return oldJson(data);
  };
  next();
}

module.exports = { auditLog };
