const User = require("../models/userModel");
const CheckIn = require("../models/checkInModel");

function getDistanceBand(distanceMeters) {
  if (distanceMeters <= 500) return "0-500m";
  if (distanceMeters <= 1000) return "500m-1km";
  if (distanceMeters <= 3000) return "1-3km";
  return "3km+";
}

async function getNearbyGeoRecipients({ event, organizerId, radiusMeters }) {
  if (!event?.location?.coordinates?.length) {
    return [];
  }

  const [lon, lat] = event.location.coordinates;

  const nearbyUsers = await User.find({
    _id: { $ne: organizerId },
    role: "participant",
    "profile.locationConsent.enabled": true,
    "profile.lastKnownLocation": {
      $near: {
        $geometry: {
          type: "Point",
          coordinates: [lon, lat]
        },
        $maxDistance: radiusMeters
      }
    }
  })
    .select("_id profile.lastKnownLocation")
    .lean();

  if (!nearbyUsers.length) {
    return [];
  }

  const checkedInUsers = await CheckIn.find({
    eventId: event._id,
    userId: { $in: nearbyUsers.map((u) => u._id) }
  })
    .select("userId")
    .lean();

  const checkedInSet = new Set(
    checkedInUsers.map((entry) => String(entry.userId))
  );

  return nearbyUsers
    .filter((user) => !checkedInSet.has(String(user._id)))
    .map((user) => {
      const userCoords = user?.profile?.lastKnownLocation?.coordinates || [];
      const userLon = Number(userCoords[0]);
      const userLat = Number(userCoords[1]);

      const distanceMeters = calculateDistanceMeters(
        lat,
        lon,
        userLat,
        userLon
      );

      return {
        userId: user._id,
        distanceMeters,
        distanceBand: getDistanceBand(distanceMeters)
      };
    });
}

function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;

  const earthRadius = 6371000;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(earthRadius * c);
}

module.exports = {
  getNearbyGeoRecipients
};
