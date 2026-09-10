import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Button } from './Button';

/**
 * Loading + empty + error states.
 *
 * Skeletons mirror the layout they replace (same heights, same column counts) so
 * nothing jumps when data lands. Empty states explain what to do next; error
 * states say what failed and offer the retry.
 */

export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden
      style={style}
      className={cn(
        'animate-shimmer rounded-lg bg-[linear-gradient(90deg,rgba(255,255,255,0.04),rgba(255,255,255,0.11),rgba(255,255,255,0.04))] bg-[length:200%_100%]',
        className,
      )}
    />
  );
}

export function PanelSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className={cn('h-12 w-full', index === 0 && 'h-16')} />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** Grid of KPI tiles — matches `StatTile` dimensions. */
export function StatGridSkeleton({
  count = 4,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-4', className)}
      role="status"
      aria-label="Loading metrics"
    >
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="glass rounded-2xl p-4">
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="mt-3 h-7 w-20" />
          <Skeleton className="mt-3 h-2 w-32" />
        </div>
      ))}
    </div>
  );
}

/** Table skeleton that keeps the header readable and rows evenly spaced. */
export function TableSkeleton({
  rows = 6,
  columns = 5,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2 px-5', className)} role="status" aria-label="Loading table">
      <div className="flex gap-4 pb-2">
        {Array.from({ length: columns }).map((_, index) => (
          <Skeleton key={index} className="h-2.5 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex items-center gap-4 rounded-xl border border-white/6 px-3 py-3.5">
          <Skeleton className="size-8 rounded-lg" />
          {Array.from({ length: columns - 1 }).map((_, index) => (
            <Skeleton key={index} className={cn('h-3 flex-1', index === 0 && 'max-w-[220px]')} />
          ))}
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** Chart placeholder with baseline + axis hints. */
export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('relative h-56 w-full', className)} role="status" aria-label="Loading chart">
      <div className="absolute inset-x-0 bottom-0 flex h-full items-end gap-1.5">
        {[38, 52, 44, 68, 84, 62, 74, 58, 90, 70, 48, 34].map((height, index) => (
          <Skeleton key={index} className="flex-1 rounded-md" style={{ height: `${height}%` }} />
        ))}
      </div>
      <span className="sr-only">Loading chart…</span>
    </div>
  );
}

export function RouteCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('glass rounded-2xl p-4', className)} role="status" aria-label="Loading route">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-6 w-28 rounded-lg" />
          <Skeleton className="h-3 w-56" />
          <Skeleton className="h-3 w-40" />
        </div>
        <Skeleton className="h-8 w-20" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-16 rounded-xl" />
        ))}
      </div>
      <Skeleton className="mt-4 h-2.5 w-full rounded-full" />
      <span className="sr-only">Loading route option…</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  hint,
  className,
  compact = false,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  /** Optional short list of next steps. */
  hint?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.015] text-center',
        compact ? 'px-5 py-6' : 'px-6 py-12',
        className,
      )}
    >
      <span
        className="relative grid size-12 place-items-center rounded-2xl border border-white/10 bg-gradient-to-br from-white/8 to-white/[0.02] text-mist-300"
        aria-hidden
      >
        {icon ?? <Inbox className="size-5" />}
      </span>
      <div className="space-y-1">
        <p className="font-display text-sm font-semibold text-mist-100">{title}</p>
        {description ? (
          <p className="mx-auto max-w-md text-xs leading-relaxed text-mist-400">{description}</p>
        ) : null}
      </div>
      {hint ? <div className="text-2xs text-mist-500">{hint}</div> : null}
      {action}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  details,
  onRetry,
  className,
}: {
  title?: string;
  message?: string;
  details?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-start gap-3 rounded-2xl border border-crowd-critical/30 bg-crowd-critical/[0.07] px-5 py-4',
        className,
      )}
    >
      <div className="flex items-center gap-2 text-crowd-critical">
        <AlertTriangle className="size-4" aria-hidden />
        <p className="font-display text-sm font-semibold">{title}</p>
      </div>
      {message ? <p className="text-xs leading-relaxed text-mist-300">{message}</p> : null}
      {details ? (
        <p className="figure rounded-lg border border-white/8 bg-ink-950/60 px-2.5 py-1.5 text-3xs text-mist-400">
          {details}
        </p>
      ) : null}
      {onRetry ? (
        <Button size="sm" variant="outline" icon={<RefreshCw className="size-3.5" />} onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

