const fs = require('fs');
const path = require('path');

const usersFilePath = path.join(__dirname, '../data/users.json');

// Leggi tutti gli utenti dal file JSON
function getAllUsers() {
  try {
    const data = fs.readFileSync(usersFilePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

// Scrivi tutti gli utenti nel file JSON
function saveAllUsers(users) {
  fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
}

// Genera il prossimo ID disponibile (incrementale)
function getNextUserId() {
  const users = getAllUsers();
  if (users.length === 0) return 1;
  const maxId = Math.max(...users.map(u => u.id));
  return maxId + 1;
}

module.exports = {
  getAllUsers,
  saveAllUsers,
  getNextUserId
};
