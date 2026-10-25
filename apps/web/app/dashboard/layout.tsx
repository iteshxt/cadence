import { redirect } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { ComposePanel } from '@/components/compose/compose-panel';
import { AppHeader } from '@/components/layout/app-header';
import { getSessionUser } from '@/lib/supabase/server';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // The proxy already redirects signed-out visitors; this is the authoritative check.
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/dashboard');

  return (
    <div className="min-h-dvh bg-canvas">
      <Suspense>
        <AppHeader user={{ name: user.name, email: user.email, avatarUrl: user.avatarUrl }} />
      </Suspense>
      <main className="mx-auto max-w-[1200px] px-6 pt-8 pb-16 max-md:px-4 max-md:pt-6">
        {children}
      </main>
      <Suspense>
        <ComposePanel />
      </Suspense>
    </div>
  );
}
