import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHead } from '@/components/layout/page-head';
import {
  LimitsSection,
  QueueSection,
  SendersSection,
  SlackSection,
} from '@/components/settings/settings-sections';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-[720px]">
      <PageHead
        title="Settings"
        description="Slack alerts, your senders, and the limits the server enforces."
        className="mb-10"
      />
      <Suspense>
        <SlackSection />
      </Suspense>
      <SendersSection />
      <LimitsSection />
      <QueueSection />
    </div>
  );
}
