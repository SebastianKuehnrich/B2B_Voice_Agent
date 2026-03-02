'use client';

/**
 * B2B Voice Agent – Analytics Dashboard
 * TalentFlow HR SaaS | Everlast Challenge 2026
 *
 * KPIs tracked:
 *  - Conversion Rate (Calls → Demo-Termin)
 *  - Lead-Score-Verteilung (A/B/C)
 *  - Ø Call-Dauer
 *  - Drop-off Analyse nach Phase
 *  - Ø Latenz
 *  - Call-Log Tabelle
 */

import { Component, useEffect, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend,
} from 'recharts';
import {
  PhoneCall, TrendingUp, Clock, Zap, Calendar, Users,
} from 'lucide-react';
import { getAggregateKpis, getRecentCalls, getKpiSnapshots, getObjectionStats, subscribeToNewCalls } from '../lib/supabase';
import type { DashboardCallRow, KpiSnapshot } from '../types';

// ─── Error Boundary ─────────────────────────────────────────────────────────
class DashboardErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Dashboard Error Boundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="bg-white rounded-xl border border-red-200 p-8 max-w-md text-center">
            <h2 className="text-lg font-bold text-red-600 mb-2">Dashboard-Fehler</h2>
            <p className="text-gray-500 text-sm mb-4">
              {this.state.error?.message || 'Ein unerwarteter Fehler ist aufgetreten.'}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-700"
            >
              Erneut versuchen
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Color Constants ───────────────────────────────────────────────────────────
const GRADE_COLORS = { A: '#27AE60', B: '#E67E22', C: '#C0392B' };
const PHASE_LABELS: Record<string, string> = {
  opening:      'Opening',
  discovery:    'Discovery',
  value_pitch:  'Value Pitch',
  qualification: 'Qualifizierung',
  booking:      'Buchung',
  wrapup:       'Abschluss',
};

// ─── KPI Card Component ────────────────────────────────────────────────────────
function KpiCard({
  icon: Icon,
  label,
  value,
  unit = '',
  target,
  color = '#2E86AB',
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  unit?: string;
  target?: string;
  color?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-3 shadow-sm">
      <div className="flex items-center gap-2 text-gray-500 text-sm font-medium">
        <Icon size={16} color={color} />
        {label}
      </div>
      <div className="flex items-end gap-1">
        <span className="text-3xl font-bold text-gray-900">{value}</span>
        {unit && <span className="text-lg text-gray-400 mb-0.5">{unit}</span>}
      </div>
      {target && <div className="text-xs text-gray-400">Ziel: {target}</div>}
    </div>
  );
}

