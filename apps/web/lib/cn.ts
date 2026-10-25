import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge must know the custom type scale (globals.css `--text-*`); otherwise it reads
 * `text-label` or `text-body-lg` as a text color and drops the real color class next to it.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: ['display', 'title', 'section', 'body-lg', 'body', 'label', 'caption', 'readout'],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
