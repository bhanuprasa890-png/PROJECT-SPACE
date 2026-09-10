import { useEffect, useState } from 'react';
import { BrainCircuit, CheckCircle2 } from 'lucide-react';
import { cn } from '../../lib/utils';

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

  return (
    <div className={cn('space-y-4', className)}>
      <div className="glass relative overflow-hidden rounded-2xl px-5 py-5">
        <span className="pointer-events-none absolute -inset-24 animate-shimmer bg-[radial-gradient(circle_at_20%_20%,rgba(56,245,192,0.16),transparent_60%)]" />
        <div className="relative flex items-start gap-4">
          <span className="relative grid size-11 shrink-0 place-items-center rounded-xl border border-pulse-400/35 bg-pulse-400/12">
            <BrainCircuit className="size-5 text-pulse-200" />
            <span className="absolute -inset-px animate-pulse-ring rounded-xl border border-pulse-400/40" />
          </span>

          <div className="min-w-0 flex-1 space-y-2">
            <p className="font-display text-base font-semibold text-mist-50">AI analyzing routes…</p>
            <p className="font-mono text-[0.7rem] text-mist-400">
              {from && to ? `${from} → ${to}` : 'Finding the best options for you'}
            </p>

            <ul className="mt-3 space-y-1.5">
              {STEPS.map((label, index) => {
                const done = index < step;
                const active = index === step;
                return (
                  <li
                    key={label}
                    className={cn(
                      'flex items-center gap-2 font-mono text-[0.7rem] transition-colors duration-300',
                      active ? 'text-pulse-100' : done ? 'text-mist-400' : 'text-mist-600',
                    )}
                  >
                    {done ? (
                      <CheckCircle2 className="size-3.5 text-crowd-low" />
                    ) : (
                      <span
                        className={cn(
                          'size-1.5 rounded-full',
                          active ? 'animate-ping-slow bg-pulse-300' : 'bg-mist-700',
                        )}
                      />
                    )}
                    {label}
                  </li>
                );
              })}
            </ul>

            <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/8">
              <span
                className="block h-full rounded-full bg-gradient-to-r from-pulse-400/70 to-sky-400/70 transition-[width] duration-500 ease-out"
                style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Placeholder cards keep the layout shift invisible when results land. */}
      <div className="space-y-3">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="glass animate-pulse-soft space-y-3 rounded-2xl p-4"
            style={{ animationDelay: `${index * 120}ms` }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="h-6 w-14 rounded-lg bg-white/8" />
                <span className="h-5 w-28 rounded-lg bg-white/6" />
              </div>
              <span className="h-7 w-16 rounded-lg bg-white/8" />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[0, 1, 2, 3].map((cell) => (
                <span key={cell} className="h-12 rounded-xl bg-white/5" />
              ))}
            </div>
            <span className="block h-2 w-full rounded-full bg-white/6" />
          </div>
        ))}
      </div>
    </div>
  );
}
