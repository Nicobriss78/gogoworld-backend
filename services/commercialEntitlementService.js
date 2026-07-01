// backend/services/commercialEntitlementService.js
// Commercial Foundation V1 - Entitlement service
// Responsabilità: trasformare eventi/ordini in entitlement commerciali.
// Non patcha controller. Non contiene logica UI. Non approva eventi o promo.

const CommercialOrder = require("../models/commercialOrderModel");
const commercialWalletService = require("./commercialWalletService");

const FREE_EVENT_TRILLS_QUANTITY = 2;

function buildCommercialError(code, status = 400, message = code) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.statusCode = status;
  return err;
}

function normalizeString(value) {
  return String(value || "").trim();
}

function resolveEventOrganizerId(event) {
  return event.organizer || event.organizerId || event.createdBy || event.user || null;
}

function resolveEventEndDate(event) {
  return event.dateEnd || event.endDate || event.endsAt || event.date || event.startDate || null;
}

function assertEventForFreeGrant(event) {
  if (!event || !event._id) {
    throw buildCommercialError(
      "FREE_TRILL_EVENT_REQUIRED",
      400,
      "A valid event is required to grant free trills."
    );
  }

  const organizerId = resolveEventOrganizerId(event);
  if (!organizerId) {
    throw buildCommercialError(
      "FREE_TRILL_EVENT_ORGANIZER_REQUIRED",
      400,
      "Event organizer is required to grant free trills."
    );
  }

  const expiresAt = resolveEventEndDate(event);
  if (!expiresAt) {
    throw buildCommercialError(
      "FREE_TRILL_EVENT_END_DATE_REQUIRED",
      400,
      "Event end date is required to grant free trills."
    );
  }

  return {
    organizerId,
    eventId: event._id,
    expiresAt,
  };
}

async function grantFreeEventTrills(event, options = {}) {
  const { organizerId, eventId, expiresAt } = assertEventForFreeGrant(event);

  const idempotencyKey =
    normalizeString(options.idempotencyKey) || `event_approval_free_grant:${eventId}`;

  return commercialWalletService.grantResource({
    organizerId,
    resourceType: "free.trill.base",
    quantity: FREE_EVENT_TRILLS_QUANTITY,
    scope: "event",
    geoScopeType: "none",
    isFree: true,
    grantedByEventId: eventId,
    usableByEventId: eventId,
    expiresAt,

    source: {
      type: "event_approval",
      eventId,
      adminId: options.adminId || null,
    },

    idempotencyKey,
    reason:
      options.reason ||
      "Free event trills granted on first event approval.",
    metadata: {
      eventTitle: event.title || null,
      freeEventTrillsQuantity: FREE_EVENT_TRILLS_QUANTITY,
      backendStage: "commercial_foundation_v1_entitlements",
      ...(options.metadata || {}),
    },
  });
}

function assertOrderForGrant(order) {
  if (!order || !order._id) {
    throw buildCommercialError(
      "COMMERCIAL_ORDER_REQUIRED",
      400,
      "A valid commercial order is required."
    );
  }

  if (order.ownerType !== "organizer") {
    throw buildCommercialError(
      "COMMERCIAL_ORDER_OWNER_NOT_SUPPORTED",
      400,
      "Only organizer orders are supported in Commercial Foundation V1."
    );
  }

  if (!order.ownerId) {
    throw buildCommercialError(
      "COMMERCIAL_ORDER_OWNER_REQUIRED",
      400,
      "Order ownerId is required."
    );
  }

  if (!["paid", "completed"].includes(order.status)) {
    throw buildCommercialError(
      "COMMERCIAL_ORDER_NOT_COMPLETABLE",
      409,
      "Order must be paid or completed before granting resources."
    );
  }

  if (!["paid", "not_required"].includes(order.paymentStatus)) {
    throw buildCommercialError(
      "COMMERCIAL_ORDER_PAYMENT_NOT_CONFIRMED",
      409,
      "Order payment must be confirmed before granting resources."
    );
  }

  if (!Array.isArray(order.resourcesToGrant) || order.resourcesToGrant.length === 0) {
    throw buildCommercialError(
      "COMMERCIAL_ORDER_RESOURCES_REQUIRED",
      400,
      "Order has no resources to grant."
    );
  }
}

function resolveResourceExpiration(resource) {
  if (resource.expiresAt) return resource.expiresAt;

  if (resource.validityDays) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + Number(resource.validityDays));
    return expiresAt;
  }

  return null;
}

async function grantPurchasedResources(orderInput, options = {}) {
  const order =
    typeof orderInput === "string"
      ? await CommercialOrder.findById(orderInput)
      : orderInput;

  assertOrderForGrant(order);

  const results = [];

  for (let i = 0; i < order.resourcesToGrant.length; i += 1) {
    const resource = order.resourcesToGrant[i];

        const baseIdempotencyKey =
      normalizeString(options.idempotencyKey) ||
      `commercial_order_resource_grant:${order._id}`;

    const idempotencyKey = `${baseIdempotencyKey}:${i}`;

    const result = await commercialWalletService.grantResource({
      organizerId: order.ownerId,
      resourceType: resource.resourceType,
      quantity: resource.quantity,
      scope: resource.scope || "organizer",
      geoScopeType: resource.geoScopeType || "none",
      isFree: false,
      expiresAt: resolveResourceExpiration(resource),

      source: {
        type: "commercial_order",
        orderId: order._id,
        eventId: order.related && order.related.eventId ? order.related.eventId : null,
        bannerId: order.related && order.related.bannerId ? order.related.bannerId : null,
        trillId: order.related && order.related.trillId ? order.related.trillId : null,
        adminId: options.adminId || order.createdByAdminId || null,
      },

      idempotencyKey,
      reason:
        options.reason ||
        "Purchased resources granted from commercial order.",
      metadata: {
        orderId: String(order._id),
        productCode: order.productCode || null,
        channel: order.channel || null,
        resourceIndex: i,
        backendStage: "commercial_foundation_v1_entitlements",
        ...(resource.metadata || {}),
        ...(options.metadata || {}),
      },
    });

    results.push(result);
  }

  if (order.status !== "completed") {
    order.status = "completed";
    order.completedAt = order.completedAt || new Date();
    await order.save();
  }

  return {
    order: order.toObject ? order.toObject() : order,
    grants: results,
  };
}

module.exports = {
  FREE_EVENT_TRILLS_QUANTITY,
  grantFreeEventTrills,
  grantPurchasedResources,
};
