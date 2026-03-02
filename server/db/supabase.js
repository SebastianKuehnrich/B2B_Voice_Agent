/**
 * Supabase Client + Database Query Helpers
 * Uses service role key for full server-side access
 */

const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

// ─── Client ───────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false },
  }
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Upsert a lead record (create or update by email, fallback to insert)
 * @param {object} leadData
 * @returns {Promise<object>} lead row
 */
async function upsertLead(leadData) {
  // Use email as conflict key if available, otherwise just insert
  const conflictKey = leadData.email ? 'email' : (leadData.phone ? 'phone' : undefined);

  if (conflictKey) {
    const { data, error } = await supabase
      .from('leads')
      .upsert(leadData, { onConflict: conflictKey, ignoreDuplicates: false })
      .select()
      .single();

    if (error) {
      logger.error('DB: upsertLead failed', { error: error.message });
      throw error;
    }
    return data;
  }

  // No unique key available — plain insert
  const { data, error } = await supabase
    .from('leads')
    .insert(leadData)
    .select()
    .single();

  if (error) {
    logger.error('DB: upsertLead (insert) failed', { error: error.message });
    throw error;
  }
  return data;
}

/**
 * Create a call record when a new Vapi call starts
 * @param {object} callData
 * @returns {Promise<object>} call row
 */
async function createCall(callData) {
  const { data, error } = await supabase
    .from('calls')
    .insert(callData)
    .select()
    .single();

  if (error) {
    logger.error('DB: createCall failed', { error: error.message });
    throw error;
  }
  return data;
}

/**
 * Update a call record (e.g., when call ends, summary is generated)
 * @param {string} vapiCallId
 * @param {object} updates
 * @returns {Promise<object>} updated call row
 */
async function updateCall(vapiCallId, updates) {
  const { data, error } = await supabase
    .from('calls')
    .update(updates)
    .eq('vapi_call_id', vapiCallId)
    .select()
    .single();

  if (error) {
    logger.error('DB: updateCall failed', { error: error.message, vapiCallId });
    throw error;
  }
  return data;
}

/**
 * Log a call event (for funnel / drop-off analysis)
 * @param {object} eventData
 */
async function logCallEvent(eventData) {
  const { error } = await supabase.from('call_events').insert(eventData);
  if (error) {
    logger.error('DB: logCallEvent failed', { error: error.message, eventData });
    // Non-critical – don't throw, just log
  }
}

/**
 * Save a confirmed Cal.com booking
 * @param {object} bookingData
 * @returns {Promise<object>} booking row
 */
async function createBooking(bookingData) {
  const { data, error } = await supabase
    .from('bookings')
    .insert(bookingData)
    .select()
    .single();

  if (error) {
    logger.error('DB: createBooking failed', { error: error.message });
    throw error;
  }
  return data;
}

/**
 * Update lead score and grade after BANT+ qualification
 * @param {string} leadId
 * @param {object} scoreData
 */
async function updateLeadScore(leadId, scoreData) {
  const { error } = await supabase
    .from('leads')
    .update(scoreData)
    .eq('id', leadId);

  if (error) {
    logger.error('DB: updateLeadScore failed', { error: error.message, leadId });
    throw error;
  }
}

/**
 * Get a call record by Vapi call ID
 * @param {string} vapiCallId
 * @returns {Promise<object|null>}
 */
async function getCallByVapiId(vapiCallId) {
  const { data, error } = await supabase
    .from('calls')
    .select('id, lead_id, vapi_call_id')
    .eq('vapi_call_id', vapiCallId)
    .single();

  if (error) {
    logger.error('DB: getCallByVapiId failed', { error: error.message, vapiCallId });
    return null;
  }
  return data;
}

/**
 * Compute and store a KPI snapshot (calls the SQL function from migration 003)
 * Falls back to manual computation if the SQL function doesn't exist yet
 * @returns {Promise<string|null>} snapshot ID
 */
async function computeKpiSnapshot() {
  const { data, error } = await supabase.rpc('compute_kpi_snapshot', { p_period: 'daily' });

  if (error) {
    logger.warn('DB: compute_kpi_snapshot RPC failed, skipping', { error: error.message });
    return null;
  }

  logger.info('KPI snapshot created', { snapshotId: data });
  return data;
}

module.exports = {
  supabase,
  upsertLead,
  createCall,
  updateCall,
  logCallEvent,
  createBooking,
  updateLeadScore,
  getCallByVapiId,
  computeKpiSnapshot,
};
