import Link from 'next/link';
import { Mark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-[400px]">
        <Mark className="size-6" />
        <h1 className="mt-6 text-title text-ink">This page doesn’t exist</h1>
        <p className="mt-1 text-body text-ink-2">The link may be old, or the address has a typo.</p>
        <Button asChild className="mt-6">
          <Link href="/dashboard">Go to the dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
