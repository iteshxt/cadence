'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from 'radix-ui';
import { useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { ApiError } from '@/lib/api';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 2_000,
            // Client errors won't fix themselves; retry only network and server failures.
            retry: (count, err) =>
              count < 2 && !(err instanceof ApiError && err.status >= 400 && err.status < 500),
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <Tooltip.Provider delayDuration={300} skipDelayDuration={150}>
        {children}
      </Tooltip.Provider>
      <Toaster
        position="bottom-right"
        duration={4000}
        toastOptions={{
          classNames: {
            toast:
              'bg-surface! text-ink! shadow-float! rounded-panel! border-0! font-sans! text-body! gap-3! px-4! py-3!',
            description: 'text-ink-2!',
            icon: 'text-ink!',
          },
        }}
      />
    </QueryClientProvider>
  );
}
