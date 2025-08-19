// middleware/error.js
// Handler centralizzato degli errori applicativi

function errorHandler(err, req, res, next) { // eslint-disable-line
  const status = err.status || 500;
  const payload = {
    ok: false,
    error: err.error || err.message || "INTERNAL_ERROR",
  };
  if (process.env.NODE_ENV !== "production" && err.stack) {
    payload.details = err.stack;
  }
  res.status(status).json(payload);
}

module.exports = { errorHandler };
