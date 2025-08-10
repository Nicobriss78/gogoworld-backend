const fs = require('fs');
const path = require('path');

const eventsFilePath = path.join(__dirname, '../data/events.json');

// Leggi tutti gli eventi
function getAllEvents() {
  try {
    const data = fs.readFileSync(eventsFilePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

// Salva eventi nel file
function saveAllEvents(events) {
  fs.writeFileSync(eventsFilePath, JSON.stringify(events, null, 2));
}

module.exports = {
  getAllEvents,
  saveAllEvents
};
