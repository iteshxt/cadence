import { LIMITS, isValidEmail, normalizeEmail } from '@cadence/shared';
import Papa from 'papaparse';

export interface ParsedLeads {
  emails: string[];
  duplicates: number;
  invalid: number;
}

export class LeadsFileError extends Error {}

const EMAIL_HEADERS = new Set([
  'email',
  'e-mail',
  'email address',
  'e-mail address',
  'emailaddress',
  'mail',
]);

/**
 * Parses recipients from CSV or TXT text (tech-spec §6.3).
 * - CSV: if the first row has a column named like "email", only that column is used; otherwise
 *   every cell is scanned and anything containing "@" is treated as an address attempt.
 * - TXT: split on newlines, commas, and semicolons; every non-empty token is an address attempt.
 * Addresses are trimmed, lowercased, deduplicated, and validated with the same rule the API uses.
 */
export function parseLeadsText(text: string, kind: 'csv' | 'txt'): ParsedLeads {
  const seen = new Set<string>();
  const emails: string[] = [];
  let duplicates = 0;
  let invalid = 0;

  const consider = (raw: string, mustLookLikeEmail: boolean) => {
    const value = normalizeEmail(raw.replace(/^["']|["']$/g, ''));
    if (!value) return;
    if (mustLookLikeEmail && !value.includes('@')) return;
    if (!isValidEmail(value)) {
      invalid++;
      return;
    }
    if (seen.has(value)) {
      duplicates++;
      return;
    }
    seen.add(value);
    emails.push(value);
  };

  if (kind === 'txt') {
    for (const token of text.split(/[\n\r,;]+/)) consider(token, false);
    return { emails, duplicates, invalid };
  }

  const rows = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), {
    header: false,
    skipEmptyLines: true,
  }).data;
  const header = rows[0]?.map((c) => c.trim().toLowerCase()) ?? [];
  const emailCol = header.findIndex((c) => EMAIL_HEADERS.has(c));
  if (emailCol >= 0) {
    for (const row of rows.slice(1)) consider(row[emailCol] ?? '', false);
  } else {
    for (const row of rows) for (const cell of row) consider(cell, true);
  }
  return { emails, duplicates, invalid };
}

/**
 * Recipients typed or pasted into Compose: separated by new lines, commas, semicolons, or spaces.
 * Same cleaning as a TXT file. Throws when there are more than the campaign limit.
 */
export function parseTypedRecipients(text: string): ParsedLeads {
  const result = parseLeadsText(text.replace(/\s+/g, '\n'), 'txt');
  if (result.emails.length > LIMITS.MAX_RECIPIENTS) {
    throw new LeadsFileError(
      `That's ${result.emails.length.toLocaleString('en-US')} addresses. The limit is ${LIMITS.MAX_RECIPIENTS.toLocaleString('en-US')} per campaign.`,
    );
  }
  return result;
}

export async function parseLeadsFile(file: File): Promise<ParsedLeads> {
  const name = file.name.toLowerCase();
  const kind = name.endsWith('.txt') ? 'txt' : name.endsWith('.csv') ? 'csv' : null;
  if (!kind) throw new LeadsFileError('Choose a .csv or .txt file.');
  if (file.size > LIMITS.MAX_FILE_BYTES) {
    throw new LeadsFileError(
      `This file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 2 MB.`,
    );
  }
  const result = parseLeadsText(await file.text(), kind);
  if (result.emails.length === 0) {
    throw new LeadsFileError('No valid email addresses found in this file.');
  }
  if (result.emails.length > LIMITS.MAX_RECIPIENTS) {
    throw new LeadsFileError(
      `This file has ${result.emails.length.toLocaleString('en-US')} addresses. The limit is ${LIMITS.MAX_RECIPIENTS.toLocaleString('en-US')} per campaign.`,
    );
  }
  return result;
}
