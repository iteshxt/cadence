import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <LoaderCircle
      aria-label={label}
      role="img"
      strokeWidth={1.5}
      className={cn('size-4 animate-spin', className)}
    />
  );
}
