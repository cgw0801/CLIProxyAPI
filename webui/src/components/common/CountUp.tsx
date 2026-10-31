import { useEffect, useRef, useState } from 'react';

interface CountUpProps {
  value: number;
  duration?: number;
  decimals?: number;
  format?: (value: number) => string;
  continuous?: boolean;
  className?: string;
}

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

export function CountUp({
  value,
  duration = 900,
  decimals = 0,
  format,
  continuous = false,
  className,
}: CountUpProps) {
  const formatRef = useRef(format);
  const lastValueRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const [display, setDisplay] = useState(() => (format ? format(value) : value.toFixed(decimals)));

  useEffect(() => {
    formatRef.current = format;
  }, [format]);

  useEffect(() => {
    const formatValue = (next: number) =>
      formatRef.current ? formatRef.current(next) : next.toFixed(decimals);

    if (
      duration <= 0 ||
      (typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
    ) {
      lastValueRef.current = value;
      setDisplay(formatValue(value));
      return;
    }

    const from = continuous ? lastValueRef.current : 0;
    const startedAt = performance.now();

    const tick = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const current = from + (value - from) * easeOutCubic(progress);
      lastValueRef.current = current;
      setDisplay(formatValue(current));
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        lastValueRef.current = value;
        setDisplay(formatValue(value));
        frameRef.current = null;
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [value, duration, decimals, continuous]);

  return <span className={className}>{display}</span>;
}