// ─── Grade Badge ───────────────────────────────────────────────────────────────
function GradeBadge({ grade }: { grade: 'A' | 'B' | 'C' | null }) {
  if (!grade) return <span className="text-gray-300">—</span>;
  const colors: Record<string, string> = {
    A: 'bg-green-100 text-green-700',
    B: 'bg-orange-100 text-orange-700',
    C: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${colors[grade]}`}>
      {grade}
    </span>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────────────────────
export default function DashboardPage() {
  return (
    <DashboardErrorBoundary>
      <Dashboard />
    </DashboardErrorBoundary>
  );
}

function Dashboard() {
  const [kpis, setKpis]       = useState<Awaited<ReturnType<typeof getAggregateKpis>> | null>(null);
  const [calls, setCalls]     = useState<DashboardCallRow[]>([]);
  const [snapshots, setSnapshots] = useState<KpiSnapshot[]>([]);
  const [objections, setObjections] = useState<{ objection: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  // Load data
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setError(null);
        const [kpiData, callData, snapshotData, objectionData] = await Promise.all([
          getAggregateKpis(),
          getRecentCalls(30),
          getKpiSnapshots('daily', 14),
          getObjectionStats(),
        ]);
        if (!cancelled) {
          setKpis(kpiData);
          setCalls(callData);
          setSnapshots(snapshotData);
          setObjections(objectionData);
        }
      } catch (err) {
        console.error('Dashboard load error:', err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Daten konnten nicht geladen werden.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();

    // Real-time subscription
    const channel = subscribeToNewCalls(() => load());
    return () => {
      cancelled = true;
      channel.unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400 text-lg">Dashboard wird geladen…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-xl border border-red-200 p-8 max-w-md text-center">
          <h2 className="text-lg font-bold text-red-600 mb-2">Ladefehler</h2>
          <p className="text-gray-500 text-sm mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-700"
          >
            Seite neu laden
          </button>
        </div>
      </div>
    );
  }

  // Derived data for charts
  const gradeData = [
    { name: 'A – Hot', value: kpis?.leadsA ?? 0, color: GRADE_COLORS.A },
    { name: 'B – Warm', value: kpis?.leadsB ?? 0, color: GRADE_COLORS.B },
    { name: 'C – Cold', value: kpis?.leadsC ?? 0, color: GRADE_COLORS.C },
  ];

  const dropOffData = Object.entries(kpis?.dropOffCounts ?? {}).map(([phase, count]) => ({
    phase: PHASE_LABELS[phase] ?? phase,
    Abbrüche: count,
  }));

  const conversionHistory = snapshots.map(s => ({
    date: new Date(s.snapshot_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }),
    'Conversion %': s.conversion_rate ?? 0,
  }));

  // Conversion Funnel data
  const qualified = (kpis?.leadsA ?? 0) + (kpis?.leadsB ?? 0) + (kpis?.leadsC ?? 0);
  const abLeads = (kpis?.leadsA ?? 0) + (kpis?.leadsB ?? 0);
  const FUNNEL_COLORS = ['#1B3A6B', '#2E86AB', '#E67E22', '#27AE60', '#9B59B6'];
  const funnelData = [
    { step: 'Calls gesamt',   count: kpis?.totalCalls ?? 0 },
    { step: 'Abgeschlossen',  count: kpis?.completedCalls ?? 0 },
    { step: 'Qualifiziert',   count: qualified },
    { step: 'A/B-Lead',       count: abLeads },
    { step: 'Demo gebucht',   count: kpis?.booked ?? 0 },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">TalentFlow Voice Agent</h1>
          <p className="text-sm text-gray-400">Analytics Dashboard · Everlast Challenge 2026</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-sm text-gray-500">Live</span>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">

        {/* KPI Cards */}
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Kennzahlen (gesamt)</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <KpiCard icon={PhoneCall}   label="Gesamt Calls"      value={kpis?.totalCalls ?? 0}                       color="#1B3A6B" />
            <KpiCard icon={Calendar}    label="Demo Termine"       value={kpis?.booked ?? 0}                           color="#27AE60" />
            <KpiCard icon={TrendingUp}  label="Conversion Rate"    value={`${kpis?.conversionRate ?? 0}`} unit="%"     target="> 25%" color="#2E86AB" />
            <KpiCard icon={Clock}       label="Ø Call-Dauer"       value={Math.round((kpis?.avgDurationSeconds ?? 0) / 60)} unit=" Min." target="< 8 Min." color="#E67E22" />
            <KpiCard icon={Zap}         label="Ø Latenz"           value={kpis?.avgLatencyMs ?? 0} unit=" ms"          target="< 1.500 ms" color="#9B59B6" />
            <KpiCard icon={Users}       label="A-Leads"            value={kpis?.leadsA ?? 0}                           color="#27AE60" />
          </div>
        </section>

        {/* Charts Row */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Lead-Grade Distribution */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <h3 className="font-semibold text-gray-800 mb-4">Lead-Score Verteilung</h3>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={gradeData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                  {gradeData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                </Pie>
                <Tooltip formatter={(v) => [`${v} Leads`]} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Drop-off by Phase */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <h3 className="font-semibold text-gray-800 mb-4">Drop-off nach Phase</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={dropOffData} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 12 }} />
                <YAxis type="category" dataKey="phase" tick={{ fontSize: 11 }} width={80} />
                <Tooltip />
                <Bar dataKey="Abbrüche" fill="#C0392B" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Conversion Rate over Time */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <h3 className="font-semibold text-gray-800 mb-4">Conversion Rate (14 Tage)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={conversionHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis unit="%" tick={{ fontSize: 11 }} domain={[0, 100]} />
                <Tooltip formatter={(v) => [`${v}%`, 'Conversion']} />
                <Line type="monotone" dataKey="Conversion %" stroke="#2E86AB" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Conversion Funnel + Top Einwände */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Conversion Funnel */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <h3 className="font-semibold text-gray-800 mb-4">Conversion Funnel</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={funnelData} layout="vertical" margin={{ left: 10 }}>
                <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
                <YAxis type="category" dataKey="step" tick={{ fontSize: 11 }} width={100} />
                <Tooltip formatter={(v) => [`${v} Calls`]} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {funnelData.map((_, i) => <Cell key={i} fill={FUNNEL_COLORS[i]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Top Einwände */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <h3 className="font-semibold text-gray-800 mb-4">Top Einwände</h3>
            {objections.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={objections} layout="vertical" margin={{ left: 10 }}>
                  <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="objection" tick={{ fontSize: 11 }} width={140} />
                  <Tooltip formatter={(v) => [`${v}×`]} />
                  <Bar dataKey="count" fill="#E74C3C" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-gray-400 text-sm">
                Noch keine Einwand-Daten vorhanden.
              </div>
            )}
          </div>
        </section>

        {/* Call Log Table */}
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-800">Call-Log (letzte 30 Calls)</h3>
            <span className="text-sm text-gray-400">{calls.length} Einträge</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Datum</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Lead</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Unternehmen</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Dauer</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Score</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Grade</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Demo</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Drop-off</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((call, i) => (
                  <tr key={call.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {call.call_started_at
                        ? new Date(call.call_started_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                        : '—'}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-800">{call.lead_name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{call.lead_company ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {call.duration_seconds ? `${Math.round(call.duration_seconds / 60)} Min.` : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-700 font-mono">
                      {call.lead_score ?? '—'}
                    </td>
                    <td className="px-4 py-3"><GradeBadge grade={call.lead_grade} /></td>
                    <td className="px-4 py-3">
                      {call.demo_scheduled_at ? (
                        <span className="text-green-600 font-medium text-xs">
                          {new Date(call.demo_scheduled_at).toLocaleDateString('de-DE')}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {call.drop_off_phase ? PHASE_LABELS[call.drop_off_phase] ?? call.drop_off_phase : '—'}
                    </td>
                  </tr>
                ))}
                {calls.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                      Noch keine Call-Daten vorhanden.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <footer className="text-center text-xs text-gray-300 py-6">
        TalentFlow Voice Agent · Everlast Challenge 2026
      </footer>
    </div>
  );
}
