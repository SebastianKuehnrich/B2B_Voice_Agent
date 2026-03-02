/**
 * Vapi Webhook Handler
 * Processes all call lifecycle events from Vapi
 *
 * Event types handled (matching Vapi's actual event names):
 *   status-update         → Track call status (in-progress, ended)
 *   end-of-call-report    → Full call report: update call, create lead, summary, KPI
 *   tool-calls            → Handle check_availability / book_appointment
 *   conversation-update   → Real-time transcript processing & phase tracking
 *   transcript            → Individual transcript segments
 *   hang                  → Lead hung up (track drop-off phase)
 *   speech-update         → Speech status changes (ignored)
 */

const logger        = require('../utils/logger');
const db            = require('../db/supabase');
const calBooking    = require('./cal-booking');
const { generateSummary } = require('./summary');

// Track last detected phase per call (in-memory, for drop-off tracking)
const callPhaseTracker = new Map();

// ─── Main Handler ─────────────────────────────────────────────────────────────
async function vapiWebhookHandler(req, res) {
  const event = req.body;

  if (!event?.message?.type) {
    logger.warn('[webhook] Invalid payload — missing message.type', {
      bodyKeys: event ? Object.keys(event) : 'null',
      bodyType: typeof event,
    });
    return res.status(400).json({ error: 'Invalid payload: missing message.type' });
  }

  const { type } = event.message;
  const vapiCallId = event.message?.call?.id;
  logger.info(`[webhook] Event received: ${type}`, { vapiCallId });

  // Always respond 200 immediately (Vapi expects fast response)
  res.status(200).json({ received: true });

  // Process event asynchronously
  try {
    switch (type) {
      case 'status-update':
        await handleStatusUpdate(event.message);
        break;

      case 'end-of-call-report':
        await handleEndOfCallReport(event.message);
        break;

      case 'tool-calls':
        // Tool-call responses are synchronous → handled on /webhook/vapi/tool
        logger.debug('[webhook] tool-calls event on main endpoint (ignored — handled on /tool)');
        break;

      case 'conversation-update':
        await handleConversationUpdate(event.message);
        break;

      case 'transcript':
        await handleTranscript(event.message);
        break;

      case 'hang':
        await handleHang(event.message);
        break;

      case 'speech-update':
      case 'user-interrupted':
        // Informational events — acknowledge but no processing needed
        logger.debug(`[webhook] Informational event: ${type}`);
        break;

      default:
        logger.debug(`[webhook] Unhandled event type: ${type}`);
    }
  } catch (err) {
    logger.error(`[webhook] Error processing event [${type}]:`, {
      message: err.message,
      stack: err.stack,
    });
  }
}

// ─── Tool-Call Handler (synchronous – needs its own route) ────────────────────
async function vapiToolCallHandler(req, res) {
  const message = req.body?.message;

  // Vapi sends tool calls as toolCallList[] with {id, name, arguments}
  const toolCallList = message?.toolCallList ?? message?.toolCalls ?? [];
  const toolCall = toolCallList[0];

  // Fallback: also check legacy structure (toolCalls[].function.name)
  const toolName = toolCall?.name ?? toolCall?.function?.name;
  const toolCallId = toolCall?.id;
  const parameters = toolCall?.arguments ?? toolCall?.function?.arguments ?? {};

  if (!toolName) {
    logger.warn('[tool] Invalid tool-call payload', {
      messageKeys: message ? Object.keys(message) : 'null',
      toolCallListLength: toolCallList.length,
      toolCall: toolCall ? Object.keys(toolCall) : 'null',
    });
    return res.status(400).json({ error: 'Invalid tool-call payload' });
  }

  const vapiCallId = message?.call?.id;
  logger.info(`[tool] Tool-call: ${toolName}`, { toolCallId, vapiCallId });

  try {
    let result;

    switch (toolName) {
      case 'check_availability': {
        const daysAhead = Math.min(Math.max(parseInt(parameters?.days_ahead, 10) || 14, 1), 60);
        result = await calBooking.getAvailableSlots(daysAhead);
        break;
      }

      case 'book_appointment': {
        const { slot_id, lead_name, lead_email, lead_company } = parameters ?? {};
        if (!slot_id) {
          result = { error: 'slot_id ist ein Pflichtfeld' };
          break;
        }

        // Create or update lead record and link to call
        let leadId;
        try {
          const lead = await db.upsertLead({
            name:    lead_name,
            email:   lead_email,
            company: lead_company,
            status:  'demo_scheduled',
          });
          leadId = lead?.id;

          // Link lead to call
          if (leadId && vapiCallId) {
            await db.updateCall(vapiCallId, { lead_id: leadId });
          }
        } catch (leadErr) {
          logger.error('[tool] Failed to upsert lead during booking', { message: leadErr.message });
        }

        // Book the slot
        result = await calBooking.bookSlot({
          slot_id,
          lead_name,
          lead_email,
          lead_company,
          lead_id: leadId,
          call_id: vapiCallId ? (await db.getCallByVapiId(vapiCallId))?.id : undefined,
        });
        break;
      }

      case 'end_call':
        result = { success: true };
        break;

      default:
        result = { error: `Unknown tool: ${toolName}` };
    }

    logger.info(`[tool] Result for ${toolName}:`, { success: !result?.error });

    return res.json({
      results: [{ toolCallId, result }],
    });
  } catch (err) {
    logger.error(`[tool] Tool-call error [${toolName}]:`, { message: err.message });
    return res.json({
      results: [{ toolCallId, result: { error: err.message } }],
    });
  }
}

