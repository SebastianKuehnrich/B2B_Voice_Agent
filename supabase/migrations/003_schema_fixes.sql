-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 003_schema_fixes.sql
-- Purpose:   Fix schema issues found during integration testing
-- Created:   2026-03-01
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add UNIQUE constraint on leads.phone (required for upsertLead onConflict)
-- Also add UNIQUE on email for deduplication
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_phone_unique') THEN
    ALTER TABLE leads ADD CONSTRAINT leads_phone_unique UNIQUE (phone);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_email_unique') THEN
    ALTER TABLE leads ADD CONSTRAINT leads_email_unique UNIQUE (email);
  END IF;
END $$;

-- 2. Make call_events.call_id nullable
-- Events are logged before the call record is fully resolved (vapi_call_id → UUID)
-- A trigger or server logic resolves the FK later
ALTER TABLE call_events ALTER COLUMN call_id DROP NOT NULL;

-- 3. Add vapi_call_id to call_events for deferred FK resolution
ALTER TABLE call_events ADD COLUMN IF NOT EXISTS vapi_call_id TEXT;
CREATE INDEX IF NOT EXISTS idx_call_events_vapi_call_id ON call_events(vapi_call_id);

-- 4. Function: resolve call_events with missing call_id
-- Runs as a trigger when calls table gets a new row
CREATE OR REPLACE FUNCTION resolve_call_event_fk()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE call_events
  SET call_id = NEW.id
  WHERE vapi_call_id = NEW.vapi_call_id AND call_id IS NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS resolve_call_events_on_insert ON calls;
CREATE TRIGGER resolve_call_events_on_insert
  AFTER INSERT ON calls
  FOR EACH ROW EXECUTE FUNCTION resolve_call_event_fk();

-- 5. Function: compute KPI snapshot
-- Called by server after call-end or can be scheduled via pg_cron
CREATE OR REPLACE FUNCTION compute_kpi_snapshot(p_period TEXT DEFAULT 'daily')
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  snapshot_id UUID;
  v_total_calls       INT;
  v_completed_calls   INT;
  v_conversion_rate   NUMERIC(5,2);
  v_avg_duration      INT;
  v_avg_latency       INT;
  v_leads_a           INT;
  v_leads_b           INT;
  v_leads_c           INT;
  v_bookings_confirmed INT;
  v_bookings_no_show   INT;
  v_top_drop_off       TEXT;
BEGIN
  SELECT COUNT(*) INTO v_total_calls FROM calls;
  SELECT COUNT(*) INTO v_completed_calls FROM calls WHERE status = 'completed';

  SELECT COUNT(*) INTO v_bookings_confirmed
  FROM bookings WHERE status IN ('confirmed', 'completed');

  SELECT COUNT(*) INTO v_bookings_no_show
  FROM bookings WHERE status = 'no_show';

  IF v_completed_calls > 0 THEN
    v_conversion_rate := ROUND((v_bookings_confirmed::NUMERIC / v_completed_calls) * 100, 2);
  ELSE
    v_conversion_rate := 0;
  END IF;

  SELECT COALESCE(AVG(duration_seconds), 0)::INT INTO v_avg_duration
  FROM calls WHERE status = 'completed';

  SELECT COALESCE(AVG(avg_latency_ms), 0)::INT INTO v_avg_latency
  FROM calls WHERE status = 'completed' AND avg_latency_ms IS NOT NULL;

  SELECT COUNT(*) INTO v_leads_a FROM leads WHERE lead_grade = 'A';
  SELECT COUNT(*) INTO v_leads_b FROM leads WHERE lead_grade = 'B';
  SELECT COUNT(*) INTO v_leads_c FROM leads WHERE lead_grade = 'C';

  SELECT drop_off_phase INTO v_top_drop_off
  FROM calls
  WHERE drop_off_phase IS NOT NULL
  GROUP BY drop_off_phase
  ORDER BY COUNT(*) DESC
  LIMIT 1;

  INSERT INTO kpi_snapshots (
    period, total_calls, completed_calls, conversion_rate,
    avg_call_duration_sec, avg_latency_ms,
    leads_a, leads_b, leads_c,
    bookings_confirmed, bookings_no_show, top_drop_off_phase
  ) VALUES (
    p_period, v_total_calls, v_completed_calls, v_conversion_rate,
    v_avg_duration, v_avg_latency,
    v_leads_a, v_leads_b, v_leads_c,
    v_bookings_confirmed, v_bookings_no_show, v_top_drop_off
  )
  RETURNING id INTO snapshot_id;

  RETURN snapshot_id;
END;
$$;

-- 6. Grant anon execute on snapshot function (dashboard can trigger refresh)
GRANT EXECUTE ON FUNCTION compute_kpi_snapshot(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION compute_kpi_snapshot(TEXT) TO service_role;

-- 7. Add Realtime publication for dashboard subscriptions
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE calls;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE kpi_snapshots;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
