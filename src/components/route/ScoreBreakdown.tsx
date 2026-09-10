import { cn } from '../../lib/utils';
import { ArrowRightLeft, Info } from 'lucide-react';
import type { RouteOption } from '@shared/types';
import { formatScore, SCORE_FORMULA, scoreShares } from '../../lib/scoring';

/**
 * "Why this route?" — the transparent score arithmetic:
 *
 *     travel time + waiting time + crowd penalty = route score
 *
 * Every number comes from the API (which computes it from the timetable and the
 * crowd model); this component only lays the equation out.
 */
export function ScoreBreakdown({
  option,
  compareTo,
  className,
  compact = false,
}: {
  option: RouteOption;
  /** Optional alternative to show the delta against (e.g. the recommended pick). */
  compareTo?: RouteOption | null;
  className?: string;
  compact?: boolean;
}) {
  const shares = scoreShares(option);
  const total = option.scoreBreakdown.totalScore;
  const delta = compareTo ? Number((total - compareTo.scoreBreakdown.totalScore).toFixed(1)) : null;

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="figure text-2xs text-mist-400">{SCORE_FORMULA}</span>
        <span className="figure text-2xs text-mist-600">= route score</span>
      </div>

      {/* stacked bar: one segment per score term */}
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/8">
        {shares.map(({ term, pct }) => (
          <span
            key={term.key}
            className={cn('h-full transition-[width] duration-700 ease-out', term.bar)}
            style={{ width: `${pct}%` }}
            title={`${term.label} — ${formatScore(option.scoreBreakdown[term.key])}`}
          />
        ))}
      </div>

      <ul className={cn('grid gap-2', compact ? 'sm:grid-cols-3' : 'sm:grid-cols-3')}>
        {shares.map(({ term, value, pct }) => (
          <li
            key={term.key}
            className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2"
            title={term.hint}
          >
            <p className="flex items-center gap-1.5 text-3xs tracking-wide text-mist-400 uppercase">
              <span className={cn('size-1.5 rounded-full', term.bar)} />
              {term.label}
            </p>
            <p className="mt-1 figure text-sm text-mist-100">{formatScore(value)}</p>
            <p className="figure text-3xs text-mist-600">{pct}% of score</p>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-pulse-400/25 bg-pulse-400/8 px-3 py-2">
        <span className="text-2xs font-medium text-pulse-100">Overall route score</span>
        <span className="flex items-baseline gap-2">
          {delta !== null && delta !== 0 && (
            <span
              className={cn(
                'inline-flex items-center gap-1 figure text-2xs',
                delta < 0 ? 'text-crowd-low' : 'text-crowd-moderate',
              )}
            >
              <ArrowRightLeft className="size-3" />
              {delta > 0 ? '+' : ''}
              {delta} min vs recommended
            </span>
          )}
          <span className="figure text-base font-semibold text-mist-50">{formatScore(total)}</span>
        </span>
      </div>

      <p className="flex items-start gap-1.5 text-3xs leading-relaxed text-mist-500">
        <Info className="mt-0.5 size-3 shrink-0" />
        Lower is better. Crowd penalty converts predicted crowding into extra minutes, weighted by your
        crowd tolerance, so a comfortable ride can out-score a faster packed one.
      </p>
    </div>
  );
}
