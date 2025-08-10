const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const userController = require('../controllers/userController'); // ✅ nuovo import controller

const USERS_FILE = path.join(__dirname, '../data/users.json');

// 🔁 Funzione per leggere utenti dal file
function leggiUtenti() {
  const data = fs.readFileSync(USERS_FILE);
  return JSON.parse(data);
}

// 💾 Funzione per scrivere utenti nel file
function scriviUtenti(utenti) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(utenti, null, 2));
}

// ✅ GET: restituisce tutti gli utenti
router.get('/', (req, res) => {
  const utenti = leggiUtenti();
  res.json(utenti);
});

// ✅ GET: restituisce un singolo utente
router.get('/:id', (req, res) => {
  const idUtente = parseInt(req.params.id);
  const utenti = leggiUtenti();
  const utente = utenti.find(u => u.id === idUtente);

  if (!utente) {
    return res.status(404).json({ message: 'Utente non trovato' });
  }

  res.json(utente);
});

// 🔐 POST: login con email e password
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const utenti = leggiUtenti();

  const utente = utenti.find(u => u.email === email && u.password === password);

  if (!utente) {
    return res.status(401).json({ message: 'Credenziali non valide' });
  }

  const { id, nome, ruolo, email: utenteEmail, eventi } = utente;
  res.json({ id, nome, ruolo, email: utenteEmail, eventi });
});

// 🟢 POST: partecipa a un evento
router.post('/:id/partecipa', (req, res) => {
  const idUtente = parseInt(req.params.id);
  const { eventoId } = req.body;

  const utenti = leggiUtenti();
  const utente = utenti.find(u => u.id === idUtente);

  if (!utente || !eventoId) {
    return res.status(400).json({ message: 'Dati mancanti o utente non trovato' });
  }

  if (!utente.eventi.includes(eventoId)) {
    utente.eventi.push(eventoId);
    scriviUtenti(utenti);
  }

  res.json(utente);
});

// 🔴 POST: annulla partecipazione a un evento
router.post('/:id/annulla', (req, res) => {
  const idUtente = parseInt(req.params.id);
  const { eventoId } = req.body;

  const utenti = leggiUtenti();
  const utente = utenti.find(u => u.id === idUtente);

  if (!utente || !eventoId) {
    return res.status(400).json({ message: 'Dati mancanti o utente non trovato' });
  }

  utente.eventi = utente.eventi.filter(id => id !== eventoId);
  scriviUtenti(utenti);

  res.json(utente);
});

// 🟢 POST: registrazione nuovo utente (da controller)
router.post('/register', userController.registerUser); // ✅ nuovo endpoint

module.exports = router;