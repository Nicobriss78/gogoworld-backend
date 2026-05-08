const DEFAULT_NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

let lastRequestAt = 0;
const cache = new Map();

function clean(value) {
  return String(value || "").trim();
}

function normalizeCountry(value) {
  const normalized = clean(value).toUpperCase();

  if (normalized === "IT") return "Italia";
  if (normalized === "UK") return "United Kingdom";
  if (normalized === "US") return "United States";

  return clean(value);
}

function buildAddressQueries(input = {}) {
  const streetLine = [input.street, input.streetNumber]
  const venueName = clean(input.venueName);
    .map(clean)
    .filter(Boolean)
    .join(" ");

  const city = clean(input.city);
  const postalCode = clean(input.postalCode);
  const region = clean(input.region);
  const country = normalizeCountry(input.country);

  const queries = [
    [streetLine, postalCode, city, region, country],
    [streetLine, city, region, country],
    [postalCode, city, region, country],
    [city, region, country],
  ]
    .map((parts) => parts.map(clean).filter(Boolean).join(", "))
    .filter(Boolean);

  if (input.q) {
    queries.unshift(clean(input.q));
  }

  return [...new Set(queries)];
}

function normalizeResult(item) {
  const address = item.address || {};

  return {
    label: item.display_name || "",
    lat: Number(item.lat),
    lon: Number(item.lon),
    city: address.city || address.town || address.village || "",
    province: address.county || "",
    region: address.state || "",
    country: address.country_code ? address.country_code.toUpperCase() : "",
    postalCode: address.postcode || "",
    provider: "nominatim",
  };
}

async function waitProviderSlot() {
  const now = Date.now();
  const diff = now - lastRequestAt;
  const minGap = Number(process.env.GEOCODE_MIN_INTERVAL_MS || 1100);

  if (diff < minGap) {
    await new Promise((resolve) => setTimeout(resolve, minGap - diff));
  }

  lastRequestAt = Date.now();
}

async function fetchNominatimQuery(baseUrl, query) {
  const url = new URL(baseUrl);

  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "5");
  url.searchParams.set("q", query);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(process.env.GEOCODE_TIMEOUT_MS || 8000)
  );

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": process.env.GEOCODE_USER_AGENT || "GoGoWorld.life/1.0",
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      return [];
    }

    const json = await response.json();

    return Array.isArray(json)
      ? json
          .map(normalizeResult)
          .filter(
            (item) =>
              Number.isFinite(item.lat) &&
              Number.isFinite(item.lon)
          )
      : [];
  } finally {
    clearTimeout(timeout);
  }
}

async function geocodeAddress(input = {}) {
  const queries = buildAddressQueries(input);

  if (!queries.length) {
    const error = new Error("geocode_query_too_short");
    error.statusCode = 400;
    throw error;
  }

  const cacheKey = queries.join("||").toLowerCase();
  const cached = cache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const baseUrl = process.env.GEOCODE_NOMINATIM_URL || DEFAULT_NOMINATIM_URL;

  let results = [];
  let successfulQuery = "";

  for (const query of queries) {
    await waitProviderSlot();

    results = await fetchNominatimQuery(baseUrl, query);

    if (results.length) {
      successfulQuery = query;
      break;
    }
  }

  const data = {
    ok: true,
    query: successfulQuery || queries[0],
    testedQueries: queries,
    results,
    attribution: "Geocoding data © OpenStreetMap contributors",
  };

  cache.set(cacheKey, {
    data,
    expiresAt: Date.now() + Number(process.env.GEOCODE_CACHE_TTL_MS || 86_400_000),
  });

  return data;
}

module.exports = {
  geocodeAddress,
};
