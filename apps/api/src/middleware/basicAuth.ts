import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

const digest = (s: string) => createHash('sha256').update(s).digest();

/** HTTP basic auth for Bull Board (QD-2). Compares digests in constant time. */
export function basicAuth(user: string, pass: string, realm = 'Cadence queues'): RequestHandler {
  const expected = digest(`${user}:${pass}`);
  return (req, res, next) => {
    const header = req.headers.authorization ?? '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      const given = digest(Buffer.from(encoded, 'base64').toString('utf8'));
      if (timingSafeEqual(given, expected)) return next();
    }
    res.setHeader('WWW-Authenticate', `Basic realm="${realm}", charset="UTF-8"`);
    res.status(401).send('Authentication required');
  };
}
