'use client';

import { DropdownMenu } from 'radix-ui';
import { LogOut, Plus, Search, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useStats } from '@/hooks/queries';
import { cn } from '@/lib/cn';
import { publicEnv } from '@/lib/env';
import { fmtNumber } from '@/lib/format';
import { getSupabase } from '@/lib/supabase/client';
import { Logo } from '../brand/logo';
import { Button } from '../ui/button';
import { ExternalLink } from '../ui/misc';

export interface HeaderUser {
  name: string | null;
  email: string;
  avatarUrl: string | null;
}

function useOpenCompose() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return () => {
    const next = new URLSearchParams(params.toString());
    next.set('compose', '1');
    router.push(`${pathname}?${next}`, { scroll: false });
  };
}

function NavLinks({ className }: { className?: string }) {
  const pathname = usePathname();
  const stats = useStats();
  const pending = stats.data
    ? stats.data.scheduled + stats.data.deferred + stats.data.sending
    : undefined;
  const links = [
    { href: '/dashboard/scheduled', label: 'Scheduled', count: pending },
    { href: '/dashboard/sent', label: 'Sent', count: stats.data?.sentTotal },
    { href: '/dashboard/settings', label: 'Settings', count: undefined },
  ];
  return (
    <nav aria-label="Dashboard" className={cn('flex h-full items-stretch gap-1', className)}>
      {links.map((l) => {
        const active = pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex items-center gap-1.5 px-3 text-body transition-colors duration-150',
              active ? 'text-ink' : 'text-ink-2 hover:text-ink',
            )}
          >
            {l.label}
            {l.count !== undefined && (
              <span className="text-caption tabular text-ink-3">{fmtNumber(l.count)}</span>
            )}
            <span
              aria-hidden
              className={cn(
                'absolute inset-x-3 bottom-0 h-0.5 bg-signal transition-opacity duration-200',
                active ? 'opacity-100' : 'opacity-0',
              )}
            />
          </Link>
        );
      })}
    </nav>
  );
}

function SearchField() {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();
  const ref = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState(
    pathname.startsWith('/dashboard/search') ? (params.get('q') ?? '') : '',
  );

  // "/" or ⌘K / Ctrl+K focuses search (design.md §7.4).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
      if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (term) router.push(`/dashboard/search?q=${encodeURIComponent(term)}`);
  };

  return (
    <form role="search" onSubmit={submit} className="relative w-60 max-lg:w-48">
      <Search
        aria-hidden
        strokeWidth={1.5}
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3"
      />
      <input
        ref={ref}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search emails"
        aria-label="Search emails"
        className="h-9 w-full rounded-control border border-control bg-surface pr-8 pl-8 text-body text-ink placeholder:text-ink-3 focus-visible:border-signal"
      />
      <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded-[4px] border border-line px-1.5 text-caption text-ink-3">
        /
      </kbd>
    </form>
  );
}

function Avatar({ user, className }: { user: HeaderUser; className?: string }) {
  const [broken, setBroken] = useState(false);
  const initials = (user.name ?? user.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  if (user.avatarUrl && !broken) {
    return (
      <img
        src={user.avatarUrl}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className={cn('size-7 rounded-full object-cover', className)}
      />
    );
  }
  return (
    <span
      className={cn(
        'flex size-7 items-center justify-center rounded-full bg-signal-soft text-caption font-semibold text-signal',
        className,
      )}
    >
      {initials}
    </span>
  );
}

function UserMenu({ user }: { user: HeaderUser }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const logOut = async () => {
    setSigningOut(true);
    await getSupabase().auth.signOut();
    router.replace('/');
    router.refresh();
  };
  const itemCls =
    'flex h-9 cursor-pointer items-center gap-2 rounded-control px-2 text-body text-ink outline-none data-[highlighted]:bg-sunken [&_svg]:size-4 [&_svg]:text-ink-2';
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`Account menu for ${user.name ?? user.email}`}
          className="flex size-9 items-center justify-center rounded-full max-md:size-11"
        >
          <Avatar user={user} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-64 rounded-panel bg-surface p-1 shadow-float data-[state=open]:animate-pop-in"
        >
          <div className="flex items-center gap-3 px-2 py-2">
            <Avatar user={user} className="size-8" />
            <div className="min-w-0">
              {user.name && (
                <p className="truncate text-label font-semibold text-ink">{user.name}</p>
              )}
              <p className="truncate text-caption text-ink-2">{user.email}</p>
            </div>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item asChild className={itemCls}>
            <Link href="/dashboard/settings">
              <Settings strokeWidth={1.5} aria-hidden /> Settings
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild className={itemCls}>
            <ExternalLink
              href={`${publicEnv.apiUrl}/admin/queues`}
              className="text-ink no-underline! hover:no-underline"
            >
              Queue dashboard
            </ExternalLink>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item
            className={itemCls}
            onSelect={(e) => (e.preventDefault(), void logOut())}
            disabled={signingOut}
          >
            <LogOut strokeWidth={1.5} aria-hidden /> {signingOut ? 'Logging out…' : 'Log out'}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** One 56 px header: lockup, nav with counts, search, Compose, avatar (design.md §7.4). */
export function AppHeader({ user }: { user: HeaderUser }) {
  const openCompose = useOpenCompose();
  const router = useRouter();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-6 px-6 max-md:gap-2 max-md:px-4">
        <Link
          href="/dashboard/scheduled"
          aria-label="Cadence dashboard"
          className="rounded-control"
        >
          <Logo />
        </Link>
        <NavLinks className="max-md:hidden" />
        <div className="ml-auto flex items-center gap-3 max-md:gap-1">
          <div className="max-md:hidden">
            <SearchField />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Search emails"
            onClick={() => router.push('/dashboard/search')}
          >
            <Search strokeWidth={1.5} />
          </Button>
          <Button variant="primary" onClick={openCompose} className="max-md:hidden">
            <Plus strokeWidth={1.5} aria-hidden /> Compose
          </Button>
          <Button
            variant="primary"
            size="icon"
            className="md:hidden"
            aria-label="Compose"
            onClick={openCompose}
          >
            <Plus strokeWidth={1.5} />
          </Button>
          <UserMenu user={user} />
        </div>
      </div>
      <div className="h-11 border-t border-line md:hidden">
        <NavLinks className="px-1" />
      </div>
    </header>
  );
}
