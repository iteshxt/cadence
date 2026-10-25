import { pino, type Logger } from 'pino';

export type { Logger };

export function createLogger(
  level: string,
  pretty = process.env.NODE_ENV === 'development',
): Logger {
  return pino({
    level,
    base: { service: process.env.CADENCE_SERVICE ?? 'api' },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.smtpPass',
        '*.webhookUrl',
        '*.accessToken',
      ],
      censor: '[redacted]',
    },
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' },
          },
        }
      : {}),
  });
}
