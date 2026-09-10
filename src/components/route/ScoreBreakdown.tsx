import { PLANNER_WEIGHT_LABELS, type ScoreKey } from '../../lib/scoring';
import type { RouteOption } from '@shared/types';
import { cn } from '../../lib/utils';

/**
 * Shows how the planner's score was composed for an option — the transparent
 * "why this ranking" panel operators and judges ask for.
 */
export function ScoreBreakdown({
  option,
  compareTo,
  className,
}: {
  option: RouteOption;
  compareTo?: RouteOption;
  className?: string;
}) {
  const keys: ScoreKey[] = ['time', 'crowd', 'transfer', 'walk'];
  const max = Math.max(
    ...keys.map((key) => option.scoreBreakdown[key]),
    ...(compareTo ? keys.map((key) => compareTo.scoreBreakdown[key]) : [0]),
    1,
  );

  return (
    <div className={cn('space-y-3', className)}>
      {keys.map((key) => {
        const value = option.scoreBreakdown[key];
        const other = compareTo?.scoreBreakdown[key];
        return (
          <div key={key} className="space-y-1.5">
            <div className="flex items-baseline justify-between text-[0.72rem]">
              <span className="text-mist-300">{PLANNER_WEIGHT_LABELS[key]}</span>
              <span className="font-mono text-mist-400">{value.toFixed(1)} pts</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
              <div
                className="h-full rounded-full bg-gradient-to-r from-pulse-500/70 to-pulse-300 transition-[width] duration-700"
                style={{ width: `${(value / max) * 100}%` }}
              />
            </div>
            {other !== undefined ? (
              <p className="text-[0.65rem] text-mist-500">
                Alternative: {other.toFixed(1)} pts
                {other < value ? ' (cheaper)' : other > value ? ' (more expensive)' : ' (equal)'}
              </p>
            ) : null}
          </div>
        );
      })}

      <div className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2">
        <span className="text-[0.72rem] text-mist-300">Weighted total (lower is better)</span>
        <span className="font-mono text-sm text-mist-100">{option.score.toFixed(1)}</span>
      </div>
    </div>
  );
}
