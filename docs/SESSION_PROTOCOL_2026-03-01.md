# Session-Protokoll – 01.03.2026 (fortgesetzt 02.03.2026)

## TalentFlow B2B Voice Agent – Everlast Challenge 2026

---

## Zusammenfassung

End-to-End-Flow erstmals erfolgreich getestet:
**Vapi Voice Agent → Express Webhook Server → Supabase DB → Next.js Dashboard**

Session 02.03.2026: Alle 500/503-Fehler behoben, Cal.com Slot-Abfrage funktioniert,
Webhook-Erfolgsrate auf **100%** gesteigert (945/945 HTTP 200).

---

## Behobene Bugs

### 1. Rate-Limiter blockiert Webhooks (429-Fehler)
- **Problem:** `generalLimiter` (100 Req/15min) wurde auf ALLE Routes angewandt, auch `/webhook/*`. Vapi-Webhooks (>100 Events pro Call) wurden geblockt.
- **Fix:** `generalLimiter` überspringt jetzt `/webhook`-Routes:
  ```js
  app.use((req, res, next) => {
    if (req.path.startsWith('/webhook')) return next();
    generalLimiter(req, res, next);
  });
  ```
- **Datei:** `server/index.js`

### 2. Falsche Vapi Event-Type-Namen (404-Fehler)
- **Problem:** Handler erwartete `call-start` / `call-end`, aber Vapi sendet `status-update` / `end-of-call-report`
- **Fix:** Kompletter Rewrite des Webhook-Handlers mit korrekten Event-Types
- **Datei:** `server/handlers/vapi-webhook.js`

### 3. Falsche Tool-Call Payload-Struktur
- **Problem:** Handler griff auf `toolCalls[].function.name` zu, aber Vapi sendet `toolCallList[].name`
- **Fix:** Fallback-Logik: `toolCallList ?? toolCalls`, `name ?? function.name`
- **Datei:** `server/handlers/vapi-webhook.js`

### 4. Body-Parsing Path-Mounting Quirks
- **Problem:** `app.use('/webhook/vapi', express.raw())` als pfadmontiertes Middleware verursachte potenzielle Routing-Probleme
- **Fix:** Ein einziger conditionales Middleware ohne Path-Mounting:
  ```js
  app.use((req, res, next) => {
    if (req.path.startsWith('/webhook/vapi')) return rawJsonParser(req, res, next);
    return jsonParser(req, res, next);
  });
  ```
- **Datei:** `server/index.js`

### 5. HMAC-Auth blockiert in Development
- **Problem:** `VAPI_WEBHOOK_SECRET` war auf Placeholder-Wert gesetzt, Auth-Middleware versuchte trotzdem HMAC-Verifizierung
- **Fix:** Development-Modus überspringt HMAC komplett, Production erfordert es
- **Datei:** `server/middleware/auth.js`

### 6. ngrok Tunnel offline (Hauptursache der 404-Fehler)
- **Problem:** ngrok Free-Tier Tunnel war offline → Vapi bekam 404 von ngrok, nicht vom Server
- **Fix:** ngrok neu gestartet (Static Domain bleibt gleich)

### 7. TTS-Aussprache (Session davor)
- **Problem:** ElevenLabs sprach "Bewerber" statt "Berger", "KI Gestört" statt "KI-gestützten"
- **Fix:** `firstMessage` nutzt "Lisa Bärger", Deepgram Keywords: `Berger:3`, `ROI:2`
- **Datei:** `scripts/create-assistant.js`

### 8. Supabase Migration 003 nicht idempotent
- **Problem:** `leads_phone_unique` Constraint existierte bereits (42P07)
- **Fix:** `IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE ...)` Pattern
- **Datei:** `supabase/migrations/003_schema_fixes.sql`

### 9. conversation-update 500-Fehler (Body-Size Limit)
- **Problem:** `express.raw()` Default-Limit 100KB → `conversation-update` Payloads (System-Prompt + History) überschreiten 100KB → 500 Internal Server Error + 503 bei hoher Last
- **Fix:** Body-Size Limit auf 5MB erhöht: `express.raw({ type: 'application/json', limit: '5mb' })`
- **Datei:** `server/index.js`
- **Verifiziert:** Test-Call 02.03. → 182/182 conversation-update Events erfolgreich (HTTP 200)

