// middleware/error.js — handler uniforme degli errori
module.exports = function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = Number(err.status || err.statusCode || 500);
  const body = {
    ok: false,
    error: err.code || err.name || "ERROR",
    message: err.message || "Unexpected error",
  };
  if (process.env.NODE_ENV !== "production") {
    body.stack = err.stack;
  }
  res.status(status).json(body);
};
