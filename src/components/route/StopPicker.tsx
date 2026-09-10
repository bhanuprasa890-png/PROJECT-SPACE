import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, MapPin, Search, TrainFront } from 'lucide-react';

import { useNetwork } from '../../hooks/useTransitData';
import { useDebouncedValue } from '../../hooks/useUi';
import { cn, formatNumber } from '../../lib/utils';

/**
 * Stop selector backed by `/api/stops`. Keyboard navigable, works as a
 * combobox on desktop and as a full-width list on mobile.
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
  const debounced = useDebouncedValue(query, 180);

  const selected = useMemo(
    () => data?.stops.find((stop) => stop.id === value),
    [data?.stops, value],
  );

  const results = useMemo(() => {
    const stops = data?.stops ?? [];
    if (!debounced.trim()) {
      return stops.slice(0, 8);
    }
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

  return (
    <div className="relative" ref={containerRef}>
      <span className="mb-1.5 block text-[0.68rem] font-medium tracking-wider text-mist-400 uppercase">
        {label}
      </span>

      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition',
          open ? 'border-pulse-400/60 bg-ink-900' : 'border-white/10 bg-ink-900/70 hover:border-white/18',
        )}
      >
        <MapPin className="size-4 shrink-0 text-pulse-300" />
        <span className="min-w-0 flex-1">
          {selected ? (
            <>
              <span className="block truncate text-sm text-mist-100">{selected.name}</span>
              <span className="block text-[0.68rem] text-mist-500">
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
        <div className="absolute z-40 mt-2 w-full overflow-hidden rounded-xl border border-white/12 bg-ink-900/97 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2">
            <Search className="size-3.5 text-mist-500" />
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
                  setHighlight((index) => Math.min(index + 1, results.length - 1));
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setHighlight((index) => Math.max(index - 1, 0));
                } else if (event.key === 'Enter' && results[highlight]) {
                  onChange(results[highlight].id);
                  setOpen(false);
                  setQuery('');
                } else if (event.key === 'Escape') {
                  setOpen(false);
                }
              }}
              placeholder={`${placeholder} — name or code`}
              className="w-full bg-transparent text-sm text-mist-100 placeholder:text-mist-500 focus:outline-none"
            />
          </div>

          <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
            {results.map((stop, index) => (
              <li key={stop.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={stop.id === value}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => {
                    onChange(stop.id);
                    setOpen(false);
                    setQuery('');
                  }}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors',
                    index === highlight ? 'bg-white/8' : 'hover:bg-white/5',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={cn(
                        'grid size-7 shrink-0 place-items-center rounded-lg border text-[0.65rem] font-mono',
                        stop.isInterchange
                          ? 'border-pulse-400/30 bg-pulse-400/10 text-pulse-300'
                          : 'border-white/10 bg-white/5 text-mist-400',
                      )}
                    >
                      {stop.code.slice(0, 3)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-mist-100">{stop.name}</span>
                      <span className="block text-[0.65rem] text-mist-500">
                        {stop.zone ?? 'Zone —'} · {formatNumber(stop.dailyBoardings)} daily boardings
                      </span>
                    </span>
                  </span>
                  {stop.isInterchange ? <TrainFront className="size-3.5 text-mist-500" /> : null}
                </button>
              </li>
            ))}
            {!results.length ? (
              <li className="px-3 py-4 text-center text-xs text-mist-500">No stops match that search.</li>
            ) : null}
          </ul>

          {quickPicks?.length ? (
            <div className="border-t border-white/8 px-3 py-2">
              <p className="mb-1.5 text-[0.62rem] tracking-wider text-mist-500 uppercase">
                Frequent
              </p>
              <div className="flex flex-wrap gap-1.5">
                {quickPicks.slice(0, 5).map((stop) => (
                  <button
                    key={stop.id}
                    type="button"
                    onClick={() => {
                      onChange(stop.id);
                      setOpen(false);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[0.68rem] text-mist-300 transition hover:border-pulse-400/40 hover:text-mist-100"
                  >
                    <CornerDownLeft className="size-3" />
                    {stop.name}
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
