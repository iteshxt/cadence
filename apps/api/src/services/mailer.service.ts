import nodemailer, { type Transporter } from 'nodemailer';
import type { Crypto } from '../lib/crypto.js';
import type { SenderRow } from '../db/schema.js';

export type SmtpErrorKind = 'retryable' | 'ambiguous' | 'permanent';

/** Commands that run before any message data is sent: a failure there can't have delivered mail. */
const PRE_DATA_COMMANDS = [
  'CONN',
  'EHLO',
  'HELO',
  'LHLO',
  'STARTTLS',
  'AUTH',
  'MAIL FROM',
  'RCPT TO',
];
/** Connection-setup failures that also happen before any data is sent. */
const CONNECTION_CODES = new Set([
  'ECONNECTION',
  'EDNS',
  'ETLS',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

interface SmtpLikeError {
  code?: string;
  command?: string;
  responseCode?: number;
}

/**
 * Decides whether a failed send may be retried without risking a duplicate (tech-spec §7.2 step 7).
 * Only failures that provably happened before DATA are retried; anything during or after DATA,
 * or of unknown phase, is ambiguous and must not be retried.
 */
export function classifySmtpError(err: unknown): SmtpErrorKind {
  const e = (err ?? {}) as SmtpLikeError;
  const command = e.command?.toUpperCase();
  if (typeof e.responseCode === 'number' && e.responseCode >= 500) return 'permanent';
  if (command && PRE_DATA_COMMANDS.some((c) => command.startsWith(c))) return 'retryable';
  if (!command && e.code && CONNECTION_CODES.has(e.code)) return 'retryable';
  return 'ambiguous';
}

export interface OutgoingEmail {
  emailId: string;
  to: string;
  subject: string;
  text: string;
}

export interface SendResult {
  messageId: string;
  previewUrl: string | null;
}

export type SendFn = (sender: SenderRow, email: OutgoingEmail) => Promise<SendResult>;

export function createMailer(crypto: Crypto) {
  const transports = new Map<string, Transporter>();

  function transportFor(sender: SenderRow): Transporter {
    let t = transports.get(sender.id);
    if (!t) {
      t = nodemailer.createTransport({
        host: sender.smtpHost,
        port: sender.smtpPort,
        secure: sender.smtpPort === 465,
        auth: { user: sender.smtpUser, pass: crypto.decrypt(sender.smtpPassEnc) },
        pool: true,
        maxConnections: 2,
        connectionTimeout: 15_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
      });
      transports.set(sender.id, t);
    }
    return t;
  }

  const send: SendFn = async (sender, email) => {
    const info = await transportFor(sender).sendMail({
      from: { name: sender.label, address: sender.fromEmail },
      to: email.to,
      subject: email.subject,
      text: email.text,
      // Deterministic Message-ID: the same email always carries the same ID.
      messageId: `<${email.emailId}@cadence.local>`,
    });
    const preview = nodemailer.getTestMessageUrl(info);
    return { messageId: info.messageId, previewUrl: preview || null };
  };

  return {
    send,
    close() {
      for (const t of transports.values()) t.close();
      transports.clear();
    },
  };
}

export type Mailer = ReturnType<typeof createMailer>;
