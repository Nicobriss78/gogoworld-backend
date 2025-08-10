const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// Percorso al file degli eventi
const eventiPath = path.join(__dirname, '../data/events.json');

// Funzioni utili
function caricaEventi() {
  if (!fs.existsSync(eventiPath)) return [];
  const data = fs.readFileSync(eventiPath);
  return JSON.parse(data);
}

function salvaEventi(eventi) {
  fs.writeFileSync(eventiPath, JSON.stringify(eventi, null, 2));
}

// ✅ GET – restituisce tutti gli eventi
router.get('/events', (req, res) => {
  const eventi = caricaEventi();
  res.json(eventi);
});

// ➕ POST – crea un nuovo evento
router.post('/events', (req, res) => {
  const { titolo, descrizione } = req.body;
  if (!titolo || !descrizione) {
    return res.status(400).json({ errore: 'Titolo e descrizione obbligatori' });
  }

  const eventi = caricaEventi();
  const nuovoEvento = {
    id: Date.now(),
    titolo,
    descrizione
  };

  eventi.push(nuovoEvento);
  salvaEventi(eventi);

  res.status(201).json(nuovoEvento);
});

// 🗑️ DELETE – elimina un evento esistente
router.delete('/events/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const eventi = caricaEventi();
  const eventiFiltrati = eventi.filter(e => e.id !== id);

  if (eventi.length === eventiFiltrati.length) {
    return res.status(404).json({ errore: 'Evento non trovato' });
  }

  salvaEventi(eventiFiltrati);
  res.json({ messaggio: 'Evento eliminato' });
});

// ✏️ PUT – modifica un evento esistente
router.put('/events/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const { titolo, descrizione } = req.body;
  const eventi = caricaEventi();

  const eventoIndex = eventi.findIndex(e => e.id === id);
  if (eventoIndex === -1) {
    return res.status(404).json({ errore: 'Evento non trovato' });
  }

  eventi[eventoIndex].titolo = titolo || eventi[eventoIndex].titolo;
  eventi[eventoIndex].descrizione = descrizione || eventi[eventoIndex].descrizione;

  salvaEventi(eventi);
  res.json(eventi[eventoIndex]);
});

module.exports = router;
