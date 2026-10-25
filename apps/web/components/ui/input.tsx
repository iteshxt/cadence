import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const control = [
  'w-full rounded-control border border-control bg-surface text-body text-ink placeholder:text-ink-3',
  'transition-colors duration-150 focus-visible:border-signal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
  'disabled:cursor-not-allowed disabled:opacity-50',
  'aria-invalid:border-failed',
].join(' ');

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input ref={ref} className={cn(control, 'h-9 px-3 max-md:h-11', className)} {...props} />
    );
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(control, 'min-h-36 resize-y px-3 py-2 leading-5', className)}
      {...props}
    />
  );
});

/** Input with a trailing unit ("seconds", "emails per hour") in --ink-3 (design.md §7.6). */
export const NumberInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { unit: string }
>(function NumberInput({ className, unit, ...props }, ref) {
  return (
    <div className="relative">
      <input
        ref={ref}
        type="number"
        inputMode="numeric"
        className={cn(control, 'tabular h-9 pr-32 pl-3 max-md:h-11', className)}
        {...props}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-body text-ink-3">
        {unit}
      </span>
    </div>
  );
});