// ─── Event Processors ─────────────────────────────────────────────────────────

/**
 * status-update: Vapi sends this when call status changes.
 * status values: "scheduled" | "queued" | "ringing" | "in-progress" | "forwarding" | "ended"
 */
async function handleStatusUpdate(message) {
  const call   = message.call;
  const status = message.status;
  if (!call?.id) return;

  logger.info(`[status-update] Call ${call.id} → ${status}`);

  if (status === 'in-progress') {
    // Call just started
    logger.info('[status-update] Call started', { vapiCallId: call.id, from: call.customer?.number });

    const callRecord = await db.createCall({
      vapi_call_id:      call.id,
      vapi_assistant_id: call.assistantId,
      phone_number_from: call.customer?.number,
      phone_number_to:   call.phoneNumber?.number,
      call_started_at:   new Date().toISOString(),
      status:            'in_progress',
    });

    // Initialize phase tracker
    callPhaseTracker.set(call.id, 'opening');

    await db.logCallEvent({
      call_id:      callRecord?.id ?? null,
      vapi_call_id: call.id,
      event_type:   'call_started',
      phase:        'opening',
      payload:      { from: call.customer?.number },
    });

  } else if (status === 'ended') {
    // Call ended — basic update (full report comes via end-of-call-report)
    logger.info('[status-update] Call ended (awaiting end-of-call-report)', { vapiCallId: call.id });
  } else {
    logger.debug(`[status-update] Call ${call.id} status: ${status}`);
  }
}

/**
 * end-of-call-report: Comprehensive report after call ends.
 * Contains transcript, recording URLs, analysis, duration, etc.
 */
async function handleEndOfCallReport(message) {
  const call      = message.call;
  const artifact  = message.artifact;
  if (!call?.id) return;

  const duration = Math.round(message.durationSeconds ?? 0);
  logger.info('[end-of-call-report] Processing', {
    vapiCallId: call.id,
    duration,
    reason: message.endedReason,
  });

  // Determine drop-off phase from tracker
  const lastPhase = callPhaseTracker.get(call.id) ?? null;
  callPhaseTracker.delete(call.id);

  // Detect if call ended prematurely (not via end_call tool or wrap-up)
  const prematureEnd = message.endedReason !== 'assistant-ended' && lastPhase !== 'wrapup';
  const dropOffPhase = prematureEnd ? lastPhase : null;

  // Update call record
  const updatedCall = await db.updateCall(call.id, {
    call_ended_at:    new Date().toISOString(),
    duration_seconds: duration,
    status:           'completed',
    end_reason:       message.endedReason,
    drop_off_phase:   dropOffPhase,
    recording_url:    artifact?.recording?.url ?? artifact?.recordingUrl,
    transcript_url:   artifact?.transcriptUrl,
    avg_latency_ms:   message.analysis?.latency?.p50,
  });

  // Build transcript text from artifact
  const transcriptText = artifact?.transcript
    ?? (artifact?.messages ?? []).map(m => `${m.role}: ${m.message}`).join('\n');

  // Generate post-call summary via Claude
  if (transcriptText) {
    try {
      const summary = await generateSummary({
        transcript: transcriptText,
        callId:     call.id,
        duration,
        endReason:  message.endedReason,
      });

      if (summary) {
        // Store summary on call record
        await db.updateCall(call.id, {
          summary,
          phases_completed: summary.completed_phases,
          drop_off_phase:   summary.drop_off_phase ?? dropOffPhase,
        });

        // Create or update lead from summary data
        const leadData = {};
        if (summary.lead_name)    leadData.name    = summary.lead_name;
        if (summary.lead_company) leadData.company  = summary.lead_company;
        if (summary.lead_email)   leadData.email    = summary.lead_email;

        if (Object.keys(leadData).length > 0) {
          try {
            // If we already have a lead linked, update it
            if (updatedCall?.lead_id) {
              await db.updateLeadScore(updatedCall.lead_id, {
                ...leadData,
                lead_grade:      summary.lead_grade,
                lead_score:      summary.total_score,
                score_budget:    summary.bant_details?.budget?.score,
                score_authority: summary.bant_details?.authority?.score,
                score_need:      summary.bant_details?.need?.score,
                score_timeline:  summary.bant_details?.timeline?.score,
                score_fit:       summary.bant_details?.fit?.score,
                pain_points:     summary.pain_points,
                objections:      summary.objections_raised,
                status:          summary.booked_slot ? 'demo_scheduled' : 'nurturing',
              });
            } else {
              // Create new lead and link to call
              const lead = await db.upsertLead({
                ...leadData,
                lead_grade:      summary.lead_grade,
                lead_score:      summary.total_score,
                score_budget:    summary.bant_details?.budget?.score ?? 0,
                score_authority: summary.bant_details?.authority?.score ?? 0,
                score_need:      summary.bant_details?.need?.score ?? 0,
                score_timeline:  summary.bant_details?.timeline?.score ?? 0,
                score_fit:       summary.bant_details?.fit?.score ?? 0,
                pain_points:     summary.pain_points,
                objections:      summary.objections_raised,
                status:          summary.booked_slot ? 'demo_scheduled' : 'nurturing',
              });
              if (lead?.id) {
                await db.updateCall(call.id, { lead_id: lead.id });
              }
            }
          } catch (leadErr) {
            logger.error('[end-of-call-report] Lead upsert failed', { message: leadErr.message });
          }
        }
      }
    } catch (err) {
      logger.error('[end-of-call-report] Summary generation failed:', { message: err.message });
    }
  }

  // Log call-end event
  await db.logCallEvent({
    call_id:      updatedCall?.id ?? null,
    vapi_call_id: call.id,
    event_type:   'call_ended',
    payload:      { duration, reason: message.endedReason, drop_off_phase: dropOffPhase },
  });

  // Trigger KPI snapshot
  try {
    await db.computeKpiSnapshot();
    logger.info('[end-of-call-report] KPI snapshot computed');
  } catch (err) {
    logger.error('[end-of-call-report] KPI snapshot failed:', { message: err.message });
  }
}

