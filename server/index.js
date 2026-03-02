/**
 * B2B Voice Agent – Webhook Server
 * TalentFlow HR SaaS | Everlast Challenge 2026
 *
 * Entry point: Express server that handles Vapi webhook events
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');

const logger           = require('./utils/logger');
const vapiWebhook      = require('./handlers/vapi-webhook');
const { authMiddleware } = require('./middleware/auth');

// ─── Validate Required Environment Variables ──────────────────────────────────
const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    logger.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}
if (!process.env.VAPI_WEBHOOK_SECRET && process.env.NODE_ENV === 'production') {
  logger.error('VAPI_WEBHOOK_SECRET must be set in production');
  process.exit(1);
}

// ─── App Setup ────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Security Middleware ───────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.DASHBOARD_URL || (process.env.NODE_ENV === 'production' ? false : '*'),
}));

// Rate limiting – webhook routes get a higher limit since Vapi sends
// many events per call (transcripts, status-updates, tool-calls).
// A single 7-min call can easily produce 100+ requests.
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { error: 'Too many requests, please try again later.' },
});
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/webhook', webhookLimiter);
app.use((req, res, next) => {
  // Skip general limiter for webhook routes (already covered by webhookLimiter)
  if (req.path.startsWith('/webhook')) return next();
  generalLimiter(req, res, next);
});

// ─── Logging ──────────────────────────────────────────────────────────────────
app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) },
}));

// ─── Body Parsing ─────────────────────────────────────────────────────────────
// Webhook routes need raw body for HMAC signature verification.
// Other routes use standard JSON parsing.
// Using a single conditional middleware avoids path-mounting quirks.
// Vapi conversation-update events include full system prompt + conversation
// history and can easily exceed the default 100KB limit.
const rawJsonParser  = express.raw({ type: 'application/json', limit: '5mb' });
const jsonParser     = express.json({ limit: '5mb' });

app.use((req, res, next) => {
  if (req.path.startsWith('/webhook/vapi')) {
    return rawJsonParser(req, res, next);
  }
  return jsonParser(req, res, next);
});

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'b2b-voice-agent-server',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────

// Vapi webhook (receives all call lifecycle events)
app.post('/webhook/vapi', authMiddleware, vapiWebhook);

// Vapi tool-call webhook (synchronous tool responses)
app.post('/webhook/vapi/tool', authMiddleware, vapiWebhook.vapiToolCallHandler);

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  logger.warn(`[404] ${req.method} ${req.originalUrl} (no matching route)`);
  res.status(404).json({ error: 'Route not found' });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error('Unhandled error:', { message: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`Voice Agent Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Health: http://localhost:${PORT}/health`);
});

module.exports = app; // for testing
