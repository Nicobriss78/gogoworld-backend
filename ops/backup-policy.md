# Backup Policy – GoGoWorld.life

## 🔎 Obiettivi
- **RPO** (Recovery Point Objective): ≤ 15 minuti in produzione
- **RTO** (Recovery Time Objective): ≤ 60 minuti incidente normale, ≤ 4h incidente grave

## 📦 Frequenza e retention
- **PROD**
  - PITR (Point in Time Restore) attivo, finestra 7 giorni
  - Snapshot giornaliero (02:00 UTC), retention 30 giorni
  - Snapshot settimanale, retention 12 settimane
- **STAGING**
  - Snapshot giornaliero, retention 7 giorni
  - PITR opzionale OFF (riduzione costi)
- **DEV**
  - Nessun backup obbligatorio, retention minima 3 giorni se serve

## 🔐 Sicurezza
- Accesso solo Owner + On-call con 2FA
- IP allowlist temporaneo in caso di restore test
- Backup criptati at-rest + backup encryption ON
- Nessuna credenziale backup nel repo o in Netlify

## 🛠️ Ownership
- **Responsabile primario:** [NOME]
- **On-call backup:** [NOME]
