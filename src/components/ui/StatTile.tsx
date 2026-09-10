import { ArrowDownRight, ArrowRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { cn, crowdTone, formatNumber } from '../../lib/utils';
import { Sparkline } from './Sparkline';
import { Card } from './Card';
import { useCountUp } from '../../hooks/useUi';

export interface StatTileProps {
  label: string;
  value: number | string;
  unit?: string;
  hint?: string;
  deltaPct?: number;
  comparisonLabel?: string;
  series?: number[];
  tone?: 'positive' | 'negative' | 'neutral';
  icon?: LucideIcon;
  accent?: 'none' | 'pulse' | 'sky' | 'warning' | 'critical' | 'low' | 'moderate' | 'high';
  animated?: boolean;
  className?: string;
}

const TONE_STROKE: Record<string, string> = {
  positive: '#34d399',
  negative: '#f43f5e',
  neutral: '#38f5c0',
};

export function StatTile({
  label,
  value,
  unit,
  hint,
  deltaPct,
  comparisonLabel,
  series,
  tone = 'neutral',
  icon: Icon,
  accent = 'pulse',
  animated = false,
  className,
}: StatTileProps) {
  const numeric = typeof value === 'number' ? value : Number.NaN;
  const animatedValue = useCountUp(Number.isFinite(numeric) && animated ? numeric : 0, 700);
  const display = Number.isFinite(numeric)
    ? Number.isInteger(numeric)
      ? formatNumber(animated ? animatedValue : numeric)
      : (animated ? animatedValue : numeric).toFixed(1)
    : String(value);

  const Delta = deltaPct === undefined ? ArrowRight : deltaPct > 0.05 ? ArrowUpRight : deltaPct < -0.05 ? ArrowDownRight : ArrowRight;
  const deltaTone = crowdTone(tone === 'positive' ? 'low' : tone === 'negative' ? 'high' : 'moderate');

  return (
    <Card accent={accent === 'pulse' ? 'pulse' : accent === 'sky' ? 'sky' : accent === 'warning' ? 'warning' : accent === 'critical' ? 'critical' : 'none'} className={cn('p-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.68rem] font-medium tracking-wider text-mist-400 uppercase">{label}</p>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="font-display text-2xl leading-none font-semibold text-mist-100">
              {display}
            </span>
            {unit ? <span className="text-xs text-mist-400">{unit}</span> : null}
          </div>
        </div>
        {Icon ? (
          <span
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-lg border',
              tone === 'positive'
                ? 'border-crowd-low/30 bg-crowd-low/10 text-crowd-low'
                : tone === 'negative'
                  ? 'border-crowd-critical/30 bg-crowd-critical/10 text-crowd-critical'
                  : 'border-white/10 bg-white/5 text-pulse-300',
            )}
          >
            <Icon className="size-4" />
          </span>
        ) : null}
      </div>

      {deltaPct !== undefined ? (
        <div className="mt-3 flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.68rem] font-medium',
              deltaTone.bg,
              deltaTone.text,
            )}
          >
            <Delta className="size-3" />
            {deltaPct > 0 ? '+' : ''}
            {deltaPct.toFixed(1)}%
          </span>
          {comparisonLabel ? (
            <span className="text-[0.68rem] text-mist-500">{comparisonLabel}</span>
          ) : null}
        </div>
      ) : null}

      {series && series.length > 1 ? (
        <div className="mt-2 -mx-1">
          <Sparkline data={series} color={TONE_STROKE[tone]} height={30} />
        </div>
      ) : null}

      {hint ? <p className="mt-2 line-clamp-2 text-[0.7rem] leading-relaxed text-mist-400">{hint}</p> : null}
    </Card>
  );
}
