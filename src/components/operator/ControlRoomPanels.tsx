import type { ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Brain,
  BusFront,
  CheckCircle2,
  Gauge,
  RefreshCw,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import type {
  AiDecisionApplyResult,
  AiDecisionProposal,
  CommandKpis,
  CrowdLevel,
  RouteIntervention,
} from '@shared/types';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import { Sparkline } from '../ui/Sparkline';
import { CrowdBadge, CrowdMeter } from '../crowd/CrowdIndicators';
import { cn, formatPercent } from '../../lib/utils';

/**
 * The control-room rail beside the network map.
 *
 * Order is the operator's decision loop:
 *   1. NETWORK STATUS — where the network stands right now.
 *   2. AI ALERT       — what the model expects to happen, and when.
 *   3. AI ACTION      — the numbered interventions, with the apply button.
 *
 * Every figure comes from `GET /api/operator/command-center` (Postgres aggregates)
 * or `GET /api/operator/ai-decision` (the crowd model). Nothing is client-invented,
 * and the projections are labelled SIMULATED wherever they appear.
 */

/* -------------------------------------------------------------------------- */
/* 1. Network status                                                          */
/* -------------------------------------------------------------------------- */

function StatusMetric({
  icon,
  label,
  value,
  unit,
  hint,
  tone = 'neutral',
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
  tone?: 'neutral' | CrowdLevel;
}) {
  const valueTone =
    tone === 'high' ? 'text-crowd-high' : tone === 'moderate' ? 'text-crowd-moderate' : 'text-mist-100';

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 transition-colors hover:border-white/14">
      <p className="flex items-center gap-1.5">
        <span className="text-mist-500" aria-hidden>
          {icon}
        </span>
        <span className="eyebrow text-mist-500">{label}</span>
      </p>
      <p className={cn('mt-1.5 figure text-xl leading-none font-semibold', valueTone)}>
        {value}
        {unit ? <span className="ml-1 text-xs font-normal text-mist-400">{unit}</span> : null}
      </p>
      {hint ? <p className="mt-1 text-3xs leading-snug text-mist-500">{hint}</p> : null}
    </div>
  );
}

