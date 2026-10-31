import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { prefersReducedMotion } from '@/hooks/motion';
import styles from './sharedForm.module.scss';

export const INVALID_FIELD_HIGHLIGHT_CLASS: string = styles.fieldHighlightActive;

type InvalidFieldFeedback = {
  activeField: string | null;
  highlightInvalidField: (field?: string) => void;
};

/**
 * Scroll to an invalid provider-form field, pulse-highlight it, and focus its control.
 * Fields opt in with a `data-provider-field` attribute on their wrapper.
 */
export function useInvalidFieldFeedback(
  rootRef: RefObject<HTMLElement | null>
): InvalidFieldFeedback {
  const [activeField, setActiveField] = useState<string | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const focusTimerRef = useRef<number | null>(null);
  const highlightedElementRef = useRef<HTMLElement | null>(null);

  const clearHighlight = useCallback(() => {
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }
    if (focusTimerRef.current !== null) {
      window.clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    }
    highlightedElementRef.current?.classList.remove(INVALID_FIELD_HIGHLIGHT_CLASS);
    highlightedElementRef.current = null;
  }, []);

  const highlightInvalidField = useCallback(
    (field?: string) => {
      if (!field) return;
      clearHighlight();
      setActiveField(field);

      const attempt = (retriesLeft: number) => {
        const root = rootRef.current;
        const element = root?.querySelector<HTMLElement>(
          `[data-provider-field="${field}"]`
        );
        if (!element) {
          if (retriesLeft > 0) requestAnimationFrame(() => attempt(retriesLeft - 1));
          return;
        }

        const details =
          element.closest<HTMLDetailsElement>('details') ??
          element.querySelector<HTMLDetailsElement>('details');
        if (details && !details.open) details.open = true;

        element.classList.remove(INVALID_FIELD_HIGHLIGHT_CLASS);
        void element.offsetWidth;
        element.classList.add(INVALID_FIELD_HIGHLIGHT_CLASS);
        highlightedElementRef.current = element;

        element.scrollIntoView({
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          block: 'center',
          inline: 'nearest',
        });

        focusTimerRef.current = window.setTimeout(() => {
          focusTimerRef.current = null;
          const control = element.matches('input, textarea, select')
            ? element
            : element.querySelector<HTMLElement>(
                'input:not([disabled]), textarea:not([disabled]), select:not([disabled])'
              );
          control?.focus({ preventScroll: true });
        }, 80);

        highlightTimerRef.current = window.setTimeout(() => {
          element.classList.remove(INVALID_FIELD_HIGHLIGHT_CLASS);
          highlightedElementRef.current = null;
          highlightTimerRef.current = null;
          setActiveField(null);
        }, 2200);
      };

      requestAnimationFrame(() => attempt(3));
    },
    [clearHighlight, rootRef]
  );

  useEffect(() => () => clearHighlight(), [clearHighlight]);

  return { activeField, highlightInvalidField };
}
