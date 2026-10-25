'use client';

import { LIMITS, type EmailStatus } from '@cadence/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearch } from '@/hooks/queries';
import { usePager } from '@/hooks/use-pager';
import { fmtNumber } from '@/lib/format';
import { Input } from '../ui/input';
import { Segmented } from '../ui/misc';
import { PageHead } from '../layout/page-head';
import { EmailTable, EmptyState } from './email-table';

type Filter = 'all' | Extract<EmailStatus, 'scheduled' | 'deferred' | 'sent' | 'failed'>;

export function SearchView() {
  const params = useSearchParams();
  const router = useRouter();
  const q = params.get('q') ?? '';
  const [draft, setDraft] = useState(q);
  const [filter, setFilter] = useState<Filter>('all');
  const pager = usePager(LIMITS.PAGE_SIZE);
  const { reset } = pager;
  const results = useSearch(q, filter === 'all' ? null : filter, pager.cursor);

  useEffect(() => {
    setDraft(q);
    reset();
  }, [q, reset]);
  useEffect(() => reset(), [filter, reset]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const term = draft.trim();
    router.replace(term ? `/dashboard/search?q=${encodeURIComponent(term)}` : '/dashboard/search');
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        title="Search"
        description={
          q && results.data ? (
            <span aria-live="polite">
              {fmtNumber(results.data.total)}{' '}
              {results.data.total === 1 ? 'email matches' : 'emails match'} “{q}”
            </span>
          ) : (
            'Find any email by recipient, subject, or message.'
          )
        }
      />

      {/* The header field is hidden on small screens, so the page has its own. */}
      <form role="search" onSubmit={submit} className="md:hidden">
        <Input
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Search recipient, subject, or message"
          aria-label="Search emails"
        />
      </form>

      <Segmented
        label="Filter by status"
        value={filter}
        onChange={setFilter}
        className="self-start"
        options={[
          { value: 'all', label: 'All' },
          { value: 'scheduled', label: 'Scheduled' },
          { value: 'deferred', label: 'Deferred' },
          { value: 'sent', label: 'Sent' },
          { value: 'failed', label: 'Failed' },
        ]}
      />

      {q ? (
        <EmailTable
          view="search"
          items={results.data?.items}
          total={results.data?.total}
          loading={results.isLoading}
          error={results.error}
          onRetry={() => results.refetch()}
          offset={pager.offset}
          hasPrev={pager.hasPrev}
          hasNext={Boolean(results.data?.nextCursor)}
          onPrev={pager.prev}
          onNext={() => pager.next(results.data?.nextCursor ?? null)}
          empty={
            <EmptyState
              title="No matches"
              body="Try a recipient’s domain, a word from the subject, or fewer words."
            />
          }
        />
      ) : (
        <EmptyState
          title="Search your emails"
          body="Find emails by recipient, subject, or message. Press / to search from anywhere."
        />
      )}
    </div>
  );
}
