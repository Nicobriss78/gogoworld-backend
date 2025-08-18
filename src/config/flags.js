// src/config/flags.js
const fs = require('fs');
const path = require('path');

const flagsPath = path.join(__dirname, 'featureFlags.json');

function readFlags() {
  try {
    const data = fs.readFileSync(flagsPath, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return {};
  }
}

function isEnabled(keyPath) {
  const flags = readFlags();
  return keyPath
    .split('.')
    .reduce((acc, k) => (acc && acc[k] != null ? acc[k] : undefined), flags) === true;
}

module.exports = { readFlags, isEnabled };
