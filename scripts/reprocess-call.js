/**
 * Reprocess a call: re-generate summary from Vapi transcript and update DB
 * Usage: node scripts/reprocess-call.js
 */
// override: true ensures system env vars don't shadow .env values
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });

const fs = require('fs');
const path = require('path');
const { generateSummary } = require('../server/handlers/summary');
const { createClient } = require(path.join(__dirname, '..', 'server', 'node_modules', '@supabase', 'supabase-js'));

const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const VAPI_CALL_ID = '019caf14-5ca1-799a-94af-feee6c23acc9';

(async () => {
  try {
    // Get transcript from saved Vapi data
    const vapiData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tmp_vapi_call.json'), 'utf8'));
    const transcript = vapiData.artifact.transcript;

    console.log('Generating summary for call:', VAPI_CALL_ID);
    console.log('Transcript length:', transcript.length);

    const summary = await generateSummary({
      transcript,
      callId: VAPI_CALL_ID,
      duration: 354,
      endReason: 'assistant-said-end-call-phrase',
    });

    if (summary === null || summary === undefined) {
      console.error('ERROR: Summary generation returned null!');
      process.exit(1);
    }

    console.log('\nSummary generated successfully:');
    console.log('  Lead:', summary.lead_name);
    console.log('  Company:', summary.lead_company);
    console.log('  Score:', summary.total_score);
    console.log('  Grade:', summary.lead_grade);
    console.log('  Objections:', JSON.stringify(summary.objections_raised));
    console.log('  Booked:', summary.booked_slot);
    console.log('  Phases:', JSON.stringify(summary.completed_phases));

    // Update call with summary
    const { error: callErr } = await client
      .from('calls')
      .update({
        summary,
        phases_completed: summary.completed_phases,
        drop_off_phase: summary.drop_off_phase || null,
      })
      .eq('vapi_call_id', VAPI_CALL_ID);

    if (callErr) {
      console.error('Call update error:', callErr);
      process.exit(1);
    }
    console.log('\nCall record updated with summary.');

    // Create lead
    const leadData = {
      name: summary.lead_name,
      company: summary.lead_company,
      email: summary.lead_email,
      lead_grade: summary.lead_grade,
      lead_score: summary.total_score,
      score_budget: summary.bant_details?.budget?.score || 0,
      score_authority: summary.bant_details?.authority?.score || 0,
      score_need: summary.bant_details?.need?.score || 0,
      score_timeline: summary.bant_details?.timeline?.score || 0,
      score_fit: summary.bant_details?.fit?.score || 0,
      pain_points: summary.pain_points,
      objections: summary.objections_raised,
      status: summary.booked_slot ? 'demo_scheduled' : 'nurturing',
    };

    const { data: lead, error: leadErr } = await client
      .from('leads')
      .insert(leadData)
      .select()
      .single();

    if (leadErr) {
      console.error('Lead insert error:', leadErr);
      process.exit(1);
    }
    console.log('Lead created:', lead.id);

    // Link lead to call
    const { error: linkErr } = await client
      .from('calls')
      .update({ lead_id: lead.id })
      .eq('vapi_call_id', VAPI_CALL_ID);

    if (linkErr) {
      console.error('Link error:', linkErr);
      process.exit(1);
    }

    console.log('Lead linked to call.');
    console.log('\nDone! Dashboard should now show Dr. Klaus Richter with score/grade.');

    // Trigger KPI snapshot
    const db = require('../server/db/supabase');
    await db.computeKpiSnapshot();
    console.log('KPI snapshot updated.');

  } catch (err) {
    console.error('Fatal error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