/**
 * conversation-update: Real-time conversation tracking.
 * Contains the full conversation so far as messages array.
 */
async function handleConversationUpdate(message) {
  const vapiCallId = message.call?.id;
  // Extract latest message for phase tracking
  const messages = message.messages ?? message.conversation ?? [];
  const lastMsg = messages[messages.length - 1];

  if (!lastMsg?.message && !lastMsg?.content) return;

  const text = (lastMsg.message || lastMsg.content || '').toLowerCase();
  detectPhase(vapiCallId, text);
}

/**
 * transcript: Individual ASR transcript segments.
 */
async function handleTranscript(message) {
  const transcript = message.transcript;
  const vapiCallId = message.call?.id;
  if (!transcript) return;

  detectPhase(vapiCallId, transcript.toLowerCase());
}

/**
 * Phase detection helper — updates in-memory tracker and logs event.
 */
async function detectPhase(vapiCallId, lowerText) {
  const phaseKeywords = {
    discovery:     ['wie viele bewerbungen', 'wie lange dauert', 'zuständig', 'bewerbungsprozess'],
    value_pitch:   ['talentflow', 'time-to-hire', 'müller logistik', 'einsparen', 'reduziert'],
    qualification: ['budget', 'entscheidung', 'bis wann', 'entscheider', 'investition'],
    booking:       ['demo', 'termin', 'kalender', 'verfügbar', 'slot'],
    wrapup:        ['auf wiederhören', 'kalender-einladung', 'freue mich', 'alles gute'],
  };

  for (const [phase, keywords] of Object.entries(phaseKeywords)) {
    if (keywords.some(kw => lowerText.includes(kw))) {
      if (vapiCallId) {
        callPhaseTracker.set(vapiCallId, phase);
      }

      await db.logCallEvent({
        call_id:      null,
        vapi_call_id: vapiCallId,
        event_type:   'phase_detected',
        phase,
        payload:      { snippet: lowerText.slice(0, 200) },
      });
      break;
    }
  }
}

async function handleHang(message) {
  const call = message.call;
  if (!call?.id) return;

  // Determine drop-off phase from tracker
  const lastPhase = callPhaseTracker.get(call.id) ?? null;
  callPhaseTracker.delete(call.id);

  logger.info('[hang] Call hang event', { vapiCallId: call.id, dropOffPhase: lastPhase });

  await db.updateCall(call.id, {
    status:         'completed',
    end_reason:     'hang',
    drop_off_phase: lastPhase,
  });

  await db.logCallEvent({
    call_id:      null,
    vapi_call_id: call.id,
    event_type:   'hang',
    phase:        lastPhase,
    payload:      { vapiCallId: call.id, drop_off_phase: lastPhase },
  });
}

module.exports = vapiWebhookHandler;
module.exports.vapiToolCallHandler = vapiToolCallHandler;
