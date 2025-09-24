// middleware/error.js
// Handler centralizzato degli errori applicativi (R2: messaggi normalizzati)

// Costruisce status + payload coerenti per il FE
function buildErrorPayload(err, req, res) {
  // Se il controller ha già impostato uno status, rispettalo; altrimenti 500
  // 🔧 PATCH: corregge precedenza operatori per usare correttamente res.statusCode se diverso da 200
  const status = err.status || (res.statusCode && res.statusCode !== 200 ? res.statusCode : 500);

  let message = "Errore interno inatteso";
  let code = "SERVER_ERROR";
  // ---- CORS negato ----
  if (err?.code === "CORS_NOT_ALLOWED" || /not allowed by cors/i.test(err?.message || "")) {
    return {
      status: err.status || 403,
      payload: {
        ok: false,
        error: "Origin non consentito",
        code: "CORS_NOT_ALLOWED",
        ...(process.env.NODE_ENV !== "production" && err.stack ? { stack: err.stack } : {}),
      },
    };
  }


  // ---- Mongoose ValidationError (schema) ----
  if (err?.name === "ValidationError") {
    const details = Object.values(err.errors || {})
      .map((e) => e?.message)
      .filter(Boolean);
    return {
      status: 400,
      payload: {
        ok: false,
        error: details.length ? details.join("; ") : "Dati non validi",
        code: "VALIDATION_ERROR",
        ...(process.env.NODE_ENV !== "production" && err.stack ? { stack: err.stack } : {}),
      },
    };
  }

  // ---- Mongoose CastError (ObjectId o type mismatch) ----
  if (err?.name === "CastError") {
    return {
      status: 400,
      payload: {
        ok: false,
        error: "ID non valido",
        code: "INVALID_ID",
        ...(process.env.NODE_ENV !== "production" && err.stack ? { stack: err.stack } : {}),
      },
    };
  }

  // ---- Mongo duplicate key (vincoli unique) ----
  if (err?.code === 11000 || err?.code === "E11000") {
    const fields = Object.keys(err.keyValue || err.keyPattern || {});
    let dupMsg = "Valore duplicato";
    let dupCode = "DUPLICATE_KEY";
    if (fields.includes("email")) {
      dupMsg = "Email già registrata";
      dupCode = "EMAIL_IN_USE";
    } else if (fields.length) {
      dupMsg = `Valore duplicato per: ${fields.join(", ")}`;
    }
    return {
      status: 400,
      payload: {
        ok: false,
        error: dupMsg,
        code: dupCode,
        ...(process.env.NODE_ENV !== "production" && err.stack ? { stack: err.stack } : {}),
      },
    };
  }

  // ---- JWT ----
  if (err?.name === "JsonWebTokenError") {
    return {
      status: 401,
      payload: {
        ok: false,
        error: "Token non valido",
        code: "INVALID_TOKEN",
        ...(process.env.NODE_ENV !== "production" && err.stack ? { stack: err.stack } : {}),
      },
    };
  }
  if (err?.name === "TokenExpiredError") {
    return {
      status: 401,
      payload: {
        ok: false,
        error: "Sessione scaduta, effettua di nuovo il login",
        code: "TOKEN_EXPIRED",
        ...(process.env.NODE_ENV !== "production" && err.stack ? { stack: err.stack } : {}),
      },
    };
  }

  // ---- 401/403/404 impostati a monte ----
  if ((err?.status || status) === 401) {
    return {
      status: 401,
      payload: {
        ok: false,
        error: err?.error || err?.message || "Non autorizzato",
        code: "UNAUTHORIZED",
        ...(process.env.NODE_ENV !== "production" && err.stack ? { stack: err.stack } : {}),
      },
    };
  }
  if ((err?.status || status) === 403) {
    return {
      status: 403,
      payload: {
        ok: false,
        error: err?.error || err?.message || "Accesso vietato",
        code: "FORBIDDEN", // 🔧 PATCH
        ...(process.env.NODE_ENV !== "production" && err.stack ? { stack: err.stack } : {}),
      },
    };
  }
  if ((err?.status || status) === 404) {
    return {
      status: 404,
      payload: {
        ok: false,
        error: err?.error || err?.message || "Risorsa non trovata",
        code: "NOT_FOUND",
        ...(process.env.NODE_ENV !== "production" && err.stack ? { stack: err.stack } : {}),
      },
    };
  }

  // ---- Fallback: mantieni il messaggio del controller se c'è ----
  if (err?.message) {
    message = err.message;
  }

  return {
    status: status || 500,
    payload: {
      ok: false,
      error: err?.error || message || "INTERNAL_ERROR",
      code,
      ...(process.env.NODE_ENV !== "production" && err.stack ? { stack: err.stack } : {}),
    },
  };
}

function errorHandler(err, req, res, _next) { // eslint-disable-line
  const { status, payload } = buildErrorPayload(err, req, res);
  res.status(status).json(payload);
}

module.exports = { errorHandler };
