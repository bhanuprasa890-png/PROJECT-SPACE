import { Link } from 'react-router-dom';
import { ArrowUpRight, Radio } from 'lucide-react';
import type { CrowdHotspot } from '@shared/types';
import { CrowdBadge, CrowdMeter } from './CrowdIndicators';
import { cn, formatTimeAgo } from '../../lib/utils';

/**
 * Live network pressure, worst first. Links straight into the forecast for the
 * affected line/stop so users can go from "it's busy" to "when is it quieter".
 */
export function CrowdHotspotList({
  hotspots,
  className,
  compact = false,
}: {
  hotspots: CrowdHotspot[];
  className?: string;
  compact?: boolean;
}) {
  if (!hotspots.length) {
    return <p className="text-xs text-mist-500">No live telemetry received yet.</p>;
  }

  return (
    <ul className={cn('space-y-2.5', className)}>
      {hotspots.map((hotspot) => (
        <li key={`${hotspot.lineId}-${hotspot.stopId}`}>
          <Link
            to={`/routes/details?lineId=${hotspot.lineId}&stopId=${hotspot.stopId}`}
            className={cn(
              'group block rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-3 transition-all duration-200',
              'hover:border-white/16 hover:bg-white/[0.05]',
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className="grid size-7 shrink-0 place-items-center rounded-lg text-[0.68rem] font-bold text-ink-950"
                  style={{ backgroundColor: hotspot.lineColor }}
                >
                  {hotspot.lineCode.slice(0, 3)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-mist-100">{hotspot.stopName}</p>
                  <p className="truncate text-[0.68rem] text-mist-500">
                    {hotspot.lineName} · {formatTimeAgo(hotspot.observedAt)}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <CrowdBadge level={hotspot.level} size="xs" />
                <ArrowUpRight className="size-3.5 text-mist-500 transition group-hover:text-pulse-300" />
              </div>
            </div>
            {!compact ? (
              <div className="mt-2.5 flex items-center gap-3">
                <CrowdMeter ratio={hotspot.ratio} level={hotspot.level} height="sm" className="flex-1" />
                <span className="font-mono text-[0.7rem] text-mist-300">
                  {hotspot.headcount}/{hotspot.capacity}
                </span>
              </div>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function LivePill({ className, label = 'Live telemetry' }: { className?: string; label?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-pulse-400/30 bg-pulse-400/10 px-2.5 py-1 text-[0.65rem] font-medium tracking-wide text-pulse-300 uppercase',
        className,
      )}
    >
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-pulse-400 opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-pulse-400" />
      </span>
      <Radio className="size-3" />
      {label}
    </span>
  );
}
