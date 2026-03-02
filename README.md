# B2B Voice Agent -- TalentFlow HR SaaS

> Everlast Consulting Challenge 2026 | KI-gestuetzter Sales Voice Agent für B2B-Entscheider

**"Lisa Berger"** ist ein vollautomatischer Voice Agent, der B2B-Telefongespraeche führt, Leads anhand des BANT+ Modells qualifiziert und direkt Demo-Termine über Cal.com bucht -- 24/7, mit unter 1,5 Sekunden Latenz.

---

## Architektur

```
Eingehender Anruf (Vapi Telefonnummer)
       |
       v
  +---------+       +------------------+
  |  Vapi   |<----->|  Claude Sonnet   |  <- Gespraechslogik + BANT+ Qualifizierung
  | Gateway |       |  4.5 (Anthropic) |
  +---------+       +------------------+
       |                    |
  +---------+       +------------------+       +------------------+
  |Deepgram |       | Express Webhook  |------>|    Cal.com API   |
  | Nova-2  |       |  Server (:3001)  |       |  (v2 Bookings)   |
  | (STT)   |       +------------------+       +------------------+
  +---------+               |
       |                    v
  +---------+       +------------------+       +------------------+
  |ElevenLab|       |    Supabase      |------>| Next.js Dashboard|
  |  (TTS)  |       | (PostgreSQL+RLS) |       |   (:3000)        |
  +---------+       +------------------+       +------------------+
                      Realtime ^                      |
                               |______________________|
```

**Datenfluss:** Vapi sendet Webhook-Events an den Express-Server. Dieser verarbeitet Tool-Calls (Cal.com Buchung), generiert Post-Call Summaries (Claude) und speichert alles in Supabase. Das Next.js Dashboard liest die Daten über Supabase Realtime.

### Tech-Stack

