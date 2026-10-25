import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './spinner';

export const buttonVariants = cva(
  [
    'relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-control font-medium',
    'transition-colors duration-150 select-none',
    'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    '[&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-signal text-signal-fg hover:bg-signal-hover active:bg-signal-hover',
        secondary: 'border border-control bg-surface text-ink hover:bg-sunken active:bg-sunken',
        ghost: 'text-ink hover:bg-sunken active:bg-sunken',
        destructive: 'bg-failed text-white hover:opacity-90',
        'ghost-danger': 'text-failed hover:bg-failed-soft',
        link: 'h-auto! px-0! text-signal underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-label',
        md: 'h-9 px-4 text-body',
        lg: 'h-11 px-5 text-body-lg',
        icon: 'size-9 max-md:size-11',
        'icon-sm': 'size-8',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild, loading, disabled, children, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {/* Keep the width while loading: the label stays in layout, invisible. */}
          <span className={cn('inline-flex items-center gap-2', loading && 'invisible')}>
            {children}
          </span>
          {loading && (
            <span className="absolute inset-0 flex items-center justify-center">
              <Spinner />
            </span>
          )}
        </>
      )}
    </Comp>
  );
});