export function NetworkStatusPanel({
  kpis,
  thresholdPct,
  isLoading,
}: {
  kpis?: CommandKpis;
  thresholdPct: number;
  isLoading: boolean;
}) {
  return (
    <Card accent="none">
      <CardHeader
        title="Network status"
        subtitle="Fleet and crowding, straight from the command-centre aggregate"
        icon={<Gauge className="size-4" />}
        actions={
          kpis ? (
            <Badge
              tone={kpis.status === 'critical' ? 'critical' : kpis.status === 'elevated' ? 'moderate' : 'low'}
              size="xs"
              dot
            >
              {kpis.status}
            </Badge>
          ) : null
        }
      />
      <CardBody className="pt-3">
        {!kpis || isLoading ? (
          <div className="grid grid-cols-2 gap-3">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-[86px] rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <StatusMetric
              icon={<BusFront className="size-3.5" />}
              label="Active routes"
              value={kpis.activeRoutes}
              unit={`of ${kpis.totalRoutes}`}
              hint={`${kpis.watchRoutes} on watch · ${kpis.highCrowdRoutes} above threshold`}
            />
            <StatusMetric
              icon={<Activity className="size-3.5" />}
              label="Active vehicles"
              value={kpis.activeVehicles}
              unit={`of ${kpis.totalVehicles}`}
              hint={`${kpis.maintenanceVehicles} in maintenance · ${kpis.idleVehicles} idle`}
            />
            <StatusMetric
              icon={<TrendingUp className="size-3.5" />}
              label="Average occupancy"
              value={kpis.averageOccupancyPct.toFixed(1)}
              unit="%"
              hint={`Forecast +30 min: ${kpis.predictedOccupancyPct.toFixed(1)}%`}
              tone={kpis.averageOccupancyPct >= thresholdPct ? 'high' : 'neutral'}
            />
            <StatusMetric
              icon={<AlertTriangle className="size-3.5" />}
              label="High crowd routes"
              value={kpis.highCrowdRoutes}
              unit={`≥ ${thresholdPct.toFixed(0)}%`}
              hint={`${kpis.interventions24h} AI intervention(s) in 24 h`}
              tone={kpis.highCrowdRoutes ? 'high' : 'low'}
            />
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* 2. AI alert                                                                */
/* -------------------------------------------------------------------------- */

export function AiAlertPanel({
  decision,
  isLoading,
  isError,
  routeLabel,
  onRetry,
}: {
  decision?: AiDecisionProposal | null;
  isLoading: boolean;
  isError?: boolean;
  routeLabel: string | null;
  onRetry: () => void;
}) {
  const scan = decision?.impact.scan.map((point) => point.ratio) ?? [];

  return (
    <Card accent={decision?.predictedLevel === 'high' ? 'critical' : 'none'}>
      <CardHeader
        title="AI alert"
        subtitle={routeLabel ? `Congestion forecast · Route ${routeLabel}` : 'Congestion forecast'}
        icon={<Brain className="size-4" />}
        actions={
          decision ? (
            <Badge tone={decision.predictedLevel} size="xs" dot>
              {decision.predictedLevel} predicted
            </Badge>
          ) : (
            <Badge tone="neutral" size="xs">
              engine
            </Badge>
          )
        }
      />
      <CardBody className="space-y-3 pt-3">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4 rounded-md" />
            <Skeleton className="h-4 w-2/3 rounded-md" />
            <Skeleton className="h-8 rounded-xl" />
          </div>
        ) : isError ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-crowd-high/25 bg-crowd-high/[0.07] px-3 py-2.5">
            <p className="text-2xs text-mist-300">The decision engine did not answer.</p>
            <Button size="sm" variant="outline" icon={<RefreshCw className="size-3.5" />} onClick={onRetry}>
              Retry
            </Button>
          </div>
        ) : !decision ? (
          <p className="text-2xs leading-relaxed text-mist-500">
            No congestion projection for this view yet — pick a corridor on the map.
          </p>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-mist-100">{decision.headline}</p>

            <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-2xs text-mist-400">
                  Current <span className="figure text-mist-200">{formatPercent(decision.currentPct / 100)}</span>
                </span>
                <ArrowRight className="size-3.5 text-mist-500" aria-hidden />
                <span className="text-2xs text-mist-400">
                  Predicted{' '}
                  <span className={cn('figure', decision.predictedLevel === 'high' ? 'text-crowd-high' : 'text-mist-100')}>
                    {formatPercent(decision.predictedPct / 100)}
                  </span>
                </span>
              </div>
              <div className="mt-2.5">
                <CrowdMeter ratio={decision.predictedPct / 100} level={decision.predictedLevel} height="sm" />
              </div>
              <p className="mt-2 text-3xs text-mist-500">
                {decision.minutesToCongestion === null
                  ? decision.basisLabel
                  : decision.minutesToCongestion === 0
                    ? `Above the ${decision.thresholdPct.toFixed(0)}% crowding threshold now`
                    : `Crosses the ${decision.thresholdPct.toFixed(0)}% threshold in ${decision.minutesToCongestion} min`}
              </p>
            </div>

            {scan.length > 1 ? (
              <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2">
                <p className="eyebrow text-mist-500">Engine scan · next {decision.horizonMinutes} min</p>
                <Sparkline
                  data={scan}
                  height={30}
                  filled
                  colorClassName={decision.predictedLevel === 'high' ? 'text-crowd-high' : 'text-pulse-400'}
                  className="mt-1"
                />
              </div>
            ) : null}

            <dl className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2">
                <dt className="eyebrow text-mist-500">Confidence</dt>
                <dd className="mt-1 figure text-sm text-mist-100">{decision.confidencePct.toFixed(0)}%</dd>
              </div>
              <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2">
                <dt className="eyebrow text-mist-500">Forecast peak</dt>
                <dd className="mt-1 figure text-sm text-mist-100">
                  {decision.headcount} / {decision.capacityPerVehicle}
                </dd>
              </div>
            </dl>

            <p className="text-3xs leading-relaxed text-mist-500">
              {decision.stop ? `Worst stop: ${decision.stop.name} · ` : ''}
              {decision.detectionNote}
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* 3. AI action                                                               */
/* -------------------------------------------------------------------------- */

export function AiActionPanel({
  decision,
  applied,
  conflict,
  isApplying,
  errorMessage,
  onApply,
  onReassess,
}: {
  decision?: AiDecisionProposal | null;
  applied: AiDecisionApplyResult | null;
  conflict: RouteIntervention | null;
  isApplying: boolean;
  errorMessage: string | null;
  onApply: () => void;
  onReassess: () => void;
}) {
  const actions = decision?.actions.slice(0, 3) ?? [];
  const done = Boolean(applied);

  return (
    <Card accent={done ? 'pulse' : 'none'}>
      <CardHeader
        title="AI action"
        subtitle="Numbered interventions ranked by expected relief at the forecast peak"
        icon={<Sparkles className="size-4" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="violet" size="xs" dot>
              SIMULATED PROJECTION
            </Badge>
            {decision ? (
              <Badge tone="neutral" size="xs">
                Route {decision.routeNumber}
              </Badge>
            ) : null}
          </div>
        }
      />
      <CardBody className="pt-3">
        {!decision ? (
          <p className="text-2xs leading-relaxed text-mist-500">
            Select a corridor on the map to load its recommended interventions.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1.65fr_1fr]">
            <ol className="grid gap-3 md:grid-cols-3">
              {actions.map((action) => (
                <li
                  key={action.key}
                  className={cn(
                    'flex h-full flex-col rounded-xl border border-white/8 bg-white/[0.02] px-3 py-3 transition-colors',
                    done ? 'border-pulse-400/25 bg-pulse-400/[0.06]' : 'hover:border-white/14',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'grid size-5 shrink-0 place-items-center rounded-md border text-3xs font-semibold',
                        done
                          ? 'border-pulse-400/40 bg-pulse-400/15 text-pulse-200'
                          : 'border-white/12 bg-white/6 text-mist-300',
                      )}
                    >
                      {done ? <CheckCircle2 className="size-3" aria-hidden /> : action.order}
                    </span>
                    <p className="min-w-0 text-xs font-medium text-mist-100">{action.title}</p>
                  </div>
                  <p className="mt-2 line-clamp-3 text-3xs leading-relaxed text-mist-400">{action.detail}</p>
                  <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-2.5">
                    {action.targetLabel ? (
                      <span className="text-3xs text-mist-500">{action.targetLabel}</span>
                    ) : null}
                    <span className="figure text-3xs text-crowd-low">
                      −{action.expectedReliefPct.toFixed(1)} pts at peak
                    </span>
                  </div>
                </li>
              ))}
            </ol>

            <div className="space-y-3">
              <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
                <p className="eyebrow text-mist-500">Projected impact · simulated</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="figure text-display-sm leading-none font-semibold text-mist-500 line-through decoration-crowd-high/70">
                    {formatPercent(decision.impact.withoutPct / 100)}
                  </span>
                  <ArrowRight className="size-4 text-mist-500" aria-hidden />
                  <span className="figure text-display-sm leading-none font-semibold text-crowd-low">
                    {formatPercent(decision.impact.withPct / 100)}
                  </span>
                  <CrowdBadge level={decision.impact.withLevel} size="xs" />
                </div>
                <p className="mt-2 text-3xs leading-relaxed text-mist-500">
                  −{decision.impact.reliefPct.toFixed(1)} points at the forecast peak ·{' '}
                  {decision.impact.passengersEased.toLocaleString()} riders eased ·{' '}
                  {decision.impact.method}
                </p>
              </div>

              {errorMessage ? (
                <p
                  role="alert"
                  className="rounded-xl border border-crowd-high/25 bg-crowd-high/[0.07] px-3 py-2 text-2xs leading-relaxed text-mist-200"
                >
                  {errorMessage}
                </p>
              ) : null}

              {done && applied ? (
                <div className="animate-rise rounded-xl border border-pulse-400/30 bg-pulse-400/[0.08] px-3 py-2.5">
                  <p className="flex items-center gap-2 text-2xs font-medium text-pulse-100">
                    <CheckCircle2 className="size-3.5" aria-hidden />
                    Intervention applied to Route {applied.intervention.routeNumber}
                  </p>
                  <p className="mt-1 text-3xs leading-relaxed text-mist-300">
                    {applied.effects.vehicle
                      ? `Vehicle ${applied.effects.vehicle.code} ${
                          applied.effects.vehicle.created ? 'commissioned' : 'deployed'
                        } to the corridor. `
                      : ''}
                    Alert {applied.effects.alert.id} raised ·{' '}
                    {applied.intervention.projectedPct.toFixed(0)}% projected occupancy · decision{' '}
                    {applied.effects.decisionId}
                  </p>
                </div>
              ) : conflict ? (
                <div className="rounded-xl border border-sky-glow/25 bg-sky-glow/[0.07] px-3 py-2.5">
                  <p className="text-2xs font-medium text-mist-100">
                    Route {decision.routeNumber} already has an active intervention
                  </p>
                  <p className="mt-1 text-3xs leading-relaxed text-mist-300">
                    Applied{' '}
                    {new Date(conflict.appliedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {conflict.vehicleCode ? ` · vehicle ${conflict.vehicleCode}` : ''} · projected{' '}
                    {conflict.projectedPct.toFixed(0)}% · {conflict.actionCount} action
                    {conflict.actionCount === 1 ? '' : 's'}. Re-assess to recompute with the extra capacity.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    icon={<RefreshCw className="size-3.5" />}
                    onClick={onReassess}
                  >
                    Re-assess route
                  </Button>
                </div>
              ) : (
                <>
                  <Button
                    variant="primary"
                    block
                    icon={<Sparkles className="size-3.5" />}
                    loading={isApplying}
                    disabled={decision.status === 'applied'}
                    onClick={onApply}
                  >
                    Apply AI recommendation
                  </Button>
                  <p className="text-3xs leading-relaxed text-mist-600">
                    Applying writes the decision, the reserve vehicle and the service alert to Postgres.
                    The map, the route table and every KPI above refresh from those rows.
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
