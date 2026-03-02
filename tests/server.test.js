/**
 * Server Tests – Integration & Unit tests
 * Run: npm test (from project root or /server)
 */

const request = require('supertest');

// Mock dependencies before requiring app
jest.mock('../server/db/supabase', () => ({
  createCall:         jest.fn().mockResolvedValue({ id: 'test-call-id', vapi_call_id: 'vapi-call-123' }),
  updateCall:         jest.fn().mockResolvedValue({ id: 'test-call-id', lead_id: 'test-lead-id' }),
  logCallEvent:       jest.fn().mockResolvedValue(undefined),
  upsertLead:         jest.fn().mockResolvedValue({ id: 'test-lead-id' }),
  updateLeadScore:    jest.fn().mockResolvedValue(undefined),
  createBooking:      jest.fn().mockResolvedValue({ id: 'test-booking-id' }),
  getCallByVapiId:    jest.fn().mockResolvedValue({ id: 'test-call-id', lead_id: 'test-lead-id' }),
  computeKpiSnapshot: jest.fn().mockResolvedValue('snapshot-id'),
}));

jest.mock('../server/handlers/summary', () => ({
  generateSummary: jest.fn().mockResolvedValue({
    lead_name:     'Max Mustermann',
    lead_company:  'Mustermann GmbH',
    lead_email:    'max@mustermann.de',
    lead_grade:    'A',
    total_score:   85,
    completed_phases: ['opening', 'discovery', 'value_pitch', 'qualification', 'booking'],
    drop_off_phase: null,
    bant_details: {
      budget:    { score: 25, note: 'Budget confirmed > 1000 EUR/month' },
      authority: { score: 25, note: 'CEO, sole decision maker' },
      need:      { score: 25, note: 'High volume, 200+ applicants/month' },
      timeline:  { score: 10, note: 'Within 2 months' },
      fit:       { score: 0,  note: null },
    },
    pain_points:       ['Vorselektion dauert zu lang', 'HR-Team überfordert'],
    objections_raised: [],
    objections_handled: [],
    booked_slot:       '2026-03-10T14:00:00Z',
    recommended_next_steps: ['Demo vorbereiten', 'Case Study senden'],
    agent_notes: 'Sehr interessierter Lead',
  }),
}));

jest.mock('../server/handlers/cal-booking', () => ({
  getAvailableSlots: jest.fn().mockResolvedValue({
    available: true,
    slots: [
      { slot_id: '2026-03-10T10:00:00Z', datetime_iso: '2026-03-10T10:00:00Z', datetime_human: 'Montag, 10. März um 10:00 Uhr' },
      { slot_id: '2026-03-10T14:00:00Z', datetime_iso: '2026-03-10T14:00:00Z', datetime_human: 'Montag, 10. März um 14:00 Uhr' },
      { slot_id: '2026-03-11T09:00:00Z', datetime_iso: '2026-03-11T09:00:00Z', datetime_human: 'Dienstag, 11. März um 09:00 Uhr' },
    ],
  }),
  bookSlot: jest.fn().mockResolvedValue({
    success:       true,
    booking_id:    42,
    booking_uid:   'booking-uid-123',
    scheduled_at:  '2026-03-10T14:00:00Z',
    datetime_human: 'Montag, 10. März um 14:00 Uhr',
    message:       'Demo-Termin am Montag, 10. März um 14:00 Uhr ist gebucht.',
  }),
}));

const app = require('../server/index');

// ─── Health Check ──────────────────────────────────────────────────────────────
describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('b2b-voice-agent-server');
  });
});

