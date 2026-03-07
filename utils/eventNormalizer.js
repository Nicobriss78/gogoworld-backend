function safeString(v) {
  return typeof v === "string" ? v.trim() : "";
}

function nullableString(v) {
  const s = safeString(v);
  return s.length ? s : null;
}

function toIsoOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeStringArray(v) {
  if (Array.isArray(v)) {
    return v.map((x) => safeString(x)).filter(Boolean);
  }
  if (typeof v === "string") {
    const s = v.trim();
    return s ? [s] : [];
  }
  return [];
}

function getCoordinates(doc) {
  const latFlat = toNumberOrNull(doc?.lat);
  const lonFlat = toNumberOrNull(doc?.lon);

  if (latFlat !== null || lonFlat !== null) {
    return { lat: latFlat, lon: lonFlat };
  }

  const coords = Array.isArray(doc?.location?.coordinates)
    ? doc.location.coordinates
    : null;

  if (coords && coords.length >= 2) {
    const lon = toNumberOrNull(coords[0]);
    const lat = toNumberOrNull(coords[1]);
    return { lat, lon };
  }

  return { lat: null, lon: null };
}

function buildAddress(doc) {
  const explicit = nullableString(doc?.address);
  if (explicit) return explicit;

  const street = safeString(doc?.street);
  const streetNumber = safeString(doc?.streetNumber);

  if (street && streetNumber) return `${street}, ${streetNumber}`;
  if (street) return street;
  if (streetNumber) return streetNumber;

  return null;
}

function normalizeOrganizer(organizer) {
  if (!organizer) {
    return {
      id: null,
      name: null,
      avatarUrl: null,
    };
  }

  if (typeof organizer === "string") {
    return {
      id: organizer,
      name: null,
      avatarUrl: null,
    };
  }

  return {
    id: organizer?._id ? String(organizer._id) : organizer?.id ? String(organizer.id) : null,
    name: nullableString(organizer?.displayName || organizer?.name || organizer?.username),
    avatarUrl: nullableString(organizer?.avatarUrl || organizer?.avatar || organizer?.profileImage),
  };
}

function normalizeEventForClient(doc) {
  const raw = typeof doc?.toObject === "function" ? doc.toObject() : { ...(doc || {}) };

  const id = raw?._id ? String(raw._id) : raw?.id ? String(raw.id) : "";
  const title = safeString(raw?.title || raw?.name || raw?.eventTitle);
  const description = safeString(raw?.description);

  const startAt = toIsoOrNull(raw?.dateStart || raw?.date);
  const endAt = toIsoOrNull(raw?.dateEnd || raw?.endDate);

  const { lat, lon } = getCoordinates(raw);

  const coverUrl =
    nullableString(raw?.coverImage) ||
    nullableString(raw?.coverUrl) ||
    nullableString(raw?.image) ||
    nullableString(raw?.imageUrl) ||
    (Array.isArray(raw?.images) && raw.images.length ? nullableString(raw.images[0]) : null);

  const gallery = normalizeStringArray(raw?.images);

  const isFree =
    raw?.isFree === true
      ? true
      : raw?.isFree === false
      ? false
      : !(toNumberOrNull(raw?.price) > 0);

  const amount = isFree ? null : toNumberOrNull(raw?.price);
  const currency = isFree ? (nullableString(raw?.currency) || null) : (nullableString(raw?.currency) || "EUR");

  const visibility =
    raw?.visibility === "private" || raw?.isPrivate === true
      ? "private"
      : "public";

  const organizer = normalizeOrganizer(raw?.organizer);

  const participantsCount = Array.isArray(raw?.participants) ? raw.participants.length : 0;

  return {
    ...raw,

    id,
    title,
    description,
    visibility,

    schedule: {
      startAt,
      endAt,
      timezone: nullableString(raw?.timezone) || "Europe/Rome",
    },

    location: {
      ...(raw?.location && typeof raw.location === "object" ? raw.location : {}),
      venue: nullableString(raw?.venueName),
      name: nullableString(raw?.venueName),
      city: nullableString(raw?.city),
      province: nullableString(raw?.province),
      postalCode: nullableString(raw?.postalCode),
      region: nullableString(raw?.region),
      country: nullableString(raw?.country),
      address: buildAddress(raw),
      coordinates: { lat, lon },
      lat,
      lon,
    },

    pricing: {
      isFree,
      isPaid: !isFree,
      amount,
      price: amount,
      currency,
      label: isFree ? "Gratuito" : amount !== null ? `${amount} ${currency || "EUR"}` : null,
    },

    media: {
      coverUrl,
      gallery,
    },

    organizer,

    meta: {
      createdAt: toIsoOrNull(raw?.createdAt),
      updatedAt: toIsoOrNull(raw?.updatedAt),
      createdBy:
        raw?.createdBy?._id
          ? String(raw.createdBy._id)
          : raw?.createdBy
          ? String(raw.createdBy)
          : null,
    },

    participantsCount,
  };
}

module.exports = {
  normalizeEventForClient,
};
