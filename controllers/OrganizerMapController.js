const asyncHandler = require("express-async-handler");
const { getOrganizerMapSummary } = require("../services/organizerMapIntelligenceService");

const getOrganizerEventsMapSummary = asyncHandler(async (req, res) => {
  const data = await getOrganizerMapSummary(req.user._id);

  res.json({
    ok: true,
    data,
  });
});

module.exports = {
  getOrganizerEventsMapSummary,
};
