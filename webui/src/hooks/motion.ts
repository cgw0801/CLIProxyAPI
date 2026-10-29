import { useRef } from 'react';

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Reveal animations are intentionally disabled for the minimal interface. */
export function useRevealOnScroll<T extends HTMLElement>(_delaySeconds = 0) {
  return useRef<T | null>(null);
}

/** Reveal animations are intentionally disabled for the minimal interface. */
export function useRevealGroup<T extends HTMLElement>(_baseDelaySeconds = 0) {
  return useRef<T | null>(null);
}