### 10. Cal.com check_availability Fehler (falscher API-Endpoint)
- **Problem:** Cal.com v2 API nutzt `/slots` (nicht `/slots/available`), Parameter `start`/`end` (nicht `startTime`/`endTime`), Response `data["2026-03-03"][].start` (nicht `data.slots[].time`)
- **Fix:** Endpoint, Parameter und Response-Parsing korrigiert
- **Datei:** `server/handlers/cal-booking.js`
- **Verifiziert:** Test-Call 02.03. → 3 reale Slots zurückgegeben (Mo 16:30, Di 09:00, Di 09:30)

### 11. Cal.com book_appointment Fehler (falsche cal-api-version)
- **Problem:** `/bookings` Endpoint erfordert `cal-api-version: 2024-08-13`, Code nutzte global `2024-09-04` (korrekt für `/slots`, falsch für `/bookings`)
- **Fix:** `cal-api-version` Header pro Request gesetzt statt global auf dem Client
- **Datei:** `server/handlers/cal-booking.js`
- **Status:** Fix deployed, wartet auf Verifikation im nächsten Test-Call

### 12. serverMessages nicht in Vapi-Assistant konfiguriert
- **Problem:** `end-of-call-report` wurde nicht als Webhook gesendet, weil `serverMessages` Array fehlte
- **Fix:** Explizites `serverMessages` Array in `create-assistant.js` + Assistant via PATCH aktualisiert
- **Datei:** `scripts/create-assistant.js`
- **Verifiziert:** Vapi API GET bestätigt `serverMessages` korrekt gespeichert
- **Status:** Wartet auf Verifikation im nächsten Test-Call

---

## Test-Call #5 Ergebnis (02.03.2026, 11:53 Uhr)

| Metrik | Wert |
|--------|------|
| **Vapi Call ID** | `019cae2e-debf-788c-ab15-7209de8dc52a` |
| **Dauer** | ~10 Minuten |
| **Webhook-Requests** | 945 (100% HTTP 200, 0 Fehler, 0 Retries) |
| **Ø Latenz** | 367ms (Min: 193ms, Max: 4.880ms) |
| **conversation-update** | 182/182 erfolgreich ✅ |
| **check_availability** | Erfolgreich, 3 Slots ✅ |
| **book_appointment** | Fehlgeschlagen (cal-api-version falsch) ❌ |
| **end-of-call-report** | Nicht empfangen ❌ |
| **Lead** | Sebastian Kühnrich / Punkt Punkt Punkt |
| **Vapi Bewertung** | `successEvaluation: true` ✅ |

---

## Test-Call #1 Ergebnis (01.03.2026, 00:06 Uhr)

| Metrik | Wert |
|--------|------|
| **Vapi Call ID** | `019caba6-b745-7000-8158-16a1e7e50444` |
| **Dauer** | 552 Sekunden (~9 Min.) |
| **End-Reason** | `customer-ended-call` |
| **Ø Latenz** | 1.200 ms (Ziel: <1.500 ms) ✅ |
| **Vapi Bewertung** | `successEvaluation: true` ✅ |
| **Lead Grade** | B (Score: 55/100) |
| **Phasen** | Opening → Discovery → Value Pitch → Qualification |
| **Drop-off** | Booking (Kalender nicht erreichbar) |

### BANT+ Scoring
| Kriterium | Score | Note |
|-----------|-------|------|
| Budget | 0/25 | Noch nicht eingeplant |
| Authority | 12/25 | Nicht Alleinentscheider |
| Need | 25/25 | Höchster Bedarf (60-70% Wochenzeit) |
| Timeline | 8/15 | Pilotprojekt in 3 Monaten |
| Fit | 10/10 | 2.000 MA, Zeitarbeit = perfekter ICP |

### AI-generierte Pain Points
- 80-100 Bewerbungen/Monat müssen verarbeitet werden
- 60-70% der Wochenarbeitszeit für manuelle Vorselektion
- Einzelperson führt gesamte Vorselektion durch

