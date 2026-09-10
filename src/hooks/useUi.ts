import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Keeps a loading state on screen for at least `minimumMs` so short queries do
 * not flash past in a demo (used by the "AI analyzing routes…" state).
 */
export function useMinimumLoading(active: boolean, minimumMs = 1600): boolean {
  const [visible, setVisible] = useState(active);
  const startedAt = useRef<number | null>(active ? performance.now() : null);

  useEffect(() => {
    if (active) {
      startedAt.current = performance.now();
      setVisible(true);
      return;
    }

    if (startedAt.current === null) {
      setVisible(false);
      return;
    }

    const elapsed = performance.now() - startedAt.current;
    const remaining = Math.max(0, minimumMs - elapsed);
    const timer = window.setTimeout(() => {
      startedAt.current = null;
      setVisible(false);
    }, remaining);

    return () => window.clearTimeout(timer);
  }, [active, minimumMs]);

  return visible;
}

/** Debounces fast-changing inputs (stop search, sliders). */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    const handler = (event: MediaQueryListEvent): void => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener('change', handler);
    return () => list.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

export const useIsDesktop = (): boolean => useMediaQuery('(min-width: 1024px)');

/** Counts a number up on mount — restrained, one-shot animation. */
export function useCountUp(target: number, durationMs = 650): number {
  const [value, setValue] = useState(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const start = performance.now();
    const from = 0;

    const step = (now: number): void => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      setValue(from + (target - from) * eased);
      if (progress < 1) frame.current = requestAnimationFrame(step);
    };

    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [target, durationMs]);

  return value;
}

/** Interval ticker for "x seconds ago" style freshness labels. */
export function useTicker(intervalMs = 30_000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return tick;
}

export function useLocalStorage<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initial;
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  const set = useMemo(
    () => (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* storage unavailable — keep in-memory value */
      }
    },
    [key],
  );

  return [value, set];
}
