import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Button } from './Button';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'animate-shimmer rounded-lg bg-[linear-gradient(90deg,rgba(255,255,255,0.04),rgba(255,255,255,0.12),rgba(255,255,255,0.04))] bg-[length:200%_100%]',
        className,
      )}
    />
  );
}

export function PanelSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className={cn('h-12 w-full', index === 0 && 'h-16')} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/12 bg-white/[0.02] px-6 py-10 text-center',
        className,
      )}
    >
      <span className="grid size-11 place-items-center rounded-2xl border border-white/10 bg-white/5 text-mist-400">
        {icon ?? <Inbox className="size-5" />}
      </span>
      <div>
        <p className="text-sm font-semibold text-mist-200">{title}</p>
        {description ? (
          <p className="mt-1 max-w-sm text-xs leading-relaxed text-mist-400">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border border-crowd-critical/30 bg-crowd-critical/8 px-5 py-4">
      <div className="flex items-center gap-2 text-crowd-critical">
        <AlertTriangle className="size-4" />
        <p className="text-sm font-semibold">{title}</p>
      </div>
      {message ? <p className="text-xs leading-relaxed text-mist-300">{message}</p> : null}
      {onRetry ? (
        <Button
          size="sm"
          variant="outline"
          icon={<RefreshCw className="size-3.5" />}
          onClick={onRetry}
        >
          Retry
        </Button>
      ) : null}
    </div>
  );
}
