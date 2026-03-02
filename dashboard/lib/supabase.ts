/**
 * Supabase Client for Next.js Dashboard
 * Uses anon key for read-only access (protected by RLS)
 *
 * Client is lazily initialized to avoid build-time errors during SSG.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type {
  Call, KpiSnapshot, DashboardCallRow,
} from '../types';

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;

  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  _client = createClient(url, anon);
  return _client;
}

// ─── Dashboard Queries ─────────────────────────────────────────────────────────

/** Fetch last N calls with lead info (from dashboard_calls_summary view) */
export async function getRecentCalls(limit = 50): Promise<DashboardCallRow[]> {
  const { data, error } = await getClient()
    .from('dashboard_calls_summary')
    .select('*')
    .order('call_started_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

/** Fetch KPI snapshots for time-series charts */
export async function getKpiSnapshots(
  period: 'hourly' | 'daily' = 'daily',
  days = 30,
): Promise<KpiSnapshot[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await getClient()
    .from('kpi_snapshots')
    .select('*')
    .eq('period', period)
    .gte('snapshot_at', since)
    .order('snapshot_at', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

/**
 * Fetch aggregate KPIs for the summary cards.
 * Uses dashboard_calls_summary view (security definer) + calls table (anon readable)
 * to avoid RLS blocks on leads/bookings tables.
 */
export async function getAggregateKpis() {
  const client = getClient();

  const [viewRes, callsRes] = await Promise.all([
    client
      .from('dashboard_calls_summary')
      .select('lead_grade, lead_score, demo_scheduled_at, booking_status, drop_off_phase, duration_seconds, avg_latency_ms, status'),
    client
      .from('calls')
      .select('status')
      .eq('status', 'completed'),
  ]);

  const rows  = viewRes.data  ?? [];
  const calls = callsRes.data ?? [];

  const totalCalls     = calls.length;
  const completedRows  = rows.filter(r => r.status === 'completed');
  const booked         = rows.filter(r => r.booking_status === 'confirmed' || r.booking_status === 'completed').length;
  const conversionRate = totalCalls > 0 ? ((booked / totalCalls) * 100).toFixed(1) : '0.0';
  const avgDuration    = completedRows.reduce((s, c) => s + (c.duration_seconds ?? 0), 0) / (completedRows.length || 1);
  const avgLatency     = completedRows.reduce((s, c) => s + (c.avg_latency_ms ?? 0), 0) / (completedRows.length || 1);

  const leadsA = rows.filter(r => r.lead_grade === 'A').length;
  const leadsB = rows.filter(r => r.lead_grade === 'B').length;
  const leadsC = rows.filter(r => r.lead_grade === 'C').length;

  const dropOffCounts: Record<string, number> = {};
  completedRows.forEach(c => {
    if (c.drop_off_phase) {
      dropOffCounts[c.drop_off_phase] = (dropOffCounts[c.drop_off_phase] ?? 0) + 1;
    }
  });

  return {
    totalCalls,
    completedCalls: completedRows.length,
    booked,
    conversionRate: parseFloat(conversionRate),
    avgDurationSeconds: Math.round(avgDuration),
    avgLatencyMs: Math.round(avgLatency),
    leadsA,
    leadsB,
    leadsC,
    dropOffCounts,
  };
}

/** Fetch top objections from call summaries (calls.summary JSONB) */
export async function getObjectionStats(): Promise<{ objection: string; count: number }[]> {
  const { data, error } = await getClient()
    .from('calls')
    .select('summary')
    .not('summary', 'is', null);

  if (error) throw error;

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const summary = row.summary as Record<string, unknown> | null;
    const objections = summary?.objections_raised;
    if (Array.isArray(objections)) {
      for (const obj of objections) {
        if (typeof obj === 'string' && obj.trim()) {
          counts[obj.trim()] = (counts[obj.trim()] ?? 0) + 1;
        }
      }
    }
  }

  return Object.entries(counts)
    .map(([objection, count]) => ({ objection, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

/** Subscribe to real-time call updates */
export function subscribeToNewCalls(callback: (call: Call) => void) {
  return getClient()
    .channel('calls-realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls' }, (payload) => {
      callback(payload.new as Call);
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls' }, (payload) => {
      callback(payload.new as Call);
    })
    .subscribe();
}
