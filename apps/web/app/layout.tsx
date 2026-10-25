import type { Metadata, Viewport } from 'next';
import { Instrument_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import './globals.css';

const instrument = Instrument_Sans({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-instrument-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Cadence', template: '%s · Cadence' },
  description: 'Schedule thousands of emails, send them at a safe pace, and never send one twice.',
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={instrument.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
