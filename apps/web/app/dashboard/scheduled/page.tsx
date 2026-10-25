import type { Metadata } from 'next';
import { Suspense } from 'react';
import { EmailView } from '@/components/emails/email-view';

export const metadata: Metadata = { title: 'Scheduled' };

export default function ScheduledPage() {
  return (
    <Suspense>
      <EmailView view="scheduled" />
    </Suspense>
  );
}
