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
    <ul className={cn('space-y-2', className)}>
      {hotspots.map((hotspot, index) => (
        <li key={`${hotspot.lineId}-${hotspot.stopId}`}>
          <Link
            to={`/routes/details?lineId=${hotspot.lineId}&stopId=${hotspot.stopId}`}
            className={cn(
              'group block rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-3 transition-[border-color,background-color,transform] duration-200',
              'hover:-translate-y-px hover:border-white/16 hover:bg-white/[0.05]',
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className="figure grid size-8 shrink-0 place-items-center rounded-lg text-2xs font-bold text-ink-950"
                  style={{ backgroundColor: hotspot.lineColor }}
                  aria-hidden
                >
                  {hotspot.lineCode.slice(0, 3)}
                </span>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate text-xs font-medium text-mist-100">
                    {index === 0 ? (
                      <span className="eyebrow text-crowd-high">busiest</span>
                    ) : null}
                    {hotspot.stopName}
                  </p>
                  <p className="truncate text-3xs text-mist-500">
                    {hotspot.lineName} · {formatTimeAgo(hotspot.observedAt)}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <CrowdBadge level={hotspot.level} size="xs" />
                <ArrowUpRight
                  className="size-3.5 text-mist-500 transition-colors group-hover:text-pulse-300"
                  aria-hidden
                />
              </div>
            </div>
            {!compact ? (
              <div className="mt-2.5 flex items-center gap-3">
                <CrowdMeter ratio={hotspot.ratio} level={hotspot.level} height="sm" className="flex-1" />
                <span className="figure text-3xs text-mist-300">
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

/** Compact "live" signal — a single glowing dot, used in panel headers. */
export function LivePill({ className, label = 'Live telemetry' }: { className?: string; label?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-pulse-400/25 bg-pulse-400/8 px-2.5 py-1 text-3xs font-medium tracking-wider text-pulse-300 uppercase',
        className,
      )}
    >
      <span className="relative flex size-1.5" aria-hidden>
        <span className="absolute inline-flex size-full animate-ping-slow rounded-full bg-pulse-400 opacity-70" />
        <span className="relative inline-flex size-1.5 rounded-full bg-pulse-400" />
      </span>
      <Radio className="size-3" aria-hidden />
      {label}
    </span>
  );
}
