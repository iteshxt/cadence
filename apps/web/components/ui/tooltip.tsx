'use client';

import { Tooltip as T } from 'radix-ui';
import type { ReactNode } from 'react';

/** --ink background, --canvas text, caption size, 6 px radius, 300 ms delay (design.md §7.7). */
export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  if (!content) return <>{children}</>;
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-50 max-w-80 rounded-control bg-ink px-2 py-1 text-caption text-canvas data-[state=delayed-open]:animate-pop-in"
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
