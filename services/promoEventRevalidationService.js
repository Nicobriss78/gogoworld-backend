// backend/services/promoEventRevalidationService.js
// Rivaluta le promozioni collegate quando un evento cambia date ed è riapprovato.

const { Banner } = require("../models/bannerModel");
const { logger } = require("../core/logger");

const REVALIDATION_TARGET_STATUSES = [
  "PENDING_REVIEW",
  "PENDING_PAYMENT",
  "SCHEDULED",
  "ACTIVE",
  "PAUSED",
];

function normalizeUtcDay(value) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  ));
}

function promoVisibleEndDay(activeTo) {
  const end = normalizeUtcDay(activeTo);
  if (!end) return null;

  end.setUTCDate(end.getUTCDate() - 1);
  return end;
}

function isPromoIncompatibleWithEvent(promo, event) {
  const promoEndDay = promoVisibleEndDay(promo.activeTo);
  const eventEndDay = normalizeUtcDay(event.dateEnd || event.dataEnd || event.endDate || event.endAt);

  if (!promoEndDay || !eventEndDay) return false;

  return promoEndDay.getTime() > eventEndDay.getTime();
}

async function revalidatePromosForEventDateChange(event, actorId = null) {
  if (!event || !event._id) {
    return {
      checked: 0,
      invalidated: 0,
    };
  }

  const promos = await Banner.find({
    type: "event_promo",
    source: "organizer",
    eventId: event._id,
    status: { $in: REVALIDATION_TARGET_STATUSES },
  }).lean();

  if (!promos.length) {
    return {
      checked: 0,
      invalidated: 0,
    };
  }

  const incompatibleIds = promos
    .filter((promo) => isPromoIncompatibleWithEvent(promo, event))
    .map((promo) => promo._id);

  if (!incompatibleIds.length) {
    return {
      checked: promos.length,
      invalidated: 0,
    };
  }

  const now = new Date();

  const previousStatusById = new Map(
    promos
      .filter((promo) => incompatibleIds.some((id) => String(id) === String(promo._id)))
      .map((promo) => [String(promo._id), promo.status])
  );

  for (const promoId of incompatibleIds) {
    const previousStatus = previousStatusById.get(String(promoId)) || null;

    await Banner.updateOne(
      { _id: promoId },
      {
        $set: {
          status: "INVALIDATED_BY_EVENT_CHANGE",
          isActive: false,
          invalidatedAt: now,
          invalidatedBy: actorId || null,
          invalidatedReason:
            "Le date dell’evento collegato sono cambiate e la promozione termina oltre la nuova fine evento.",
          invalidatedPreviousStatus: previousStatus,
          invalidatedEventStart: event.dateStart || event.dataStart || event.startDate || event.startAt || null,
          invalidatedEventEnd: event.dateEnd || event.dataEnd || event.endDate || event.endAt || null,
          invalidatedByEventId: event._id,
        },
      }
    );
  }

  logger.info("[PromoEventRevalidation] invalidated promos after event date change", {
    eventId: String(event._id),
    checked: promos.length,
    invalidated: incompatibleIds.length,
  });

  return {
    checked: promos.length,
    invalidated: incompatibleIds.length,
  };
}

module.exports = {
  revalidatePromosForEventDateChange,
};
