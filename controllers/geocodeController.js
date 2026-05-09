const asyncHandler = require("express-async-handler");
const { geocodeAddress, reverseGeocode } = require("../services/geocodeService");

exports.searchGeocode = asyncHandler(async (req, res) => {
  const result = await geocodeAddress(req.body || {});
  res.json(result);
});

exports.reverseGeocode = asyncHandler(async (req, res) => {
  const result = await reverseGeocode(req.body || {});
  res.json(result);
});
