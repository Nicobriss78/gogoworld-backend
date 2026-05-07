const asyncHandler = require("express-async-handler");
const { geocodeAddress } = require("../services/geocodeService");

exports.searchGeocode = asyncHandler(async (req, res) => {
  const result = await geocodeAddress(req.body || {});
  res.json(result);
});
