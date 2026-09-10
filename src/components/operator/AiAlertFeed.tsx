import { AlertTriangle, BellRing, Clock, Radio, ShieldAlert, Siren } from 'lucide-react';
import type { AiAlert } from '@shared/types';
import { Badge } from '../ui/Badge';
import { EmptyState } from '../ui/Skeleton';
import { Button } from '../ui/Button';
import { cn, formatClock } from '../../lib/utils';

/**
 * AI alert feed — prediction-driven advisories from the command-centre payload.
 *
 * Each card answers the four questions a controller asks: which route, how
 * crowded, when, and what to do about it. Every value (`predictedOccupancyPct`,
 * `inMinutes`, `confidencePct`, `recommendedAction`) is computed server-side
 * from the simulated dataset; the card only formats it.
 */

const SEVERITY_STYLE: Record<
  AiAlert['severity'],
  { tone: 'critical' | 'high' | 'moderate' | 'info'; label: string; icon: typeof Siren }
> = {
  critical: { tone: 'critical', label: 'Critical', icon: Siren },
  major: { tone: 'high', label: 'Major', icon: ShieldAlert },
  minor: { tone: 'moderate', label: 'Minor', icon: AlertTriangle },
  info: { tone: 'info', label: 'Watch', icon: Radio },
};

const KIND_LABEL: Record<AiAlert['kind'], string> = {
  crowding: 'Crowd forecast',
  disruption: 'Service notice',
  spread: 'Load building',
};

function countdown(minutes: number): string {
  if (minutes <= 0) return 'active now';
  if (minutes < 60) return `in ${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest ? `in ${hours}h ${rest}m` : `in ${hours}h`;
}

export function AiAlertFeed({
  alerts,
  onPublishAdvisory,
  publishingId,
  className,
}: {
  alerts: AiAlert[];
  onPublishAdvisory: (alert: AiAlert) => void;
  publishingId: string | null;
  className?: string;
}) {
  if (!alerts.length) {
    return (
      <div className={cn('px-5 py-4', className)}>
        <EmptyState
          compact
          title="No alerts in the forecast window"
          description="The engine raises a card when a route is predicted to pass the crowding threshold — right now every corridor is inside its tolerance."
          icon={<BellRing className="size-5" />}
        />
      </div>
    );
  }

  return (
    <ul className={cn('divide-y divide-white/6', className)}>
      {alerts.map((alert) => {
        const style = SEVERITY_STYLE[alert.severity];
        const Icon = style.icon;
        const crowdToneClass =
          alert.predictedOccupancyPct >= 100
            ? 'text-crowd-critical'
            : alert.predictedOccupancyPct >= 85
              ? 'text-crowd-critical'
              : alert.predictedOccupancyPct >= 60
                ? 'text-crowd-moderate'
                : 'text-crowd-low';

        return (
          <li
            key={alert.id}
            className="space-y-2 px-4 py-3.5 transition-colors hover:bg-white/[0.02]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <span
                  className={cn(
                    'mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border',
                    style.tone === 'critical' && 'border-crowd-critical/40 bg-crowd-critical/12 text-crowd-critical',
                    style.tone === 'high' && 'border-crowd-high/40 bg-crowd-high/12 text-crowd-high',
                    style.tone === 'moderate' && 'border-crowd-moderate/40 bg-crowd-moderate/12 text-crowd-moderate',
                    style.tone === 'info' && 'border-sky-400/35 bg-sky-400/12 text-sky-300',
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-2xs text-mist-400">
                    <span className="inline-flex items-center gap-1.5 figure text-mist-200">
                      <span
                        className="size-1.5 rounded-full"
                        style={{ backgroundColor: alert.color, boxShadow: `0 0 6px ${alert.color}` }}
                      />
                      {alert.routeNumber}
                    </span>
                    <span className="text-mist-600">·</span>
                    <span>{KIND_LABEL[alert.kind]}</span>
                    <span className="text-mist-600">·</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3" />
                      {countdown(alert.inMinutes)}
                    </span>
                  </p>
                  <p className="mt-1 text-sm leading-snug font-medium text-mist-100">{alert.message}</p>
                </div>
              </div>
              <Badge tone={style.tone} size="xs" className="shrink-0">
                {style.label}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2 sm:grid-cols-4">
              <div>
                <p className="eyebrow text-mist-500">Predicted</p>
                <p className={cn('figure text-sm', crowdToneClass)}>
                  {alert.predictedOccupancyPct.toFixed(0)}%
                </p>
              </div>
              <div>
                <p className="eyebrow text-mist-500">ETA</p>
                <p className="figure text-sm text-mist-200">{formatClock(alert.estimatedAt)}</p>
              </div>
              <div>
                <p className="eyebrow text-mist-500">Confidence</p>
                <p className="figure text-sm text-mist-200">{alert.confidencePct.toFixed(0)}%</p>
              </div>
              <div>
                <p className="eyebrow text-mist-500">Threshold</p>
                <p className="figure text-sm text-mist-400">{alert.thresholdPct.toFixed(0)}%</p>
              </div>
            </div>

            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="flex min-w-0 items-start gap-1.5 text-2xs leading-relaxed text-mist-300">
                <BellRing className="mt-0.5 size-3 shrink-0 text-pulse-300" />
                <span>
                  <span className="text-mist-500">Recommended action: </span>
                  {alert.recommendedAction}
                </span>
              </p>
              <Button
                size="sm"
                variant="ghost"
                loading={publishingId === alert.id}
                onClick={() => onPublishAdvisory(alert)}
              >
                Publish advisory
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