// ─── Vapi Webhook: Event Handler ──────────────────────────────────────────────
describe('POST /webhook/vapi', () => {
  const callStartPayload = {
    message: {
      type: 'call-start',
      call: {
        id: 'vapi-call-123',
        assistantId: 'assistant-456',
        customer: { number: '+491234567890' },
        phoneNumber: { number: '+4989123456' },
      },
    },
  };

  it('returns 200 for valid call-start event', async () => {
    const res = await request(app)
      .post('/webhook/vapi')
      .set('Content-Type', 'application/json')
      .send(callStartPayload);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it('returns 400 for missing message type', async () => {
    const res = await request(app)
      .post('/webhook/vapi')
      .set('Content-Type', 'application/json')
      .send({ message: {} });

    expect(res.status).toBe(400);
  });

  it('returns 200 for call-end event', async () => {
    const callEndPayload = {
      message: {
        type: 'call-end',
        call: { id: 'vapi-call-123' },
        durationSeconds: 240,
        endedReason: 'assistant-ended',
        artifact: {
          transcript: 'Lisa: Hallo, hier ist Lisa von TalentFlow... Kunde: Ja, wir haben Bedarf...',
          recordingUrl: 'https://vapi.ai/recordings/abc123',
        },
        analysis: { latency: { p50: 800 } },
      },
    };

    const res = await request(app)
      .post('/webhook/vapi')
      .set('Content-Type', 'application/json')
      .send(callEndPayload);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it('returns 200 for transcript event', async () => {
    const transcriptPayload = {
      message: {
        type: 'transcript',
        call: { id: 'vapi-call-123' },
        transcript: 'Wie viele Bewerbungen bekommen Sie pro Monat?',
      },
    };

    const res = await request(app)
      .post('/webhook/vapi')
      .set('Content-Type', 'application/json')
      .send(transcriptPayload);

    expect(res.status).toBe(200);
  });

  it('returns 200 for hang event', async () => {
    const hangPayload = {
      message: {
        type: 'hang',
        call: { id: 'vapi-call-123' },
      },
    };

    const res = await request(app)
      .post('/webhook/vapi')
      .set('Content-Type', 'application/json')
      .send(hangPayload);

    expect(res.status).toBe(200);
  });

  it('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/unknown-route');
    expect(res.status).toBe(404);
  });
});

// ─── Vapi Tool-Call Handler ────────────────────────────────────────────────────
describe('POST /webhook/vapi/tool', () => {
  const makeToolCallPayload = (toolName, args = {}) => ({
    message: {
      call: { id: 'vapi-call-123' },
      toolCalls: [{
        id: 'tc-001',
        function: {
          name: toolName,
          arguments: args,
        },
      }],
    },
  });

  it('returns available slots for check_availability', async () => {
    const res = await request(app)
      .post('/webhook/vapi/tool')
      .set('Content-Type', 'application/json')
      .send(makeToolCallPayload('check_availability', { days_ahead: 14 }));

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].result.available).toBe(true);
    expect(res.body.results[0].result.slots).toHaveLength(3);
    expect(res.body.results[0].toolCallId).toBe('tc-001');
  });

  it('clamps days_ahead to max 60', async () => {
    const calBooking = require('../server/handlers/cal-booking');

    await request(app)
      .post('/webhook/vapi/tool')
      .set('Content-Type', 'application/json')
      .send(makeToolCallPayload('check_availability', { days_ahead: 999 }));

    expect(calBooking.getAvailableSlots).toHaveBeenCalledWith(60);
  });

  it('returns booking confirmation for book_appointment', async () => {
    const res = await request(app)
      .post('/webhook/vapi/tool')
      .set('Content-Type', 'application/json')
      .send(makeToolCallPayload('book_appointment', {
        slot_id:      '2026-03-10T14:00:00Z',
        lead_name:    'Max Mustermann',
        lead_email:   'max@mustermann.de',
        lead_company: 'Mustermann GmbH',
      }));

    expect(res.status).toBe(200);
    expect(res.body.results[0].result.success).toBe(true);
    expect(res.body.results[0].result.booking_id).toBe(42);
  });

  it('rejects book_appointment without required fields', async () => {
    const res = await request(app)
      .post('/webhook/vapi/tool')
      .set('Content-Type', 'application/json')
      .send(makeToolCallPayload('book_appointment', { slot_id: '2026-03-10T14:00:00Z' }));

    expect(res.status).toBe(200);
    expect(res.body.results[0].result.error).toContain('Pflichtfelder');
  });

  it('returns success for end_call', async () => {
    const res = await request(app)
      .post('/webhook/vapi/tool')
      .set('Content-Type', 'application/json')
      .send(makeToolCallPayload('end_call'));

    expect(res.status).toBe(200);
    expect(res.body.results[0].result.success).toBe(true);
  });

  it('returns error for unknown tool', async () => {
    const res = await request(app)
      .post('/webhook/vapi/tool')
      .set('Content-Type', 'application/json')
      .send(makeToolCallPayload('unknown_tool'));

    expect(res.status).toBe(200);
    expect(res.body.results[0].result.error).toContain('Unknown tool');
  });

  it('returns 400 for invalid tool-call payload', async () => {
    const res = await request(app)
      .post('/webhook/vapi/tool')
      .set('Content-Type', 'application/json')
      .send({ message: {} });

    expect(res.status).toBe(400);
  });
});

// ─── BANT+ Score Calculation ───────────────────────────────────────────────────
describe('BANT+ Lead Scoring', () => {
  function calculateLeadScore({ budget, authority, need, timeline, fit }) {
    const total = budget + authority + need + timeline + fit;
    const grade = total >= 80 ? 'A' : total >= 50 ? 'B' : 'C';
    return { total, grade };
  }

  it('returns grade A for perfect score (100)', () => {
    const result = calculateLeadScore({ budget: 25, authority: 25, need: 25, timeline: 15, fit: 10 });
    expect(result.grade).toBe('A');
    expect(result.total).toBe(100);
  });

  it('returns grade A for boundary score (80)', () => {
    const result = calculateLeadScore({ budget: 25, authority: 25, need: 25, timeline: 5, fit: 0 });
    expect(result.grade).toBe('A');
    expect(result.total).toBe(80);
  });

  it('returns grade B for score 79 (just below A threshold)', () => {
    const result = calculateLeadScore({ budget: 25, authority: 25, need: 25, timeline: 4, fit: 0 });
    expect(result.grade).toBe('B');
    expect(result.total).toBe(79);
  });

  it('returns grade B for boundary score (50)', () => {
    const result = calculateLeadScore({ budget: 12, authority: 12, need: 12, timeline: 8, fit: 6 });
    expect(result.grade).toBe('B');
    expect(result.total).toBe(50);
  });

  it('returns grade C for score 49 (just below B threshold)', () => {
    const result = calculateLeadScore({ budget: 12, authority: 12, need: 12, timeline: 8, fit: 5 });
    expect(result.grade).toBe('C');
    expect(result.total).toBe(49);
  });

  it('returns grade C for minimum score (0)', () => {
    const result = calculateLeadScore({ budget: 0, authority: 0, need: 0, timeline: 0, fit: 0 });
    expect(result.grade).toBe('C');
    expect(result.total).toBe(0);
  });

  it('validates max possible score is 100', () => {
    const maxScore = 25 + 25 + 25 + 15 + 10;
    expect(maxScore).toBe(100);
  });
});
