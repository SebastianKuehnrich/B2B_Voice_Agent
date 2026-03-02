/**
 * Post-Call Summary Generator
 * Uses Claude (Anthropic) to generate structured lead summaries from call transcripts
 */

const Anthropic = require('@anthropic-ai/sdk');
const logger    = require('../utils/logger');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL  = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';
const MAX_RETRIES    = 2;
const RETRY_DELAY_MS = 1000;

const SUMMARY_SYSTEM_PROMPT = `
Du bist ein Sales-Intelligence-System. Du analysierst Transkripte von B2B-Verkaufsgesprächen
für TalentFlow (HR SaaS) und extrahierst strukturierte Informationen.

Gib IMMER ein valides JSON-Objekt zurück – nichts anderes.
Halte dich exakt an das vorgegebene JSON-Schema.
Wenn eine Information nicht im Transkript vorkommt, setze den Wert auf null.
`.trim();

const SUMMARY_USER_TEMPLATE = (transcript, callId, duration, endReason) => `
Analysiere das folgende Verkaufsgesprächs-Transkript und erstelle eine strukturierte Zusammenfassung.

Call ID: ${callId}
Dauer: ${duration} Sekunden
Gesprächsende: ${endReason}

TRANSKRIPT:
---
${transcript}
---

Gib ein JSON-Objekt mit GENAU dieser Struktur zurück:
{
  "call_id": "${callId}",
  "lead_name": null,
  "lead_company": null,
  "lead_email": null,
  "call_duration_seconds": ${duration},
  "completed_phases": [],
  "drop_off_phase": null,
  "bant_details": {
    "budget": { "score": 0, "note": null },
    "authority": { "score": 0, "note": null },
    "need": { "score": 0, "note": null },
    "timeline": { "score": 0, "note": null },
    "fit": { "score": 0, "note": null }
  },
  "total_score": 0,
  "lead_grade": "C",
  "pain_points": [],
  "objections_raised": [],
  "objections_handled": [],
  "booked_slot": null,
  "recommended_next_steps": [],
  "agent_notes": null
}

Scoring-Regeln:
- budget: 0 (kein/unklar) | 12 (vorhanden aber klein) | 25 (klar > 500 EUR/Mon.)
- authority: 0 (kein Einfluss) | 12 (Mitentscheider) | 25 (Alleinentscheider)
- need: 0 (kein Bedarf) | 12 (moderater Bedarf) | 25 (hoher Bedarf)
- timeline: 0 (> 6 Mon. oder unklar) | 8 (3-6 Mon.) | 15 (< 3 Mon.)
- fit: 0 (außerhalb ICP) | 5 (grenzwertig) | 10 (50-500 MA, DACH)
- total_score = Summe aller Scores (0-100)
- lead_grade: "A" wenn >= 80, "B" wenn >= 50, sonst "C"
- completed_phases: Liste aus ["opening", "discovery", "value_pitch", "qualification", "booking", "wrapup"]
`.trim();

/**
 * Generate a structured post-call summary using Claude
 *
 * @param {object} params
 * @param {string} params.transcript - Full call transcript text
 * @param {string} params.callId     - Vapi call ID
 * @param {number} params.duration   - Call duration in seconds
 * @param {string} params.endReason  - Why the call ended
 * @returns {Promise<object>} Structured summary JSON
 */
async function generateSummary({ transcript, callId, duration, endReason }) {
  if (!transcript || transcript.trim().length < 50) {
    logger.warn('Summary skipped: transcript too short or empty', { callId });
    return null;
  }

  logger.info('Generating post-call summary via Claude', { callId, transcriptLength: transcript.length });

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model:      MODEL,
        max_tokens: 2048,
        system:     SUMMARY_SYSTEM_PROMPT,
        messages: [{
          role:    'user',
          content: SUMMARY_USER_TEMPLATE(transcript, callId, duration, endReason),
        }],
      });

      const rawText = response.content?.[0]?.text ?? '';

      // Extract JSON from response (Claude might wrap it in ```json blocks)
      // Strategy: strip markdown fences, then find outermost { … }
      let jsonStr = rawText
        .replace(/^[\s\S]*?```(?:json)?\s*/i, '')   // strip leading ```json
        .replace(/\s*```[\s\S]*$/i, '');              // strip trailing ```

      const firstBrace = jsonStr.indexOf('{');
      const lastBrace  = jsonStr.lastIndexOf('}');

      if (firstBrace < 0 || lastBrace <= firstBrace) {
        // Fallback: try greedy match on raw text
        const fallback = rawText.match(/\{[\s\S]*\}/);
        if (!fallback) {
          logger.error('Summary: Claude did not return valid JSON', { callId, rawText: rawText.slice(0, 500) });
          return null;
        }
        jsonStr = fallback[0];
      } else {
        jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
      }

      let summary;
      try {
        summary = JSON.parse(jsonStr);
      } catch (parseErr) {
        logger.error('Summary: JSON parse failed', { callId, parseError: parseErr.message, rawText: rawText.slice(0, 500) });
        return null;
      }

      // Validate required fields
      if (!summary.lead_grade || typeof summary.total_score !== 'number') {
        logger.warn('Summary: missing required fields', { callId, keys: Object.keys(summary) });
      }

      logger.info('Summary generated', {
        callId,
        grade: summary.lead_grade,
        score: summary.total_score,
        booked: !!summary.booked_slot,
      });

      return summary;
    } catch (err) {
      const isRetryable = err.status === 429 || err.status === 500 || err.status === 529 || err.code === 'ECONNRESET';

      if (isRetryable && attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        logger.warn(`Summary: retrying (attempt ${attempt + 1}/${MAX_RETRIES}) after ${delay}ms`, { callId, error: err.message });
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      logger.error('Summary generation error', { callId, message: err.message, attempt });
      return null;
    }
  }

  return null;
}

module.exports = { generateSummary };
