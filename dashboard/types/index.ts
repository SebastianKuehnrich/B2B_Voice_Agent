// ─────────────────────────────────────────────────────────────────────────────
// Type Definitions – B2B Voice Agent Dashboard
// ─────────────────────────────────────────────────────────────────────────────

export type LeadGrade = 'A' | 'B' | 'C';
export type LeadStatus = 'new' | 'nurturing' | 'demo_scheduled' | 'demo_done' | 'won' | 'lost';
export type CallStatus = 'initiated' | 'in_progress' | 'completed' | 'failed' | 'no_answer';
export type BookingStatus = 'confirmed' | 'cancelled' | 'rescheduled' | 'no_show' | 'completed';
export type ConversationPhase = 'opening' | 'discovery' | 'value_pitch' | 'qualification' | 'booking' | 'wrapup';

// ─── Database Row Types ────────────────────────────────────────────────────────

export interface Lead {
  id: string;
  created_at: string;
  updated_at: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  job_title: string | null;
  company_size: number | null;
  industry: string | null;
  region: string;
  lead_grade: LeadGrade | null;
  lead_score: number | null;
  score_budget: number;
  score_authority: number;
  score_need: number;
  score_timeline: number;
  score_fit: number;
  pain_points: string[] | null;
  objections: string[] | null;
  notes: string | null;
  status: LeadStatus;
  demo_booked_at: string | null;
  demo_slot: string | null;
  calcom_booking_id: string | null;
}

export interface Call {
  id: string;
  created_at: string;
  vapi_call_id: string;
  vapi_assistant_id: string | null;
  phone_number_from: string | null;
  phone_number_to: string | null;
  call_started_at: string | null;
  call_ended_at: string | null;
  duration_seconds: number | null;
  status: CallStatus;
  end_reason: string | null;
  lead_id: string | null;
  phases_completed: ConversationPhase[] | null;
  drop_off_phase: ConversationPhase | null;
  avg_latency_ms: number | null;
  recording_url: string | null;
  transcript_url: string | null;
  summary: CallSummary | null;
}

export interface CallSummary {
  call_id: string;
  lead_name: string | null;
  lead_company: string | null;
  lead_email: string | null;
  call_duration_seconds: number;
  completed_phases: ConversationPhase[];
  drop_off_phase: ConversationPhase | null;
  bant_details: BANTDetails;
  total_score: number;
  lead_grade: LeadGrade;
  pain_points: string[];
  objections_raised: string[];
  objections_handled: string[];
  booked_slot: string | null;
  recommended_next_steps: string[];
  agent_notes: string | null;
}

export interface BANTDetails {
  budget:    { score: number; note: string | null };
  authority: { score: number; note: string | null };
  need:      { score: number; note: string | null };
  timeline:  { score: number; note: string | null };
  fit:       { score: number; note: string | null };
}

export interface Booking {
  id: string;
  created_at: string;
  lead_id: string | null;
  call_id: string | null;
  calcom_booking_id: string;
  calcom_booking_uid: string | null;
  scheduled_at: string;
  duration_minutes: number;
  attendee_name: string | null;
  attendee_email: string;
  attendee_company: string | null;
  status: BookingStatus;
  cancelled_at: string | null;
  cancellation_reason: string | null;
}

export interface KpiSnapshot {
  id: string;
  snapshot_at: string;
  period: 'hourly' | 'daily';
  total_calls: number;
  completed_calls: number;
  conversion_rate: number | null;
  avg_call_duration_sec: number | null;
  avg_latency_ms: number | null;
  leads_a: number;
  leads_b: number;
  leads_c: number;
  bookings_confirmed: number;
  bookings_no_show: number;
  top_drop_off_phase: ConversationPhase | null;
}

// ─── Dashboard-Specific View Types ────────────────────────────────────────────

export interface DashboardCallRow {
  id: string;
  vapi_call_id: string;
  call_started_at: string | null;
  duration_seconds: number | null;
  status: CallStatus;
  drop_off_phase: ConversationPhase | null;
  avg_latency_ms: number | null;
  lead_name: string | null;
  lead_company: string | null;
  lead_grade: LeadGrade | null;
  lead_score: number | null;
  demo_scheduled_at: string | null;
  booking_status: BookingStatus | null;
}

export interface KpiCardData {
  label: string;
  value: string | number;
  unit?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  target?: string;
  color?: 'green' | 'orange' | 'red' | 'blue';
}

export interface FunnelStep {
  phase: ConversationPhase | 'total';
  label: string;
  count: number;
  percentage: number;
}
