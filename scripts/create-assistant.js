/**
 * create-assistant.js
 * --------------------
 * Erstellt oder aktualisiert den TalentFlow Voice Agent (Lisa) in Vapi.
 *
 * Ausfuehren:
 *   node scripts/create-assistant.js
 *
 * Voraussetzungen:
 *   - VAPI_API_KEY in .env gesetzt
 *   - ELEVENLABS_VOICE_ID in .env gesetzt
 */

"use strict";

const fs   = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const VAPI_API_KEY       = process.env.VAPI_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;

if (!VAPI_API_KEY) {
  console.error("FEHLER: VAPI_API_KEY fehlt in .env");
  process.exit(1);
}
if (!ELEVENLABS_VOICE_ID) {
  console.error("FEHLER: ELEVENLABS_VOICE_ID fehlt in .env");
  process.exit(1);
}
if (!process.env.WEBHOOK_URL) {
  console.error("FEHLER: WEBHOOK_URL fehlt in .env (z.B. https://xxxx.ngrok.io)");
  process.exit(1);
}
if (!process.env.VAPI_WEBHOOK_SECRET) {
  console.warn("WARNUNG: VAPI_WEBHOOK_SECRET nicht gesetzt – Webhook-Signatur-Verifikation ist deaktiviert!");
}

// System-Prompt aus Markdown-Datei laden
const systemPromptPath = path.join(__dirname, "..", "agent", "system-prompt.md");
const systemPrompt     = fs.readFileSync(systemPromptPath, "utf-8");

// Tool-Definitionen fuer Vapi (check_availability, book_appointment, end_call)
const tools = [
  {
    type: "function",
    function: {
      name:        "check_availability",
      description: "Prueft verfuegbare Demo-Slots bei Cal.com und gibt maximal 3 Optionen zurueck.",
      parameters: {
        type:       "object",
        properties: {
          days_ahead: {
            type:        "integer",
            description: "Wie viele Tage in die Zukunft nach freien Slots suchen (Standard: 14)",
            default:     14,
          },
        },
        required: [],
      },
    },
    server: {
      url: `${process.env.WEBHOOK_URL}/webhook/vapi/tool`,
    },
  },
  {
    type: "function",
    function: {
      name:        "book_appointment",
      description: "Bucht einen Demo-Termin fuer den Lead direkt in Cal.com.",
      parameters: {
        type:       "object",
        properties: {
          slot_id: {
            type:        "string",
            description: "Die Slot-ID aus check_availability",
          },
          lead_name: {
            type:        "string",
            description: "Vollstaendiger Name des Leads",
          },
          lead_email: {
            type:        "string",
            description: "E-Mail-Adresse des Leads",
          },
          lead_company: {
            type:        "string",
            description: "Unternehmensname des Leads",
          },
        },
        required: ["slot_id", "lead_name"],
      },
    },
    server: {
      url: `${process.env.WEBHOOK_URL}/webhook/vapi/tool`,
    },
  },
  {
    type: "endCall",
    function: {
      name:        "end_call",
      description: "Beendet den Anruf nach der Verabschiedung sauber.",
    },
  },
];

