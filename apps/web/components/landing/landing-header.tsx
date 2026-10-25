'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { publicEnv } from '@/lib/env';
import { Logo } from '../brand/logo';
import { GitHubMark } from '../brand/third-party';
import { Button } from '../ui/button';

const links = [
  { href: '#how', label: 'How it works' },
  { href: '#reliability', label: 'Reliability' },
];

/** Sticky landing header; a hairline appears once the page scrolls (design.md §8.1). */
export function LandingHeader() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'sticky top-0 z-30 border-b transition-colors duration-200',
        scrolled ? 'border-line bg-surface' : 'border-transparent bg-canvas',
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-8 px-6 max-md:px-4">
        <Link href="/" aria-label="Cadence home" className="rounded-control">
          <Logo />
        </Link>
        <nav aria-label="Page" className="flex items-center gap-1 max-md:hidden">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-control px-3 py-2 text-body text-ink-2 transition-colors duration-150 hover:text-ink"
            >
              {l.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" aria-label="Cadence on GitHub">
            <a href={publicEnv.githubUrl} target="_blank" rel="noreferrer noopener">
              <GitHubMark className="size-[18px]" />
            </a>
          </Button>
          <Button asChild variant="secondary" size="sm" className="max-md:h-11">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
