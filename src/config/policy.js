// backend/src/config/policy.js
const policy = require('./policy.json');

function getPolicy(section) {
  return policy[section] || {};
}

module.exports = { getPolicy };
