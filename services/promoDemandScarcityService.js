// backend/services/promoDemandScarcityService.js
// Demand / Scarcity Engine V1 — pressione promozionale Organizer V2

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(Number(value || 0) * factor) / factor;
}

function normalizeRate(value) {
  return clamp(Number(value || 0), 0, 1);
}

function getScarcityLevel(score) {
  if (score >= 85) return "VERY_HIGH";
  if (score >= 65) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

function getDemandLevel(score) {
  if (score >= 85) return "INTENSE";
  if (score >= 65) return "COMPETITIVE";
  if (score >= 40) return "ACTIVE";
  return "CALM";
}

function getPeriodPressure(score) {
  if (score >= 85) return "VERY_HIGH";
  if (score >= 65) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

function buildDemandMessage({ demandLevel, scarcityLevel }) {
  if (demandLevel === "INTENSE" || scarcityLevel === "VERY_HIGH") {
    return "Periodo molto richiesto: la competizione promozionale in questa fascia è elevata. La tua promo può comunque lavorare bene se supportata da una creatività chiara e riconoscibile.";
  }

  if (demandLevel === "COMPETITIVE" || scarcityLevel === "HIGH") {
    return "Periodo competitivo: sono già presenti altre promozioni attive o in programmazione. Una creatività curata può aiutarti a distinguerti meglio.";
  }

  if (demandLevel === "ACTIVE" || scarcityLevel === "MEDIUM") {
    return "Periodo con buona attività promozionale: la presenza di altre promo indica interesse, mantenendo ancora margine di visibilità.";
  }

  return "Periodo tranquillo: la pressione promozionale è contenuta e lo spazio selezionato offre una buona opportunità di visibilità.";
}

function calculateDemandFromAvailability(availability = {}) {
  const totalDays = Number(availability.totalDays || 0);
  const capacity = Number(availability.capacity || 0);

  const dayStatuses = Array.isArray(availability.dayStatuses)
    ? availability.dayStatuses
    : [];

  const limitedDays = Array.isArray(availability.limitedDays)
    ? availability.limitedDays
    : [];

  const blockedDays = Array.isArray(availability.blockedDays)
    ? availability.blockedDays
    : [];

  const usableDays = dayStatuses.length ? dayStatuses : [...limitedDays, ...blockedDays];

  const occupancyRates = usableDays.map((day) => {
    const used = Number(day.used || day.occupied || 0);
    const dayCapacity = Number(day.capacity || capacity || 0);

    if (!dayCapacity) return 0;

    return normalizeRate(used / dayCapacity);
  });

  const averageOccupancyRate = occupancyRates.length
    ? occupancyRates.reduce((sum, value) => sum + value, 0) / occupancyRates.length
    : 0;

  const peakOccupancyRate = occupancyRates.length
    ? Math.max(...occupancyRates)
    : 0;

  const limitedDaysCount = limitedDays.length;
  const blockedDaysCount = blockedDays.length;

  const limitedRatio = totalDays > 0 ? limitedDaysCount / totalDays : 0;
  const blockedRatio = totalDays > 0 ? blockedDaysCount / totalDays : 0;

  const competitionScore = clamp(
    Math.round(
      averageOccupancyRate * 45 +
      peakOccupancyRate * 30 +
      limitedRatio * 15 +
      blockedRatio * 10
    ),
    0,
    100
  );

  const scarcityLevel = getScarcityLevel(competitionScore);
  const demandLevel = getDemandLevel(competitionScore);
  const periodPressure = getPeriodPressure(competitionScore);

  return {
    competitionScore,
    scarcityLevel,
    demandLevel,
    periodPressure,
    message: buildDemandMessage({ demandLevel, scarcityLevel }),
    signals: {
      averageOccupancyRate: round(averageOccupancyRate),
      peakOccupancyRate: round(peakOccupancyRate),
      limitedDaysCount,
      blockedDaysCount,
      totalDays,
      capacity,
      geoScope: availability.geoTarget?.geoScope || availability.geoScope || null,
      placement: availability.placement || null,
    },
  };
}

module.exports = {
  calculateDemandFromAvailability,
};
