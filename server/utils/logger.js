/**
 * Logger utility using Winston
 * Structured JSON logging for production, pretty-print for development
 */

const winston = require('winston');

const { combine, timestamp, printf, colorize, json } = winston.format;

const devFormat = printf(({ level, message, timestamp: ts, ...meta }) => {
  const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
  return `${ts} [${level}] ${message}${metaStr}`;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' })),
  transports: [
    process.env.NODE_ENV === 'production'
      ? new winston.transports.Console({ format: json() })
      : new winston.transports.Console({ format: combine(colorize(), devFormat) }),
  ],
});

module.exports = logger;
