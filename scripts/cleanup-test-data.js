/**
 * Cleanup script: Remove test/dummy calls from Supabase
 * Run: node scripts/cleanup-test-data.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Resolve from server/node_modules
const { createClient } = require(path.join(__dirname, '..', 'server', 'node_modules', '@supabase', 'supabase-js'));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const TEST_CALL_IDS = ['test-123', 'test-ngrok-2', 'debug-test-001'];

async function cleanup() {
  console.log('🧹 Cleaning up test data...\n');

  // 1. Delete call_events for test calls
  const { error: evErr } = await supabase
    .from('call_events')
    .delete()
    .in('vapi_call_id', TEST_CALL_IDS);
  console.log('  call_events:', evErr ? `ERROR: ${evErr.message}` : '✅ deleted');

  // 2. Delete test calls
  const { error: callErr } = await supabase
    .from('calls')
    .delete()
    .in('vapi_call_id', TEST_CALL_IDS);
  console.log('  calls:      ', callErr ? `ERROR: ${callErr.message}` : '✅ deleted');

  // 3. Verify
  const { data } = await supabase.from('calls').select('vapi_call_id, status, duration_seconds');
  console.log('\n📊 Remaining calls:');
  data.forEach(c => console.log(`  ${c.vapi_call_id} — ${c.status} — ${c.duration_seconds ?? '?'}s`));
  console.log('\nDone.');
}

cleanup().catch(err => {
  console.error('Cleanup failed:', err.message);
  process.exit(1);
});
