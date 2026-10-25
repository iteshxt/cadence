import type { Metadata } from 'next';
import { Suspense } from 'react';
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
      <h1 className="mb-8 text-title text-ink">Settings</h1>
      <Suspense>
        <SlackSection />
      </Suspense>
      <SendersSection />
      <LimitsSection />
      <QueueSection />
    </div>
  );
}
