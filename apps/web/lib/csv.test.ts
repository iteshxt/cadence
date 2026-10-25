import { describe, expect, it } from 'vitest';
import { parseLeadsText } from './csv';

describe('parseLeadsText', () => {
  it('uses only the email column when the header names one', () => {
    const csv =
      'Name,Email,Company\nJane,Jane@Acme.com,Acme\nSam,sam@globex.io,"Globex, Inc"\nBad,not-an-email,X\n';
    expect(parseLeadsText(csv, 'csv')).toEqual({
      emails: ['jane@acme.com', 'sam@globex.io'],
      duplicates: 0,
      invalid: 1,
    });
  });

  it('scans every cell when there is no email header, ignoring cells without @', () => {
    const csv = 'jane@acme.com,Jane Doe\nfoo,sam@globex.io\nbroken@,x\n';
    expect(parseLeadsText(csv, 'csv')).toEqual({
      emails: ['jane@acme.com', 'sam@globex.io'],
      duplicates: 0,
      invalid: 1,
    });
  });

  it('dedupes case-insensitively and counts duplicates', () => {
    const csv = 'email\na@x.com\nA@X.com\n a@x.com \nb@x.com\n';
    expect(parseLeadsText(csv, 'csv')).toEqual({
      emails: ['a@x.com', 'b@x.com'],
      duplicates: 2,
      invalid: 0,
    });
  });

  it('handles a byte-order mark and Windows line endings', () => {
    const csv = '\uFEFFEmail\r\na@x.com\r\nb@x.com\r\n';
    expect(parseLeadsText(csv, 'csv').emails).toEqual(['a@x.com', 'b@x.com']);
  });

  it('splits TXT on newlines, commas, and semicolons', () => {
    const txt = 'a@x.com, b@x.com;c@x.com\n\nnot valid\na@x.com\r\nmailto:D@X.com';
    expect(parseLeadsText(txt, 'txt')).toEqual({
      emails: ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'],
      duplicates: 1,
      invalid: 1,
    });
  });
});
