import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHead } from '@/components/layout/page-head';
import {
  DefaultsSection,
  LimitsSection,
  SendersSection,
  SlackSection,
} from '@/components/settings/settings-sections';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-[720px]">
      <PageHead
        title="Settings"
        description="Your Gmail senders, Compose defaults, and Slack alerts."
        className="mb-10"
      />
      <Suspense>
        <SendersSection />
      </Suspense>
      <DefaultsSection />
      <Suspense>
        <SlackSection />
      </Suspense>
      <LimitsSection />
    </div>
  );
}
