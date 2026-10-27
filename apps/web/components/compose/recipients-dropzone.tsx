'use client';

import { FileText, Upload, X } from 'lucide-react';
import { useId, useRef, useState, type DragEvent } from 'react';
import { cn } from '@/lib/cn';
import { LeadsFileError, parseLeadsFile, parseTypedRecipients, type ParsedLeads } from '@/lib/csv';
import { fmtNumber, plural } from '@/lib/format';
import { Textarea } from '../ui/input';
import { Segmented } from '../ui/misc';
import { Spinner } from '../ui/spinner';

export interface RecipientsFile extends ParsedLeads {
  name: string;
  size: number;
}

function fmtSize(bytes: number) {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(0)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

type Source = 'file' | 'typed';

/** "1,240 emails ready. Removed 12 duplicates and 3 invalid addresses." Announced politely. */
function ResultLine({ value }: { value: ParsedLeads }) {
  return (
    <p aria-live="polite" className="text-body">
      <span className="font-semibold text-ink">{fmtNumber(value.emails.length)} emails ready</span>
      {(value.duplicates > 0 || value.invalid > 0) && (
        <span className="text-ink-3">
          {'. Removed '}
          {[
            value.duplicates > 0 && plural(value.duplicates, 'duplicate'),
            value.invalid > 0 && plural(value.invalid, 'invalid address', 'invalid addresses'),
          ]
            .filter(Boolean)
            .join(' and ')}
          .
        </span>
      )}
    </p>
  );
}

/**
 * Recipients from a file (a real <input type="file"> behind a dashed drop area) or typed in
 * (design.md §7.6). Both go through the same cleaning; results are announced politely (§10).
 */
export function RecipientsDropzone({
  value,
  onChange,
  error,
  label = 'Recipients',
}: {
  value: RecipientsFile | null;
  onChange: (v: RecipientsFile | null) => void;
  error?: string;
  label?: string;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [source, setSource] = useState<Source>('file');
  const [typed, setTyped] = useState('');
  const [typedResult, setTypedResult] = useState<ParsedLeads | null>(null);

  const switchSource = (next: Source) => {
    setSource(next);
    setFileError(null);
    setTyped('');
    setTypedResult(null);
    onChange(null);
  };

  const onType = (text: string) => {
    setTyped(text);
    try {
      const parsed = parseTypedRecipients(text);
      setFileError(null);
      setTypedResult(parsed.emails.length > 0 || parsed.invalid > 0 ? parsed : null);
      onChange(
        parsed.emails.length > 0 ? { ...parsed, name: 'Typed addresses', size: text.length } : null,
      );
    } catch (err) {
      setTypedResult(null);
      setFileError(err instanceof LeadsFileError ? err.message : 'Couldn’t read these addresses.');
      onChange(null);
    }
  };

  async function handle(file: File | undefined) {
    if (!file) return;
    setFileError(null);
    setParsing(true);
    try {
      const parsed = await parseLeadsFile(file);
      onChange({ ...parsed, name: file.name, size: file.size });
    } catch (err) {
      onChange(null);
      setFileError(
        err instanceof LeadsFileError
          ? err.message
          : 'Couldn’t read this file. Try exporting it again as CSV.',
      );
    } finally {
      setParsing(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void handle(e.dataTransfer.files[0]);
  };

  const message = fileError ?? error;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span id={`${id}-label`} className="text-label text-ink">
          {label}
        </span>
        <Segmented
          label="How to add recipients"
          value={source}
          onChange={switchSource}
          options={[
            { value: 'file', label: 'Upload file' },
            { value: 'typed', label: 'Type addresses' },
          ]}
        />
      </div>
      {source === 'typed' ? (
        <div className="flex flex-col gap-2">
          <Textarea
            id={`${id}-typed`}
            rows={4}
            value={typed}
            onChange={(e) => onType(e.target.value)}
            placeholder={'jane@acme.com\nsam@globex.com, lee@initech.com'}
            aria-labelledby={`${id}-label`}
            aria-invalid={message ? true : undefined}
            aria-describedby={message ? `${id}-error` : `${id}-typed-help`}
            className="min-h-24"
          />
          {typedResult && typedResult.emails.length > 0 ? (
            <ResultLine value={typedResult} />
          ) : (
            <p id={`${id}-typed-help`} className="text-caption text-ink-3">
              One per line, or separated by commas or spaces. Up to 5,000.
            </p>
          )}
        </div>
      ) : value ? (
        <div className="flex flex-col gap-2">
          <div className="flex h-11 items-center gap-2 rounded-control border border-line bg-surface px-3">
            <FileText aria-hidden strokeWidth={1.5} className="size-4 text-ink-2" />
            <span className="min-w-0 flex-1 truncate text-body text-ink">{value.name}</span>
            <span className="text-caption text-ink-3">{fmtSize(value.size)}</span>
            <button
              type="button"
              onClick={() => onChange(null)}
              aria-label={`Remove ${value.name}`}
              className="-mr-1 flex size-8 items-center justify-center rounded-control text-ink-2 hover:bg-sunken"
            >
              <X strokeWidth={1.5} className="size-4" />
            </button>
          </div>
          <ResultLine value={value} />
          <details className="text-caption text-ink-2">
            <summary className="cursor-pointer select-none hover:text-ink">
              First 5 recipients
            </summary>
            <ul className="mt-1 space-y-0.5 pl-4">
              {value.emails.slice(0, 5).map((e) => (
                <li key={e} className="truncate">
                  {e}
                </li>
              ))}
            </ul>
          </details>
        </div>
      ) : (
        <label
          htmlFor={id}
          onDragOver={(e) => (e.preventDefault(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          className={cn(
            'flex h-30 cursor-pointer flex-col items-center justify-center gap-1 rounded-panel border border-dashed border-control px-4 text-center transition-colors duration-150',
            'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-signal',
            over ? 'border-signal bg-signal-soft' : 'hover:bg-sunken',
            message && 'border-failed',
          )}
        >
          {parsing ? (
            <Spinner className="size-5 text-ink-2" label="Reading file" />
          ) : (
            <Upload aria-hidden strokeWidth={1.5} className="size-5 text-ink-2" />
          )}
          <span className="text-body text-ink">
            Drop a CSV or TXT file, or <span className="font-semibold text-signal">browse</span>
          </span>
          <span className="text-caption text-ink-3">Up to 2 MB and 5,000 recipients</span>
          <input
            ref={inputRef}
            id={id}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="sr-only"
            aria-labelledby={`${id}-label`}
            aria-invalid={message ? true : undefined}
            aria-describedby={message ? `${id}-error` : undefined}
            onChange={(e) => void handle(e.target.files?.[0])}
          />
        </label>
      )}
      {message && (
        <p id={`${id}-error`} role="alert" className="text-caption text-failed">
          {message}
        </p>
      )}
    </div>
  );
}
