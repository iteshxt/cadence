'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { publicEnv } from '@/lib/env';
import { Logo } from '../brand/logo';
import { GitHubMark } from '../brand/third-party';
import { Button } from '../ui/button';

const links = [
  { id: 'how', label: 'How it works' },
  { id: 'reliability', label: 'Reliability' },
];
const LINK_IDS = links.map((l) => l.id);

/** Which section is in the middle of the viewport, for the nav highlight. */
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => !!el);
    els.forEach((el) => io.observe(el));
    const top = () => window.scrollY < window.innerHeight * 0.5 && setActive(null);
    window.addEventListener('scroll', top, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener('scroll', top);
    };
  }, [ids]);
  return active;
}

/**
 * Fixed landing header. At the top it is a full-width bar on the hero; once the page scrolls it
 * contracts into a floating pill (design.md §8.1).
 */
export function LandingHeader() {
  const [scrolled, setScrolled] = useState(false);
  const active = useActiveSection(LINK_IDS);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-40 px-3">
      <div
        className={cn(
          'pointer-events-auto mx-auto flex items-center gap-6',
          'motion-safe:transition-[max-width,height,margin,padding,border-radius,background-color,box-shadow] motion-safe:duration-500 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]',
          scrolled
            ? 'mt-3 h-14 max-w-[820px] rounded-[28px] bg-surface/90 pr-2 pl-5 shadow-float backdrop-blur-md max-md:pl-4'
            : 'mt-0 h-16 max-w-[1200px] rounded-none bg-transparent px-3 shadow-none max-md:px-1',
        )}
      >
        <Link href="/" aria-label="Cadence home" className="shrink-0 rounded-control">
          <Logo />
        </Link>
        <nav aria-label="Page" className="flex items-center gap-1 max-md:hidden">
          {links.map((l) => (
            <a
              key={l.id}
              href={`#${l.id}`}
              aria-current={active === l.id ? 'true' : undefined}
              className={cn(
                'rounded-full px-3 py-1.5 text-body transition-colors duration-200',
                active === l.id ? 'bg-sunken text-ink' : 'text-ink-2 hover:text-ink',
              )}
            >
              {l.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            asChild
            variant="ghost"
            size="icon"
            aria-label="Cadence on GitHub"
            className="rounded-full"
          >
            <a href={publicEnv.githubUrl} target="_blank" rel="noreferrer noopener">
              <GitHubMark className="size-[18px]" />
            </a>
          </Button>
          <Button
            asChild
            variant="secondary"
            size="sm"
            className={cn('transition-[border-radius] duration-500', scrolled && 'rounded-full')}
          >
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