| Schicht | Tool | Begruendung |
|---------|------|------------|
| Voice-Plattform | [Vapi](https://vapi.ai) | Native Claude-Integration, < 1,2s Latenz, Tool-Calls |
| LLM | [Claude Sonnet 4.5](https://anthropic.com) | Beste Deutsch-Qualitaet, ueberlegenes Kontext-Handling |
| TTS | [ElevenLabs](https://elevenlabs.io) | Natuerlichste deutsche Stimme |
| STT | [Deepgram Nova-2](https://deepgram.com) | Schnellste DE-Erkennung, Custom Vocabulary |
| Webhook-Server | [Express.js](https://expressjs.com) | Leichtgewichtig, Middleware-Stack, Tool-Call-Handler |
| Kalender | [Cal.com v2 API](https://cal.com) | Open-Source, REST API, DSGVO-konform |
| Datenbank | [Supabase](https://supabase.com) | Realtime Subscriptions, Row-Level-Security, PostgreSQL |
| Dashboard | [Next.js 15](https://nextjs.org) + Recharts | SSR, Realtime via Supabase, responsive Charts |
| Post-Call Analyse | [Claude API](https://docs.anthropic.com) | Strukturierte JSON-Summaries mit BANT+ Scoring |

---

## Verzeichnisstruktur

```
b2b-voice-agent/
|
|-- agent/                         <- Voice Agent Konfiguration
|   |-- agent-config.json          <- Alle Parameter (Produkt, BANT+, Kalender, Phasen)
|   +-- system-prompt.md           <- Claude System-Prompt (Persona, Phasen, Constraints)
|
|-- server/                        <- Node.js Webhook-Server (Express, Port 3001)
|   |-- index.js                   <- Entry Point + Middleware (Helmet, CORS, Rate-Limit)
|   |-- handlers/
|   |   |-- vapi-webhook.js        <- Vapi Event Handler (status-update, end-of-call-report, tool-calls)
|   |   |-- cal-booking.js         <- Cal.com v2 API (/slots + /bookings mit versionierten Headers)
|   |   +-- summary.js             <- Post-Call Summary Generator (Claude, BANT+ JSON)
|   |-- db/supabase.js             <- Supabase Client + CRUD Helpers + KPI Snapshots
|   |-- middleware/auth.js          <- HMAC Webhook Signature Verification
|   +-- utils/logger.js            <- Winston Structured Logger
|
|-- dashboard/                     <- Next.js 15 Analytics Dashboard (Port 3000)
|   |-- app/
|   |   |-- page.tsx               <- Haupt-Dashboard (6 KPI-Cards, 5 Charts, Call-Log)
|   |   |-- layout.tsx             <- Root Layout + Metadata
|   |   +-- globals.css            <- Tailwind Base Styles
|   |-- lib/supabase.ts            <- Supabase Client + Realtime Queries
|   +-- types/index.ts             <- TypeScript Typdefinitionen (Lead, Call, BANT+, Funnel)
|
|-- scripts/                       <- Hilfs-Skripte
|   |-- create-assistant.js        <- Vapi Assistant erstellen/aktualisieren (PATCH)
|   |-- reprocess-call.js          <- Einzelnen Call nachtraeglich auswerten
|   |-- cleanup-test-data.js       <- Test-Daten aus Supabase bereinigen
|   +-- start-dev.sh               <- Server + Dashboard parallel starten
|
|-- supabase/migrations/           <- Datenbank-Schema (chronologisch ausfuehren)
|   |-- 001_initial_schema.sql     <- Tabellen, RLS-Policies, dashboard_calls_summary View
|   |-- 002_pgvector_embeddings.sql <- pgvector, Objection-Embeddings, Seed-Daten
|   +-- 003_schema_fixes.sql       <- FK-Fixes, KPI-Snapshot-Funktion, Realtime
|
|-- data/                          <- Trainings- & Evaluierungsdaten
|   |-- talentflow_train.jsonl     <- Fine-Tuning Trainingsdaten
|   |-- talentflow_eval.jsonl      <- Evaluierungsdaten
|   +-- vapi-assistant.json        <- Exportierte Vapi Assistant Config
|
|-- gradio/                        <- Fine-Tuning Pipeline (BERT Classifier)
|   |-- app.py                     <- Gradio UI fuer Lead-Grade Vorhersage
|   |-- finetune.py                <- Fine-Tuning Skript (bert-base-german-cased)
|   +-- generate_dataset.py        <- Synthetische Trainingsdaten generieren
|
|-- tests/                         <- Jest + Supertest
|   |-- server.test.js             <- Health, Webhooks, Tool-Calls, BANT+ (21 Tests)
|   +-- setup.js                   <- Test-Environment Setup
|
|-- .env.example                   <- Alle benoetigten Environment Variables (Template)
|-- .gitignore
+-- README.md
```

---

## Setup

### 1. Repository klonen

```bash
git clone https://github.com/YOUR_USERNAME/b2b-voice-agent.git
cd b2b-voice-agent
```

### 2. Environment Variables konfigurieren

```bash
cp .env.example .env
# .env mit deinen API-Keys befuellen (siehe .env.example fuer Beschreibungen)
```

Benötigte API-Keys:
- **Vapi** -- Private API Key + Telefonnummer
- **Anthropic** -- Claude API Key (fuer Gespraechslogik + Post-Call Summary)
- **ElevenLabs** -- TTS Voice ID für Lisa
- **Deepgram** -- STT API Key (200 USD Free Credit)
- **Cal.com** -- API Key + Event Type ID
- **Supabase** -- URL + Anon Key + Service Role Key

### 3. Supabase-Datenbank einrichten

Alle Migrationen der Reihe nach im [Supabase SQL Editor](https://supabase.com/dashboard) ausführen:

```bash
# 1. Tabellen, RLS, Views
supabase/migrations/001_initial_schema.sql

# 2. pgvector, Objection-Embeddings, Seed-Daten
supabase/migrations/002_pgvector_embeddings.sql

# 3. FK-Fixes, KPI-Snapshot-Funktion, Realtime
supabase/migrations/003_schema_fixes.sql
```

### 4. Server starten

```bash
cd server
npm install
npm run dev
# -> Server laeuft auf http://localhost:3001
```

### 5. Webhook-Tunnel einrichten (Entwicklung)

```bash
ngrok http 3001 --domain=your-static-domain.ngrok-free.dev
```

### 6. Vapi Assistant konfigurieren

```bash
# Assistant automatisch erstellen/aktualisieren:
node scripts/create-assistant.js

# Das Skript setzt: System-Prompt, Tools (check_availability, book_appointment),
# Webhook-URL, Stimme (ElevenLabs), STT (Deepgram) und alle Gespraechsparameter.
# Die Assistant-ID wird in .env als VAPI_ASSISTANT_ID gespeichert.
```

### 7. Dashboard starten

```bash
cd dashboard
npm install
npm run dev
# -> Dashboard laeuft auf http://localhost:3000
```

---

## Lead-Qualifizierung: BANT+ Modell

| Kriterium | Gewichtung | High (Punkte) | Medium | Low |
|-----------|-----------|---------------|--------|-----|
| **Budget** | 25% | > 500 EUR/Mon. (25) | Vorhanden aber unklar (12) | Kein Budget (0) |
| **Authority** | 25% | Alleinentscheider (25) | Mitentscheider (12) | Kein Einfluss (0) |
| **Need** | 25% | > 50 Bew./Mon. (25) | Moderater Bedarf (12) | Kein Bedarf (0) |
| **Timeline** | 15% | < 3 Monate (15) | 3-6 Monate (8) | > 6 Monate (0) |
| **Fit (ICP)** | 10% | 50-500 MA, DACH (10) | Grenzwertig (5) | Ausserhalb ICP (0) |

**Lead Grades:** A >= 80 Punkte -> Demo direkt buchen | B >= 50 -> Termin anbieten | C < 50 -> Nurturing

---

## Gesprächsphasen

```
Opening (90s) -> Discovery (3min) -> Value Pitch (2min) -> Qualification (3min) -> Booking (2min) -> Wrap-up (1min)
```

| Phase | Ziel | Max. Dauer |
|-------|------|-----------|
| **Opening** | Vertrauen aufbauen, Gespraechserlaubnis einholen | 90 Sek. |
| **Discovery** | Pain Points, Teamgroesse, aktuellen Prozess verstehen | 3 Min. |
| **Value Pitch** | TalentFlow-Nutzen auf entdeckte Pain Points mappen | 2 Min. |
| **Qualification** | BANT+ Kriterien erfassen (Budget, Authority, Need, Timeline, Fit) | 3 Min. |
| **Booking** | Demo-Termin buchen (A/B-Lead) oder Nurturing triggern (C-Lead) | 2 Min. |
| **Wrap-up** | Naechste Schritte zusammenfassen, Verabschiedung | 1 Min. |

---

## Einwandbehandlung (Objection Handling)

Der Agent erkennt und behandelt 5 Einwand-Kategorien automatisch:

| Einwand | Strategie |
|---------|-----------|
| **Kein Budget** | ROI konkretisieren: HR-Kosten vs. Lizenzkosten, Pilot-Option |
| **Kein Entscheider** | Internen Champion aktivieren, Infopaket + gemeinsamen Termin vorschlagen |
| **Keine Zeit** | Minimalen Aufwand betonen: 20-Min-Demo, flexible Terminoptionen |
| **Bereits Loesung** | Integration hervorheben: TalentFlow ergaenzt bestehende ATS-Systeme |
| **Datenschutz** | DSGVO-Konformitaet: EU-Server, ISO 27001, keine Datenweitergabe |

---

## Dashboard

Das Analytics Dashboard zeigt 6 KPI-Cards und 5 interaktive Charts:

### KPI-Cards
- **Gesamt Calls** -- Anzahl aller Calls
- **Demo Termine** -- Erfolgreich gebuchte Termine
- **Conversion Rate** -- Calls -> Demo-Termin (Ziel: > 25%)
- **Oe Call-Dauer** -- Durchschnittliche Gespraechsdauer (Ziel: < 8 Min.)
- **Oe Latenz** -- Response-Zeit des Agents (Ziel: < 1.500 ms)
- **A-Leads** -- Anzahl Hot Leads (Score >= 80)

### Charts
1. **Lead-Score Verteilung** -- Donut-Chart: A/B/C-Leads Anteile
2. **Drop-off nach Phase** -- Horizontaler Bar-Chart: In welcher Phase steigen Leads aus
3. **Conversion Rate (14 Tage)** -- Linien-Chart: Conversion-Trend ueber Zeit
4. **Conversion Funnel** -- Funnel: Calls gesamt -> Abgeschlossen -> Qualifiziert -> A/B-Lead -> Demo gebucht
5. **Top Einwaende** -- Horizontaler Bar-Chart: Haeufigste Einwand-Kategorien (aus Post-Call NLP)

### Realtime
Das Dashboard aktualisiert sich automatisch über Supabase Realtime Subscriptions bei jedem neuen Call.

---

## Post-Call Analyse

Nach jedem Gespräch generiert Claude automatisch eine strukturierte JSON-Summary:

```json
{
  "lead_name": "Thomas Weber",
  "lead_grade": "A",
  "total_score": 100,
  "bant_details": {
    "budget":    { "score": 25, "note": "1.000 EUR/Monat eingeplant" },
    "authority": { "score": 25, "note": "Head of HR, Alleinentscheider" },
    "need":      { "score": 25, "note": "80+ Bewerbungen/Monat, 40 Tage TTH" },
    "timeline":  { "score": 15, "note": "Naechster Monat gewuenscht" },
    "fit":       { "score": 10, "note": "200 MA, Muenchen, DACH" }
  },
  "objections_raised": [],
  "booked_slot": "2026-03-03T09:00:00"
}
```

---

## Design-Entscheidungen

**Warum Vapi?** Niedrigste Latenz (< 1,2s E2E) mit nativer Claude-Integration und Tool-Call-Support während des Gesprächs -- entscheidend für die Cal.com-Buchung mitten im Call.

**Warum Claude Sonnet 4.5?** Beste Deutsch-Qualität bei Sales-Gesprächen, überlegenes Kontext-Handling und natürlichere Einwandbehandlung im Vergleich zu GPT-4o in deutschen B2B-Kontexten.

**Warum Cal.com statt Calendly?** Vollständige REST API (v2) ohne Webhook-Umwege, Open-Source (DSGVO-Vorteil, EU-Hosting möglich) und direkte Tool-Call-Integration ohne Zapier/Make.

**Warum Supabase?** Realtime Subscriptions für das Live-Dashboard, Row-Level-Security für Datenisolation und die eingebaute REST API reduzieren Server-Overhead erheblich.

**Warum Express.js?** Leichtgewichtiger Middleware-Stack für Webhook-Verarbeitung. Helmet (Security Headers), CORS, Rate-Limiting und HMAC-Verification sind out-of-the-box konfiguriert.

---

## Tests

```bash
# Alle Tests ausfuehren (21 Tests: Health, Webhooks, Tool-Calls, BANT+)
cd server && npm test

# Oder vom Root-Verzeichnis:
npm test
```

---

## Deployment

### Dashboard (Vercel)

1. GitHub-Repo mit [Vercel](https://vercel.com) verbinden
2. **Root Directory:** `dashboard`
3. **Environment Variables** setzen:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy

### Webhook-Server

Der Server läuft lokal mit ngrok-Tunnel für Vapi Webhooks. Für Produktion: Deploy auf Railway, Render oder Vercel Serverless Functions.

---

## Commit-Konvention

```
feat:   Neue Funktion
fix:    Bugfix
prompt: System-Prompt-Aenderung
config: Konfigurationsaenderung
docs:   Dokumentation
test:   Tests
```

---


*Everlast Consulting Challenge 2026 | TalentFlow B2B Voice Agent*
