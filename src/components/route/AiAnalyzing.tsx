import { useEffect, useState } from 'react';
import { BrainCircuit, CheckCircle2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { RouteCardSkeleton } from '../ui/Skeleton';

/**
 * "AI analyzing routes…" state.
 *
 * Shown while the planner query runs. The steps mirror what the API actually
 * does (timetable lookup → crowd prediction → scoring), so the wait is honest
 * rather than decorative, and the minimum display time keeps it readable in a
 * fast demo.
 */
const STEPS = [
  'Reading live occupancy from Postgres',
  'Matching departures in the timetable',
  'Predicting crowd level for every leg',
  'Applying travel + waiting + crowd penalty',
  'Ranking options for your comfort',
] as const;

export function AiAnalyzing({
  from,
  to,
  className,
}: {
  from?: string;
  to?: string;
  className?: string;
}) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStep((current) => (current + 1) % STEPS.length);
    }, 620);
    return () => window.clearInterval(timer);
  }, []);

  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <div className={cn('space-y-4', className)} role="status" aria-live="polite">
      <div className="glass-strong relative overflow-hidden rounded-2xl px-5 py-5">
        {/* sweeping scan line — the only motion, and it reads as "working" */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px animate-sweep bg-gradient-to-r from-transparent via-pulse-300/70 to-transparent"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-24 animate-shimmer bg-[radial-gradient(circle_at_18%_20%,rgba(56,245,192,0.14),transparent_62%)]"
        />

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start">
          <span className="relative grid size-11 shrink-0 place-items-center rounded-xl border border-pulse-400/35 bg-pulse-400/12">
            <BrainCircuit className="size-5 text-pulse-200" aria-hidden />
            <span className="absolute -inset-px animate-pulse-ring rounded-xl border border-pulse-400/40" aria-hidden />
          </span>

          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="font-display text-base font-semibold text-mist-50">AI analyzing routes…</p>
              <p className="figure text-3xs text-mist-500">
                {from && to ? `${from} → ${to}` : 'Finding the best options for you'}
              </p>
            </div>

            <ul className="grid gap-1.5 sm:grid-cols-2">
              {STEPS.map((label, index) => {
                const done = index < step;
                const active = index === step;
                return (
                  <li
                    key={label}
                    className={cn(
                      'flex items-center gap-2 text-2xs transition-colors duration-300',
                      active ? 'text-pulse-100' : done ? 'text-mist-400' : 'text-mist-600',
                    )}
                  >
                    {done ? (
                      <CheckCircle2 className="size-3.5 shrink-0 text-crowd-low" aria-hidden />
                    ) : (
                      <span
                        className={cn(
                          'size-1.5 shrink-0 rounded-full',
                          active ? 'animate-ping-slow bg-pulse-300' : 'bg-mist-700',
                        )}
                        aria-hidden
                      />
                    )}
                    <span className="truncate">{label}</span>
                  </li>
                );
              })}
            </ul>

            <div className="h-1 w-full overflow-hidden rounded-full bg-white/8">
              <span
                className="block h-full rounded-full bg-gradient-to-r from-pulse-400/70 to-sky-glow/70 transition-[width] duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="figure text-3xs text-mist-500">
              step {Math.min(step + 1, STEPS.length)}/{STEPS.length} · {Math.round(progress)}%
            </p>
          </div>
        </div>
      </div>

      {/* Placeholders keep the layout shift invisible when results land. */}
      <div className="space-y-3">
        {[0, 1, 2].map((index) => (
          <RouteCardSkeleton key={index} className="animate-pulse-soft" />
        ))}
      </div>
    </div>
  );
}
