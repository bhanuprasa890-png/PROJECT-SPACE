import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, MapPin, Search, TrainFront } from 'lucide-react';

import { useNetwork } from '../../hooks/useTransitData';
import { useDebouncedValue } from '../../hooks/useUi';
import { cn, formatNumber } from '../../lib/utils';

/**
 * Stop selector backed by `/api/stops`.
 *
 * A combobox: the trigger is a real button (so it is keyboard reachable), the
 * panel lists 8 matches, arrow keys move the highlight, Enter selects and Escape
 * closes. On mobile the panel opens full width with 44px rows.
 */
export function StopPicker({
  label,
  value,
  onChange,
  placeholder = 'Search stops',
  quickPicks,
}: {
  label: string;
  value: string;
  onChange: (stopId: string) => void;
  placeholder?: string;
  /** Minimal shape so callers can pass stops or saved-endpoint snippets. */
  quickPicks?: { id: string; name: string }[];
}) {
  const { data } = useNetwork();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const debounced = useDebouncedValue(query, 180);

  const selected = useMemo(() => data?.stops.find((stop) => stop.id === value), [data?.stops, value]);

  const results = useMemo(() => {
    const stops = data?.stops ?? [];
    if (!debounced.trim()) return stops.slice(0, 8);
    const needle = debounced.trim().toLowerCase();
    return stops
      .filter(
        (stop) =>
          stop.name.toLowerCase().includes(needle) ||
          stop.code.toLowerCase().includes(needle) ||
          (stop.zone ?? '').toLowerCase().includes(needle),
      )
      .slice(0, 8);
  }, [data?.stops, debounced]);

  useEffect(() => {
    const handler = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Keep the highlighted row in view while arrowing through the list.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.children[highlight] as HTMLElement | undefined;
    node?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const commit = (stopId: string): void => {
    onChange(stopId);
    setOpen(false);
    setQuery('');
    setHighlight(0);
  };

  return (
    <div className="relative min-w-0" ref={containerRef}>
      <span className="eyebrow mb-1.5 block text-mist-400">{label}</span>

      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${selected ? selected.name : placeholder}`}
        className={cn(
          'group flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors duration-200',
          open
            ? 'border-pulse-400/50 bg-ink-900'
            : 'border-white/10 bg-ink-900/70 hover:border-white/20 hover:bg-ink-900',
        )}
      >
        <MapPin
          className={cn('size-4 shrink-0 transition-colors', open ? 'text-pulse-200' : 'text-pulse-300/80')}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          {selected ? (
            <>
              <span className="block truncate text-sm text-mist-100">{selected.name}</span>
              <span className="block truncate text-3xs text-mist-500">
                {selected.code}
                {selected.zone ? ` · ${selected.zone}` : ''}
                {selected.isInterchange ? ' · interchange' : ''}
              </span>
            </>
          ) : (
            <span className="text-sm text-mist-500">{placeholder}</span>
          )}
        </span>
      </button>

      {open ? (
        <div className="glass-strong absolute z-40 mt-2 w-full overflow-hidden rounded-xl shadow-2xl">
          <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2">
            <Search className="size-3.5 shrink-0 text-mist-500" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlight(0);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setHighlight((index) => Math.min(index + 1, Math.max(results.length - 1, 0)));
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setHighlight((index) => Math.max(index - 1, 0));
                } else if (event.key === 'Enter' && results[highlight]) {
                  event.preventDefault();
                  commit(results[highlight].id);
                } else if (event.key === 'Escape') {
                  setOpen(false);
                }
              }}
              placeholder={`${placeholder} — name or code`}
              aria-label={`Search stops for ${label}`}
              className="w-full bg-transparent text-sm text-mist-100 placeholder:text-mist-500 focus:outline-none"
            />
          </div>

          <ul role="listbox" ref={listRef} className="max-h-64 overflow-y-auto py-1">
            {results.map((stop, index) => (
              <li key={stop.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={stop.id === value}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => commit(stop.id)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors',
                    index === highlight ? 'bg-white/8' : 'hover:bg-white/5',
                    stop.id === value && 'bg-pulse-400/8',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={cn(
                        'figure grid size-7 shrink-0 place-items-center rounded-lg border text-2xs',
                        stop.isInterchange
                          ? 'border-pulse-400/30 bg-pulse-400/10 text-pulse-300'
                          : 'border-white/10 bg-white/5 text-mist-400',
                      )}
                    >
                      {stop.code.slice(0, 3)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-mist-100">{stop.name}</span>
                      <span className="block truncate text-3xs text-mist-500">
                        {stop.zone ?? 'Zone —'} · {formatNumber(stop.dailyBoardings)} daily boardings
                      </span>
                    </span>
                  </span>
                  {stop.isInterchange ? (
                    <TrainFront className="size-3.5 shrink-0 text-mist-500" aria-hidden />
                  ) : null}
                </button>
              </li>
            ))}
            {!results.length ? (
              <li className="px-3 py-5 text-center text-xs text-mist-500">
                No stops match “{debounced}”.
              </li>
            ) : null}
          </ul>

          {quickPicks?.length ? (
            <div className="border-t border-white/8 px-3 py-2.5">
              <p className="eyebrow mb-2 text-mist-500">Frequent</p>
              <div className="flex flex-wrap gap-1.5">
                {quickPicks.slice(0, 5).map((stop) => (
                  <button
                    key={stop.id}
                    type="button"
                    onClick={() => commit(stop.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-2xs text-mist-300 transition-colors hover:border-pulse-400/40 hover:text-mist-100"
                  >
                    <CornerDownLeft className="size-3" aria-hidden />
                    <span className="truncate">{stop.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
