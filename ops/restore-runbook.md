# Restore Runbook – GoGoWorld.life

## Scenario A – Delete logico/danno parziale
1. Individua timestamp (es. 2025-09-27 11:23 UTC)
2. Usa PITR → Clona in cluster `prod-restore-YYYYMMDDHHmm`
3. Valida collezioni/indici
4. Ripristina dati mirati (copy collection o record)
5. Logga attività nel canale incidenti

## Scenario B – Disastro totale
1. Usa snapshot più recente
2. Restore in nuovo cluster
3. Aggiorna ENV app con nuova conn string
4. Smoke test → login admin/organizer, creazione evento
5. Switch traffico (DNS/conn string)
6. Monitora errori con Sentry

## Rollback applicativo
- Mantieni sempre tag **N-1** pronto (`git tag release-x.y.z`)
- In caso di incompatibilità dati, torna a tag precedente

## Checklist post-restore
- Login admin OK
- Dashboard eventi carica
- Partecipazione evento funzionante
- Admin review tab accessibile
