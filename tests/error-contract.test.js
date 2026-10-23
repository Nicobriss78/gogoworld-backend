"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { errorHandler } = require("../middleware/error");
const Event = require("../models/eventModel");
const { accessPrivateEventByCode } = require("../controllers/eventController");

function mockRes(initialStatus = 200) {
  return {
    statusCode: initialStatus,
    body: undefined,
    status(value) { this.statusCode = value; return this; },
    json(body) { this.body = body; return this; },
  };
}

function handle(err, initialStatus = 200) {
  const res = mockRes(initialStatus);
  errorHandler(err, {}, res, () => {});
  return res;
}

test("008 HTTP matrix: preserve statuses and classify public application codes", () => {
  for (const [status, expectedCode] of [
    [400, "BAD_REQUEST"], [401, "UNAUTHORIZED"], [403, "FORBIDDEN"],
    [404, "NOT_FOUND"], [409, "CONFLICT"], [410, "GONE"],
    [422, "UNPROCESSABLE_ENTITY"], [500, "SERVER_ERROR"],
  ]) {
    const res = handle(new Error("Messaggio controllato"), status);
    assert.equal(res.statusCode, status, `status ${status}`);
    assert.equal(res.body.ok, false, `status ${status}`);
    assert.equal(res.body.code, expectedCode, `status ${status}`);
  }
});

test("008 explicit status precedence over response's inherited status", () => {
  const error = new Error("Conflitto");
  error.status = 409;
  const res = handle(error, 403);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "CONFLICT");
});

test("008 EVENT_PAST public code is permitted only with HTTP 410", () => {
  const past = new Error("Questo evento privato è già concluso");
  past.publicCode = "EVENT_PAST";
  const res = handle(past, 410);
  assert.equal(res.statusCode, 410);
  assert.equal(res.body.code, "EVENT_PAST");
  assert.equal(res.body.error, past.message);

  const mismatched = handle(Object.assign(new Error("Errore"), { publicCode: "EVENT_PAST" }), 409);
  assert.equal(mismatched.body.code, "CONFLICT");
});

test("008 untrusted error codes and invented public codes are never forwarded", () => {
  const internal = Object.assign(new Error("Conflitto"), { code: "MONGO_SECRET_INTERNAL", publicCode: "ARBITRARY_CODE" });
  const res = handle(internal, 409);
  assert.equal(res.body.code, "CONFLICT");
  assert.notEqual(res.body.code, internal.code);
});

test("008 special Mongoose ValidationError classification is unchanged", () => {
  const err = Object.assign(new Error("schema"), {
    name: "ValidationError",
    errors: { name: { message: "Nome obbligatorio" } },
  });
  const res = handle(err, 500);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "VALIDATION_ERROR");
  assert.equal(res.body.error, "Nome obbligatorio");
});

test("008 CastError classification is unchanged", () => {
  const res = handle(Object.assign(new Error("bad cast"), { name: "CastError" }), 500);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "INVALID_ID");
  assert.equal(res.body.error, "ID non valido");
});

test("008 Mongo duplicate key classification is unchanged", () => {
  const err = Object.assign(new Error("E11000"), { code: 11000, keyValue: { email: "test@example.invalid" } });
  const res = handle(err, 500);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "EMAIL_IN_USE");
  assert.equal(res.body.error, "Email già registrata");
});

test("008 JWT branches preserve 401 and public codes", () => {
  for (const [name, expected] of [["JsonWebTokenError", "INVALID_TOKEN"], ["TokenExpiredError", "TOKEN_EXPIRED"]]) {
    const res = handle(Object.assign(new Error("sensitive"), { name }), 500);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, expected);
    assert.doesNotMatch(res.body.error, /sensitive/);
  }
});

test("008 CORS denied classification unchanged", () => {
  const res = handle(Object.assign(new Error("Not allowed by CORS"), { code: "CORS_NOT_ALLOWED" }), 500);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "CORS_NOT_ALLOWED");
  assert.equal(res.body.error, "Origin non consentito");
});

test("008 production 500 redacts sensitive content and stack", () => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const err = new Error("MONGO_URL=private-value / token=secret");
    err.error = "Private DB details";
    err.code = "MONGO_INTERNAL_CODE";
    const res = handle(err, 500);
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { ok: false, error: "Errore interno inatteso", code: "SERVER_ERROR" });
  } finally {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
  }
});

test("008 production 4xx preserves established controller-facing error message", () => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const res = handle(new Error("Codice invito mancante"), 400);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "Codice invito mancante");
    assert.equal(res.body.code, "BAD_REQUEST");
    assert.equal("stack" in res.body, false);
  } finally {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
  }
});

test("008 unhandled exception remains 500 SERVER_ERROR", () => {
  const res = handle(new Error("unexpected"), 200);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.code, "SERVER_ERROR");
});

test("008 actual past private event access: 410 EVENT_PAST and no participant mutation", async (t) => {
  const originalFindOne = Event.findOne;
  t.after(() => { Event.findOne = originalFindOne; });
  const userId = "64b000000000000000008888";
  let saveCount = 0;
  let query;
  const event = {
    visibility: "private",
    approvalStatus: "approved",
    dateStart: new Date("2020-01-01T10:00:00.000Z"),
    dateEnd: new Date("2020-01-01T12:00:00.000Z"),
    participants: [],
    revokedUsers: [],
    async save() { saveCount += 1; },
  };
  Event.findOne = (filter) => {
    query = filter;
    return { populate: async () => event };
  };
  const req = { body: { code: "TEST-008" }, user: { _id: userId } };
  const res = mockRes();
  let propagated;
  await accessPrivateEventByCode(req, res, (err) => { propagated = err; });
  assert.equal(res.statusCode, 410);
  assert.ok(propagated);
  assert.equal(propagated.publicCode, "EVENT_PAST");
  errorHandler(propagated, req, res, () => {});
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, "Questo evento privato è già concluso");
  assert.equal(res.body.code, "EVENT_PAST");
  assert.equal(saveCount, 0);
  assert.deepEqual(event.participants, []);
  assert.equal(query.visibility, "private");
  assert.equal(query.approvalStatus, "approved");
});
