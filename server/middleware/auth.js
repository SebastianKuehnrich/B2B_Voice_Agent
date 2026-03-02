/**
 * Authentication Middleware
 * Verifies Vapi webhook signature using HMAC-SHA256
 */

const crypto = require('crypto');
const logger  = require('../utils/logger');

/**
 * Verify Vapi webhook signature
 * Vapi sends: x-vapi-signature header = HMAC-SHA256(rawBody, secret)
 */
function authMiddleware(req, res, next) {
  logger.debug(`[auth] ${req.method} ${req.originalUrl} Content-Type=${req.headers['content-type']}`);

  const secret = process.env.VAPI_WEBHOOK_SECRET;

  // ── Development: skip HMAC verification ────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    logger.debug('[auth] Development mode — skipping HMAC verification');
    try {
      if (Buffer.isBuffer(req.body)) {
        req.body = JSON.parse(req.body.toString());
      } else if (typeof req.body === 'string') {
        req.body = JSON.parse(req.body);
      }
      // else: already parsed by express.json()
    } catch (err) {
      logger.warn('[auth] Failed to parse body:', err.message);
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
    logger.debug(`[auth] Parsed body type: ${req.body?.message?.type ?? 'unknown'}`);
    return next();
  }

  // ── Production: require HMAC verification ──────────────────────────────────
  if (!secret) {
    logger.error('VAPI_WEBHOOK_SECRET is not configured — rejecting request');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const signature = req.headers['x-vapi-signature'];
  const rawBody   = req.body; // raw Buffer (express.raw middleware)

  if (!signature) {
    logger.warn('Webhook rejected: missing x-vapi-signature header');
    return res.status(401).json({ error: 'Missing signature' });
  }

  try {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    // timingSafeEqual throws if buffers differ in length — catch that
    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expected, 'hex');

    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      logger.warn('Webhook rejected: invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  } catch {
    logger.warn('Webhook rejected: signature verification error');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Parse body after verification
  try {
    req.body = JSON.parse(rawBody.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  next();
}

module.exports = { authMiddleware };
