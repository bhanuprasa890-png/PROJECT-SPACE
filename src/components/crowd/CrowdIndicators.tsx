import { CROWD_LEVELS, CROWD_LEVEL_META, CROWD_THRESHOLDS } from '@shared/crowd';
import type { CrowdLevel } from '@shared/types';
import { cn, crowdTone, formatPercent } from '../../lib/utils';

/** Green → yellow → orange → red status pill used everywhere crowding appears. */
export function CrowdBadge({
  level,
  label,
  ratio,
  className,
  size = 'sm',
}: {
  level: CrowdLevel;
  label?: string;
  ratio?: number;
  className?: string;
  size?: 'xs' | 'sm';
}) {
  const tone = crowdTone(level);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap',
        size === 'xs' ? 'px-2 py-0.5 text-[0.65rem]' : 'px-2.5 py-1 text-[0.7rem]',
        tone.border,
        tone.bg,
        tone.text,
        className,
      )}
      title={tone.description}
    >
      <span className={cn('size-1.5 rounded-full', tone.dot)} />
      {label ?? tone.label}
      {ratio !== undefined ? (
        <span className="font-mono opacity-80">{formatPercent(ratio)}</span>
      ) : null}
    </span>
  );
}

/**
 * Occupancy meter with threshold ticks at 55 / 80 / 100 % so riders can read
 * the scale, not just the colour.
 */
export function CrowdMeter({
  ratio,
  level,
  className,
  showTicks = true,
  height = 'md',
}: {
  ratio: number;
  level?: CrowdLevel;
  className?: string;
  showTicks?: boolean;
  height?: 'sm' | 'md';
}) {
  const tone = crowdTone(level ?? 'low');
  const clamped = Math.max(0.02, Math.min(ratio, 1.35));
  const width = Math.min(100, (clamped / 1.35) * 100);

  return (
    <div className={cn('relative w-full', className)}>
      <div
        className={cn(
          'relative w-full overflow-hidden rounded-full bg-white/8',
          height === 'sm' ? 'h-1.5' : 'h-2.5',
        )}
      >
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{
            width: `${width}%`,
            background: `linear-gradient(90deg, ${tone.stroke}bb, ${tone.stroke})`,
            boxShadow: `0 0 16px ${tone.stroke}66`,
          }}
        />
        {showTicks
          ? [CROWD_THRESHOLDS.moderate, CROWD_THRESHOLDS.high].map(
              (threshold) => (
                <span
                  key={threshold}
                  className="absolute top-0 h-full w-px bg-ink-950/70"
                  style={{ left: `${(threshold / 1.35) * 100}%` }}
                />
              ),
            )
          : null}
      </div>
    </div>
  );
}

/** Compact "38 / 86 seats" style capacity readout. */
export function CapacityReadout({
  headcount,
  capacity,
  className,
}: {
  headcount: number;
  capacity: number;
  className?: string;
}) {
  return (
    <span className={cn('font-mono text-[0.7rem] text-mist-400', className)}>
      {headcount}
      <span className="text-mist-600">/{capacity}</span> riders
    </span>
  );
}

/** Confidence pill for predictions. */
export function ConfidencePill({ value, className }: { value: number; className?: string }) {
  const pct = Math.round(value * 100);
  const tone = pct >= 85 ? 'text-crowd-low' : pct >= 70 ? 'text-crowd-moderate' : 'text-mist-400';
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[0.7rem]', tone, className)}>
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-40" />
        <span className="relative inline-flex size-2 rounded-full bg-current" />
      </span>
      {pct}% confidence
    </span>
  );
}

/** Legend for the crowd scale — used on dashboards and legends. */
export function CrowdLegend({ className }: { className?: string }) {
  // Same three bands the planner and the alerts use.
  const levels: { level: CrowdLevel; range: string }[] = CROWD_LEVELS.map((level) => ({
    level,
    range: CROWD_LEVEL_META[level].range,
  }));

  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2', className)}>
      {levels.map(({ level, range }) => {
        const tone = crowdTone(level);
        return (
          <span key={level} className="inline-flex items-center gap-2 text-[0.68rem] text-mist-400">
            <span className={cn('size-2 rounded-full', tone.dot)} />
            <span className={cn('font-medium', tone.text)}>{tone.label}</span>
            <span className="font-mono text-mist-500">{range}</span>
          </span>
        );
      })}
    </div>
  );
}
