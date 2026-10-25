'use client';

import { useCallback, useState } from 'react';

/**
 * Forward-only API cursors plus a client-side stack of visited cursors, so Previous works
 * without backward cursors (tech-spec §5).
 */
export function usePager(pageSize: number) {
  const [stack, setStack] = useState<(string | null)[]>([null]);
  const cursor = stack.at(-1) ?? null;
  const page = stack.length - 1;
  return {
    cursor,
    offset: page * pageSize + 1,
    hasPrev: page > 0,
    next: useCallback((nextCursor: string | null) => {
      if (nextCursor) setStack((s) => [...s, nextCursor]);
    }, []),
    prev: useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []),
    reset: useCallback(() => setStack([null]), []),
  };
}