// Vollstaendige Vapi-Assistant-Konfiguration
const assistantPayload = {
  name: "Lisa – TalentFlow Voice Agent",

  model: {
    provider: "anthropic",
    model:    "claude-sonnet-4-5-20250929",
    messages: [
      {
        role:    "system",
        content: systemPrompt,
      },
    ],
    temperature:    0.7,
    maxTokens:      1000,
    emotionRecognitionEnabled: false,
    tools,
  },

  voice: {
    provider: "11labs",
    voiceId:  ELEVENLABS_VOICE_ID,
    model:    "eleven_multilingual_v2",
    stability:        0.5,
    similarityBoost:  0.75,
    style:            0.0,
    useSpeakerBoost:  true,
  },

  transcriber: {
    provider: "deepgram",
    model:    "nova-2",
    language: "de",
    smartFormat:     true,
    keywords: [
      "TalentFlow:2",
      "Berger:3",
      "ROI:2",
      "Bewerber",
      "Kandidaten",
      "Recruiting",
      "Personio:2",
      "Workday:2",
      "TimeToHire:2",
      "DSGVO:2",
      "ATS:2",
    ],
  },

  // Gespraechssteuerung
  silenceTimeoutSeconds:        30,     // 30s – genug Zeit fuer Tool-Calls (check_availability + book_appointment)
  maxDurationSeconds:           900,
  backgroundSound:              "off",
  backchannelingEnabled:        true,
  backgroundDenoisingEnabled:   true,
  modelOutputInMessagesEnabled: false,

  // Erst-Nachricht (Lisa begruesst den Lead)
  firstMessage: "Hallo, hier ist Lisa Bärger von TalentFlow. Ich rufe an, weil Sie sich für unsere Informationen zur KI-gestützten Bewerberqualifizierung interessiert haben. Haben Sie kurz zwei Minuten?",
  firstMessageMode: "assistant-speaks-first",

  // Ende-Nachricht
  endCallMessage: "Vielen Dank fuer Ihr Interesse. Auf Wiederhoren!",
  endCallPhrases: [
    "auf wiederhören",
    "auf wiedersehen",
    "tschüss",
    "bis dann",
    "tschau",
  ],

  // Webhook fuer Events
  serverUrl: `${process.env.WEBHOOK_URL}/webhook/vapi`,

  serverUrlSecret: process.env.VAPI_WEBHOOK_SECRET || "",

  // Explicitly list server messages we want to receive
  serverMessages: [
    "status-update",
    "end-of-call-report",
    "tool-calls",
    "conversation-update",
    "hang",
    "speech-update",
    "transcript",
  ],

  // Metadaten
  metadata: {
    project:     "everlast-challenge-2026",
    product:     "talentflow",
    agent:       "lisa-berger",
    version:     "1.0.0",
  },
};

// ── Vapi API aufrufen ──────────────────────────────────────────────────────
async function createOrUpdateAssistant() {
  const existingId = process.env.VAPI_ASSISTANT_ID;
  const method     = existingId ? "PATCH" : "POST";
  const url        = existingId
    ? `https://api.vapi.ai/assistant/${existingId}`
    : "https://api.vapi.ai/assistant";

  console.log("=".repeat(55));
  console.log("TalentFlow – Vapi Assistant Setup");
  console.log("=".repeat(55));
  console.log(`Modus:   ${existingId ? "UPDATE (PATCH)" : "NEU ERSTELLEN (POST)"}`);
  console.log(`URL:     ${url}`);
  console.log(`Modell:  ${assistantPayload.model.model}`);
  console.log(`Stimme:  ElevenLabs ${ELEVENLABS_VOICE_ID}`);
  console.log(`STT:     Deepgram nova-2 (de)`);
  console.log("");

  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Authorization": `Bearer ${VAPI_API_KEY}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify(assistantPayload),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("FEHLER: Vapi API Anfrage fehlgeschlagen");
      console.error(`Status: ${response.status}`);
      console.error("Details:", JSON.stringify(data, null, 2));
      process.exit(1);
    }

    console.log("Assistant erfolgreich erstellt/aktualisiert:");
    console.log(`  ID:   ${data.id}`);
    console.log(`  Name: ${data.name}`);
    console.log("");
    console.log("Naechste Schritte:");
    console.log(`  1. VAPI_ASSISTANT_ID=${data.id} in .env eintragen`);
    console.log("  2. ngrok starten: ngrok http 3001");
    console.log("  3. WEBHOOK_URL=https://XXXX.ngrok.io in .env eintragen");
    console.log("  4. Script erneut ausfuehren um Webhook-URL zu aktualisieren");
    console.log("  5. Server starten: cd server && npm run dev");
    console.log("");

    // Assistant-ID in Ausgabedatei speichern fuer Referenz
    const outputPath = path.join(__dirname, "..", "data", "vapi-assistant.json");
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify({ id: data.id, name: data.name, createdAt: data.createdAt }, null, 2));
    console.log(`Konfiguration gespeichert: ${outputPath}`);

  } catch (err) {
    console.error("FEHLER: Netzwerkfehler beim Vapi API Aufruf");
    console.error(err.message);
    process.exit(1);
  }
}

createOrUpdateAssistant();
