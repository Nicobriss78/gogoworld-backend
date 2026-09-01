// services/eventPromotionPolicy.js
// Boundary unico per tutte le funzioni promozionali collegate a un evento.

const EVENT_NOT_PROMOTABLE = "EVENT_NOT_PROMOTABLE";

function normalizeValue(value) {
  return String(value || "").trim().toLowerCase();
}

function evaluateEventPromotionEligibility(event) {
  const visibility = normalizeValue(event?.visibility);
  const approvalStatus = normalizeValue(event?.approvalStatus);
  const isPrivate = event?.isPrivate === true || visibility === "private";

  if (isPrivate || visibility !== "public") {
    return {
      eligible: false,
      code: EVENT_NOT_PROMOTABLE,
      reason: isPrivate ? "PRIVATE_EVENT" : "EVENT_NOT_PUBLIC",
    };
  }

  if (approvalStatus !== "approved") {
    return {
      eligible: false,
      code: EVENT_NOT_PROMOTABLE,
      reason: "EVENT_NOT_APPROVED",
    };
  }

  return {
    eligible: true,
    code: null,
    reason: null,
  };
}

function isEventPromotionEligible(event) {
  return evaluateEventPromotionEligibility(event).eligible;
}

function assertEventPromotionEligible(event, { status = 409 } = {}) {
  const result = evaluateEventPromotionEligibility(event);

  if (result.eligible) {
    return result;
  }

  const error = new Error(
    "Promotional features are available only for approved public events."
  );

  error.code = result.code;
  error.reason = result.reason;
  error.status = status;
  error.statusCode = status;

  throw error;
}

module.exports = {
  EVENT_NOT_PROMOTABLE,
  evaluateEventPromotionEligibility,
  isEventPromotionEligible,
  assertEventPromotionEligible,
};