### Empfohlene Next Steps (AI-generiert)
- Demo-Termin mit Entscheider vereinbaren
- Business Case für Zeitersparnis vorbereiten
- ROI-Kalkulation für 2000-MA-Unternehmen erstellen
- Pilotprojekt-Angebot mit 3-Monats-Timeline ausarbeiten

---

## Aktueller Status (Stand: 02.03.2026)

### Funktioniert ✅
- [x] Vapi Voice Agent (Lisa Berger) führt natürliche Gespräche auf Deutsch
- [x] Webhook-Server empfängt Vapi-Events (100% Erfolgsrate bei 945 Requests)
- [x] Call-Records werden in Supabase erstellt (status-update → in-progress)
- [x] Phase-Tracking funktioniert (Opening, Discovery, Value Pitch, Qualification, Booking)
- [x] AI-Summary wird nach Call-Ende generiert (Claude Sonnet 4.5)
- [x] Dashboard zeigt KPIs (Gesamt Calls, Ø Dauer, Ø Latenz) + Call-Log Tabelle
- [x] Supabase Realtime-Subscription (Live-Indikator, neue Calls sofort sichtbar)
- [x] Cal.com `check_availability` gibt echte Slots zurück
- [x] conversation-update Events werden fehlerfrei verarbeitet (Body-Size Fix)
- [x] `serverMessages` korrekt in Vapi-Assistant konfiguriert

### Behoben in Session 02.03. ✅
- [x] 500-Fehler bei conversation-update → Body-Size Limit 5MB
- [x] Cal.com check_availability → korrekter Endpoint + Parameter
- [x] Cal.com book_appointment → cal-api-version 2024-08-13 (statt 2024-09-04)
- [x] serverMessages → explizit konfiguriert + Assistant gepatcht

### Noch zu verifizieren ⚠️
- [ ] `end-of-call-report` automatisch von Vapi empfangen (Config ist korrekt, nächster Test-Call verifiziert)
- [ ] `book_appointment` erfolgreich (cal-api-version Fix deployed)
- [ ] Dashboard Score/Grade Spalten (hängt von end-of-call-report ab)
- [ ] Lead-Score Verteilung Chart (braucht Calls mit Grading)

---

## Geänderte Dateien

| Datei | Änderung | Session |
|-------|----------|---------|
| `server/index.js` | Rate-Limiter Fix, Body-Parsing Fix (5MB), 404-Logging | 01.03. + 02.03. |
| `server/handlers/vapi-webhook.js` | Kompletter Rewrite: korrekte Event-Types, Tool-Call Struktur | 01.03. |
| `server/handlers/cal-booking.js` | Cal.com v2: `/slots` Endpoint, per-Request `cal-api-version` Header | 02.03. |
| `server/middleware/auth.js` | Dev-Mode skippt HMAC, Debug-Logging | 01.03. |
| `scripts/create-assistant.js` | TTS-Fix, Deepgram Keywords, serverMessages Array | 01.03. + 02.03. |
| `scripts/cleanup-test-data.js` | NEU: Script zum Bereinigen von Test-Daten | 01.03. |
| `dashboard/.env.local` | NEU: Supabase-Keys für Next.js | 01.03. |
| `supabase/migrations/003_schema_fixes.sql` | Idempotente Constraints | 01.03. |

---

## Nächster Test-Call – Checkliste

1. **ngrok starten** (falls nicht aktiv): `ngrok http 3001 --url=unrationed-unanecdotal-jolie.ngrok-free.dev`
2. **Server starten**: `cd server && npm run dev`
3. **Test-Call durchführen** (kompletter Durchlauf bis Terminbuchung)
4. **Prüfen:**
   - [ ] `end-of-call-report` im Server-Log empfangen?
   - [ ] `book_appointment` erfolgreich? (Cal.com Termin gebucht?)
   - [ ] Dashboard: Score + Grade ausgefüllt?
   - [ ] Dashboard: Lead-Score Verteilung Chart?
   - [ ] Keine 500/503-Fehler in den Logs?
