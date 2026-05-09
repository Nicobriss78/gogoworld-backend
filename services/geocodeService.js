const DEFAULT_NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
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
    .map(clean)
    .filter(Boolean)
    .join(" ");

  const venueName = clean(input.venueName);
  const city = clean(input.city);
  const postalCode = clean(input.postalCode);
  const region = clean(input.region);
  const country = normalizeCountry(input.country);

  const queries = [];

  if (streetLine || postalCode) {
    queries.push(
      [streetLine, postalCode, city, region, country],
      [streetLine, city, region, country],
      [postalCode, city, region, country]
    );
  }

  if (venueName) {
  queries.push(
    [`${venueName} ${city} ${region} ${country}`],
    [`${venueName} ${city}`],
    [`${venueName} ${region}`],
    [`${venueName} ${region} ${country}`],
    [`${venueName} ${region} Italia`],
    [`${venueName} ${country}`],
    [venueName, city, region, country],
    [venueName, city, country],
    [venueName, region, country]
  );
}

  if (!venueName) {
    queries.push([city, region, country]);
  }

  if (input.q) {
    queries.unshift(clean(input.q));
  }

  return [...new Set(
    queries
      .map((parts) => parts.map(clean).filter(Boolean).join(", "))
      .filter(Boolean)
  )];
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
function normalizeStreet(address = {}) {
  return (
    address.road ||
    address.pedestrian ||
    address.footway ||
    address.residential ||
    address.path ||
    ""
  );
}

function normalizeVenueName(item = {}, address = {}) {
  return (
    item.name ||
    address.amenity ||
    address.shop ||
    address.tourism ||
    address.leisure ||
    ""
  );
}

function normalizeReverseResult(item) {
  const address = item.address || {};

  return {
    label: item.display_name || "",
    lat: Number(item.lat),
    lon: Number(item.lon),
    venueName: normalizeVenueName(item, address),
    street: normalizeStreet(address),
    streetNumber: address.house_number || "",
    city: address.city || address.town || address.village || "",
    province: address.county || "",
    region: address.state || "",
    country: address.country_code ? address.country_code.toUpperCase() : "",
    postalCode: address.postcode || "",
    provider: "nominatim",
  };
}

function readCoordinate(input = {}, keys = []) {
  for (const key of keys) {
    if (input[key] !== undefined && input[key] !== null && input[key] !== "") {
      return Number(input[key]);
    }
  }

  return NaN;
}

function normalizeCoordinates(input = {}) {
  const lat = readCoordinate(input, ["lat", "latitude"]);
  const lon = readCoordinate(input, ["lon", "lng", "longitude"]);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    const error = new Error("invalid_coordinates");
    error.statusCode = 400;
    throw error;
  }

  return { lat, lon };
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
async function fetchNominatimReverse(baseUrl, coordinates) {
  const zoomLevels = [18, 17, 16, 14, 12, 10];

  for (const zoom of zoomLevels) {
    const url = new URL(baseUrl);

    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("lat", String(coordinates.lat));
    url.searchParams.set("lon", String(coordinates.lon));
    url.searchParams.set("zoom", String(zoom));

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
          "User-Agent":
            process.env.GEOCODE_USER_AGENT || "GoGoWorld.life/1.0",
          Accept: "application/json",
        },
      });

      if (!response.ok) continue;

      const json = await response.json();

      if (!json || json.error) continue;

      const result = normalizeReverseResult(json);

      const hasUsefulData =
        result.city ||
        result.province ||
        result.region ||
        result.country;

      if (
        Number.isFinite(result.lat) &&
        Number.isFinite(result.lon) &&
        hasUsefulData
      ) {
        return result;
      }
    } catch (_) {
      // continua con zoom successivo
    } finally {
      clearTimeout(timeout);
    }
  }

  return null;
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

async function reverseGeocode(input = {}) {
  const coordinates = normalizeCoordinates(input);
  const cacheKey = `reverse:${coordinates.lat.toFixed(6)},${coordinates.lon.toFixed(6)}`;
  const cached = cache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const baseUrl =
    process.env.GEOCODE_NOMINATIM_REVERSE_URL ||
    DEFAULT_NOMINATIM_REVERSE_URL;

  await waitProviderSlot();

  const result = await fetchNominatimReverse(baseUrl, coordinates);

  const data = {
    ok: true,
    lat: coordinates.lat,
    lon: coordinates.lon,
    result,
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
  reverseGeocode,
};
