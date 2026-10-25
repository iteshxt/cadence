import type { Metadata } from 'next';
import { Suspense } from 'react';
import { EmailView } from '@/components/emails/email-view';

export const metadata: Metadata = { title: 'Sent' };

export default function SentPage() {
  return (
    <Suspense>
      <EmailView view="sent" />
    </Suspense>
  );
}
