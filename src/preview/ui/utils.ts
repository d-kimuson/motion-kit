import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Joins class names, letting a later Tailwind utility override a conflicting earlier one. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
