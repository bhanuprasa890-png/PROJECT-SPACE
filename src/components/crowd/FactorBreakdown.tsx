import type { ForecastFactor } from '@shared/types';
import { cn } from '../../lib/utils';

/**
 * "Why this prediction" — the model's per-factor contributions, visualised as
 * signed bars so riders and operators can audit the number.
 */
export function FactorBreakdown({
  factors,
  baselineRatio,
  className,
}: {
  factors: ForecastFactor[];
  baselineRatio?: number;
  className?: string;
}) {
  const maxMagnitude = Math.max(
    0.2,
    ...factors.map((factor) => Math.abs(factor.contribution)),
  );

  return (
    <ul className={cn('space-y-3', className)}>
      {factors.map((factor) => {
        const positive = factor.contribution >= 0;
        const width = Math.min(100, (Math.abs(factor.contribution) / maxMagnitude) * 100);
        return (
          <li key={factor.key} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs font-medium text-mist-200">{factor.label}</span>
              <span
                className={cn(
                  'figure text-2xs',
                  positive ? 'text-crowd-moderate' : 'text-crowd-low',
                )}
              >
                {positive ? '+' : ''}
                {Math.round(factor.contribution * 100)} pts
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
                <div
                  className={cn(
                    'absolute inset-y-0 rounded-full transition-[width] duration-700',
                    positive
                      ? 'left-1/2 bg-gradient-to-r from-crowd-moderate/60 to-crowd-high'
                      : 'right-1/2 bg-gradient-to-l from-crowd-low/60 to-crowd-low',
                  )}
                  style={{ width: `${width / 2}%` }}
                />
                <span className="absolute inset-y-0 left-1/2 w-px bg-white/15" />
              </div>
            </div>
            <p className="text-2xs leading-relaxed text-mist-500">{factor.detail}</p>
          </li>
        );
      })}
      {baselineRatio !== undefined ? (
        <li className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2 text-2xs text-mist-400">
          Learned baseline for this hour:{' '}
          <span className="figure text-mist-200">{Math.round(baselineRatio * 100)}%</span> occupancy
          before live adjustments.
        </li>
      ) : null}
    </ul>
  );
}
