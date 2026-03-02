/**
 * Cal.com Integration
 * Handles availability checks and demo booking via Cal.com v2 API
 */

const axios  = require('axios');
const dayjs  = require('dayjs');
const logger = require('../utils/logger');
const db     = require('../db/supabase');

const CAL_API_URL      = process.env.CALCOM_API_URL || 'https://api.cal.com/v2';
const CAL_EVENT_TYPE   = process.env.CALCOM_EVENT_TYPE_ID;
const CAL_USERNAME     = process.env.CALCOM_USERNAME;
const SLOTS_TO_OFFER   = 3;
const BOOKING_LEAD_HRS = 4;   // minimum hours before a slot can be booked
const MAX_DAYS_AHEAD   = 14;
const DEFAULT_TIMEZONE = process.env.CALCOM_TIMEZONE || 'Europe/Berlin';

// Validate critical config at module load
if (!CAL_EVENT_TYPE || isNaN(parseInt(CAL_EVENT_TYPE, 10))) {
  logger.error('CALCOM_EVENT_TYPE_ID is missing or not a valid number');
}
if (!CAL_USERNAME) {
  logger.error('CALCOM_USERNAME is missing');
}
if (!process.env.CALCOM_API_KEY) {
  logger.error('CALCOM_API_KEY is missing');
}

// ─── Cal.com API Client ────────────────────────────────────────────────────────
// Note: cal-api-version differs per endpoint (/slots: 2024-09-04, /bookings: 2024-08-13)
// Set per-request in getAvailableSlots() and bookSlot()
const calClient = axios.create({
  baseURL: CAL_API_URL,
  headers: {
    'Authorization': `Bearer ${process.env.CALCOM_API_KEY}`,
    'Content-Type':  'application/json',
  },
  timeout: 8000,
});

// ─── Get Available Slots ───────────────────────────────────────────────────────
/**
 * Fetch next N available demo slots from Cal.com
 * Returns human-readable slot options for the agent to read aloud
 *
 * @param {number} daysAhead - How many days forward to search
 * @returns {Promise<Array<{ slot_id: string, datetime_human: string, datetime_iso: string }>>}
 */
async function getAvailableSlots(daysAhead = MAX_DAYS_AHEAD) {
  const startTime = dayjs().add(BOOKING_LEAD_HRS, 'hour').toISOString();
  const endTime   = dayjs().add(daysAhead, 'day').toISOString();

  logger.info('Cal.com: fetching available slots', { startTime, endTime });

  try {
    const response = await calClient.get('/slots', {
      params: {
        start:       startTime,
        end:         endTime,
        eventTypeId: CAL_EVENT_TYPE,
      },
      headers: { 'cal-api-version': '2024-09-04' },  // slots endpoint version
    });

    // Cal.com v2 returns { data: { "2026-03-03": [{ start: "..." }] } }
    const slotsData = response.data?.data ?? {};

    const slots = [];
    for (const [date, daySlots] of Object.entries(slotsData)) {
      for (const slot of daySlots) {
        if (slots.length >= SLOTS_TO_OFFER) break;

        const slotTime = slot.start ?? slot.time;
        const dt = dayjs(slotTime);
        slots.push({
          slot_id:        slotTime,                // ISO string used as ID for booking
          datetime_iso:   slotTime,
          datetime_human: formatSlotGerman(dt),    // "Montag, 3. März um 14:00 Uhr"
        });
      }
      if (slots.length >= SLOTS_TO_OFFER) break;
    }

    if (slots.length === 0) {
      logger.warn('Cal.com: no available slots found');
      return { available: false, slots: [], message: 'Leider gibt es in den nächsten zwei Wochen keine freien Slots. Ich notiere Ihre Anfrage und melde mich.' };
    }

    logger.info(`Cal.com: found ${slots.length} available slots`);
    return { available: true, slots };
  } catch (err) {
    logger.error('Cal.com: getAvailableSlots failed', { message: err.message, status: err.response?.status });
    throw new Error('Kalender momentan nicht erreichbar. Bitte versuchen Sie es später.');
  }
}

// ─── Book a Slot ──────────────────────────────────────────────────────────────
/**
 * Book a demo appointment on Cal.com
 *
 * @param {object} params
 * @param {string} params.slot_id       - ISO datetime string of the chosen slot
 * @param {string} params.lead_name     - Full name of the lead
 * @param {string} params.lead_email    - Email address (required by Cal.com)
 * @param {string} params.lead_company  - Company name
 * @param {string} [params.lead_id]     - Internal lead UUID (for DB linking)
 * @param {string} [params.call_id]     - Internal call UUID (for DB linking)
 * @returns {Promise<object>} booking confirmation
 */
async function bookSlot({ slot_id, lead_name, lead_email, lead_company, lead_id, call_id }) {
  // Use fallback email for voice-call bookings where email isn't available
  const effectiveEmail = lead_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead_email)
    ? lead_email
    : `voice-lead-${Date.now()}@talentflow-demo.de`;

  if (!lead_email) {
    logger.info('Cal.com: no email provided, using fallback email for booking');
  }

  logger.info('Cal.com: booking slot', { slot_id, email: effectiveEmail });

  try {
    // Cal.com v2: /bookings requires cal-api-version 2024-08-13 (different from /slots!)
    const response = await calClient.post('/bookings', {
      eventTypeId: parseInt(CAL_EVENT_TYPE, 10),
      start:       slot_id,
      attendee: {
        name:     lead_name || 'Interessent',
        email:    effectiveEmail,
        timeZone: DEFAULT_TIMEZONE,
        language: 'de',
      },
      metadata: {
        company: lead_company,
        source:  'voice-agent',
      },
    }, {
      headers: { 'cal-api-version': '2024-08-13' },  // bookings endpoint version
    });

    const booking = response.data?.data;

    if (!booking?.id) {
      throw new Error('Booking response did not contain an ID');
    }

    logger.info('Cal.com: booking confirmed', { bookingId: booking.id, uid: booking.uid });

    // Persist booking to Supabase
    await db.createBooking({
      lead_id,
      call_id,
      calcom_booking_id:  String(booking.id),
      calcom_booking_uid: booking.uid,
      scheduled_at:       slot_id,
      duration_minutes:   30,
      attendee_name:      lead_name,
      attendee_email:     effectiveEmail,
      attendee_company:   lead_company,
      status:             'confirmed',
    });

    return {
      success:       true,
      booking_id:    booking.id,
      booking_uid:   booking.uid,
      scheduled_at:  slot_id,
      datetime_human: formatSlotGerman(dayjs(slot_id)),
      message:       `Super! Der Demo-Termin am ${formatSlotGerman(dayjs(slot_id))} ist gebucht. Sie erhalten gleich eine Kalender-Einladung.`,
    };
  } catch (err) {
    if (err.response?.status === 409) {
      // Slot already taken – fetch new options
      logger.warn('Cal.com: slot conflict, slot was already taken', { slot_id });
      throw new Error('Dieser Termin ist leider gerade vergeben. Lassen Sie mich einen anderen Slot für Sie suchen.');
    }

    logger.error('Cal.com: bookSlot failed', {
      message: err.message,
      status:  err.response?.status,
      data:    err.response?.data,
      slot_id,
      email: effectiveEmail,
    });
    throw new Error('Die Buchung ist leider fehlgeschlagen. Ich notiere Ihren Wunschtermin und unser Team meldet sich.');
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const GERMAN_WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const GERMAN_MONTHS   = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function formatSlotGerman(dt) {
  const weekday = GERMAN_WEEKDAYS[dt.day()];
  const day     = dt.date();
  const month   = GERMAN_MONTHS[dt.month()];
  const time    = dt.format('HH:mm');
  return `${weekday}, ${day}. ${month} um ${time} Uhr`;
}

module.exports = { getAvailableSlots, bookSlot };
