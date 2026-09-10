import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BusFront,
  Check,
  CircleDot,
  Clock3,
  FlaskConical,
  Gauge,
  Loader2,
  RefreshCw,
  Sparkles,
  TrendingDown,
  Users,
  Waypoints,
} from 'lucide-react';
import type {
  AiActionPlan,
  AiDecisionApplyResult,
  AiDecisionProposal,
  AiInterventionSummary,
  NetworkSnapshot,
  RouteIntervention,
} from '@shared/types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { CrowdMeter } from '../crowd/CrowdIndicators';
import { cn, formatClock, formatDuration } from '../../lib/utils';

/**
 * AI Decision console — the interactive "detect → recommend → apply" experience.
 *
 * Every number comes from `GET /api/operator/ai-decision`: the engine's forward
 * scan of the route's busiest monitored stop, the numbered actions composed from
 * reserve vehicles / alternative corridors / rider reach, and the projected
 * occupancy with and without the intervention. Pressing *Apply AI
 * Recommendation* calls `POST /api/operator/ai-decision/apply`, which writes the
 * decision ledger, releases a real `vehicles` row onto the route, raises an
 * `alerts` event and bumps the command-centre KPIs on the next refetch.
 *
 * DEMO / SIMULATED DATA — the panel says so; these are projections over a
 * synthetic dataset, not real-world measurements.
 */

const ACTION_ICONS: Record<AiActionPlan['key'], typeof BusFront> = {
  deploy_vehicle: BusFront,
  redirect_passengers: Waypoints,
  notify_passengers: Users,
  tighten_headway: Gauge,
};

/** Crowd level → text colour for the big detection figures. */
const LEVEL_TEXT: Record<'none' | 'low' | 'moderate' | 'high', string> = {
  none: 'text-mist-100',
  low: 'text-mist-100',
  moderate: 'text-crowd-moderate',
  high: 'text-crowd-critical',
};

function minutesLabel(minutes: number | null): string {
  if (minutes === null) return 'No crossing';
  if (minutes <= 0) return 'Now';
  return formatDuration(minutes);
}

function snapshotDelta(before: NetworkSnapshot, after: NetworkSnapshot) {
  return [
    {
      label: 'Active vehicles',
      before: before.activeVehicles,
      after: after.activeVehicles,
      tone: after.activeVehicles > before.activeVehicles ? 'up' : 'flat',
    },
    {
      label: 'Idle units',
      before: before.idleVehicles,
      after: after.idleVehicles,
      tone: after.idleVehicles < before.idleVehicles ? 'down' : 'flat',
    },
    {
      label: 'Open notices',
      before: before.openAlerts,
      after: after.openAlerts,
      tone: after.openAlerts > before.openAlerts ? 'up' : 'flat',
    },
    {
      label: 'Network occupancy',
      before: before.averageOccupancyPct,
      after: after.averageOccupancyPct,
      unit: '%',
      tone: 'flat',
    },
  ] as const;
}

/* -------------------------------------------------------------------------- */
/* Impact bars                                                                */
/* -------------------------------------------------------------------------- */

function ImpactBar({
  label,
  pct,
  tone,
  dashed = false,
  animateTo,
  hint,
}: {
  label: string;
  pct: number;
  tone: 'critical' | 'low';
  dashed?: boolean;
  animateTo: boolean;
  hint?: string;
}) {
  const width = Math.max(2, Math.min(pct, 140)) / 1.4;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[0.68rem] tracking-wider text-mist-400 uppercase">{label}</span>
        <span
          className={cn(
            'font-mono text-sm',
            tone === 'critical' ? 'text-crowd-critical' : 'text-crowd-low',
          )}
        >
          {pct.toFixed(1)}%
        </span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-white/8">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-1000 ease-out',
            tone === 'critical' ? 'bg-crowd-critical' : 'bg-crowd-low',
            dashed && 'opacity-70',
          )}
          style={{ width: `${animateTo ? width : 0}%` }}
        />
        {!dashed ? (
          <span
            key={animateTo ? 'on' : 'off'}
            className="pointer-events-none absolute inset-y-0 w-16 animate-sweep bg-gradient-to-r from-transparent via-white/35 to-transparent"
          />
        ) : null}
      </div>
      {hint ? <p className="text-[0.62rem] text-mist-500">{hint}</p> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Engine scan curve                                                          */
/* -------------------------------------------------------------------------- */

function ScanChart({
  scan,
  thresholdPct,
  crossingMinutes,
}: {
  scan: { minutes: number; ratio: number }[];
  thresholdPct: number;
  crossingMinutes: number | null;
}) {
  const geometry = useMemo(() => {
    if (scan.length < 2) return null;
    const maxMinutes = Math.max(...scan.map((point) => point.minutes), 60);
    const maxRatio = Math.max(
      thresholdPct / 100 + 0.15,
      ...scan.map((point) => point.ratio + 0.08),
    );
    const width = 100;
    const height = 32;
    const x = (minutes: number) => (minutes / maxMinutes) * width;
    const y = (ratio: number) => height - (ratio / maxRatio) * height;
    const line = scan
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.minutes).toFixed(2)},${y(point.ratio).toFixed(2)}`)
      .join(' ');
    return {
      width,
      height,
      line,
      area: `${line} L${width},${height} L0,${height} Z`,
      thresholdY: y(thresholdPct / 100),
      crossX: crossingMinutes === null ? null : x(Math.min(crossingMinutes, maxMinutes)),
      crossY:
        crossingMinutes === null
          ? null
          : y(
              scan.reduce((best, point) =>
                Math.abs(point.minutes - crossingMinutes) < Math.abs(best.minutes - crossingMinutes)
                  ? point
                  : best,
              ).ratio,
            ),
      maxMinutes,
    };
  }, [scan, thresholdPct, crossingMinutes]);

  if (!geometry) return null;

  return (
    <div className="mt-4 rounded-xl border border-white/8 bg-ink-950/50 px-3 pt-3 pb-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[0.62rem] tracking-wider text-mist-500 uppercase">
          Engine scan · predicted load
        </span>
        <span className="font-mono text-[0.62rem] text-mist-500">
          +0 → +{geometry.maxMinutes} min · threshold {thresholdPct.toFixed(0)}%
        </span>
      </div>
      <svg
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        preserveAspectRatio="none"
        className="mt-2 h-16 w-full"
        aria-hidden
      >
        <defs>
          <linearGradient id="scan-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(244,63,94,0.35)" />
            <stop offset="100%" stopColor="rgba(244,63,94,0)" />
          </linearGradient>
        </defs>
        <path d={geometry.area} fill="url(#scan-fill)" />
        <path d={geometry.line} fill="none" stroke="#fb7185" strokeWidth={0.7} vectorEffect="non-scaling-stroke" />
        <line
          x1={0}
          x2={geometry.width}
          y1={geometry.thresholdY}
          y2={geometry.thresholdY}
          stroke="rgba(248,113,113,0.55)"
          strokeWidth={0.4}
          strokeDasharray="2 2"
          vectorEffect="non-scaling-stroke"
        />
        {geometry.crossX !== null && geometry.crossY !== null ? (
          <>
            <line
              x1={geometry.crossX}
              x2={geometry.crossX}
              y1={geometry.height}
              y2={geometry.crossY}
              stroke="rgba(248,113,113,0.7)"
              strokeWidth={0.4}
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={geometry.crossX} cy={geometry.crossY} r={1.6} fill="#f43f5e" />
          </>
        ) : null}
      </svg>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Console                                                                    */
/* -------------------------------------------------------------------------- */

export interface AiDecisionConsoleProps {
  proposal?: AiDecisionProposal;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  routeLabel: string | null;
  applied: AiDecisionApplyResult | null;
  /** An intervention already applied to this route in the last 24 hours. */
  conflict: RouteIntervention | null;
  isApplying: boolean;
  applyError?: string | null;
  onApply: () => void;
  onReassess: () => void;
  onRetry: () => void;
  className?: string;
}

export function AiDecisionConsole({
  proposal,
  isLoading,
  isError,
  errorMessage,
  routeLabel,
  applied,
  conflict,
  isApplying,
  applyError,
  onApply,
  onReassess,
  onRetry,
  className,
}: AiDecisionConsoleProps) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setRevealed(false);
    const timer = window.setTimeout(() => setRevealed(true), 220);
    return () => window.clearTimeout(timer);
  }, [proposal?.id]);

  const isApplied = Boolean(applied);
  const impact = applied?.decision.impact ?? proposal?.impact;
  const actions = applied?.decision.actions ?? proposal?.actions ?? [];
  const predictedTone = proposal?.predictedLevel ?? 'low';

  if (isLoading) {
    return (
      <div className={cn('rounded-2xl border border-white/8 bg-white/[0.02] p-5', className)}>
        <div className="flex items-center gap-3 text-xs text-mist-400">
          <Loader2 className="size-4 animate-spin text-pulse-300" />
          Running the AI decision scan…
        </div>
      </div>
    );
  }

  if (isError || !proposal || !impact) {
    return (
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.02] p-5',
          className,
        )}
      >
        <div>
          <p className="text-sm font-medium text-mist-200">AI decision unavailable</p>
          <p className="mt-1 text-xs text-mist-500">
            {errorMessage ?? 'Select a route to run the decision scan.'}
          </p>
        </div>
        <Button size="sm" variant="secondary" icon={<RefreshCw className="size-3.5" />} onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  const confirmedPct = isApplied ? applied!.decision.impact.withoutPct : impact.withoutPct;
  const deltas = applied ? snapshotDelta(applied.effects.before, applied.effects.after) : [];
  const title = routeLabel ?? proposal.routeNumber;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border bg-white/[0.02]',
        isApplied ? 'border-crowd-low/40' : 'border-white/10',
        className,
      )}
    >
      {isApplied ? (
        <span className="pointer-events-none absolute inset-y-0 left-0 w-40 animate-sweep bg-gradient-to-r from-transparent via-crowd-low/20 to-transparent" />
      ) : null}

      {/* ------------------------------------------------------------- header */}
      <div className="flex flex-col gap-3 border-b border-white/8 p-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="violet" size="xs" icon={<Sparkles className="size-3" />}>
              AI Decision
            </Badge>
            <span className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-ink-950/60 px-2 py-1">
              <span className="size-2 rounded-full" style={{ backgroundColor: proposal.color }} />
              <span className="font-mono text-xs text-mist-200">{title}</span>
            </span>
            <Badge tone="neutral" size="xs" icon={<FlaskConical className="size-3" />}>
              Simulation Mode · simulated projection
            </Badge>
            {isApplied ? (
              <Badge tone="low" size="xs" icon={<BadgeCheck className="size-3" />}>
                Applied {applied?.intervention.appliedAt ? formatClock(applied.intervention.appliedAt) : ''}
              </Badge>
            ) : null}
          </div>
          <p className="max-w-3xl text-sm text-mist-200">{proposal.headline}</p>
          <p className="font-mono text-[0.62rem] text-mist-500">{proposal.detectionNote}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw className={cn('size-3.5', isApplying && 'animate-spin')} />}
            onClick={onReassess}
          >
            Re-assess
          </Button>
        </div>
      </div>

      <div className="space-y-5 p-4">
        {/* ------------------------------------------- AI DETECTED CONGESTION */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'font-mono text-[0.68rem] tracking-[0.22em] uppercase',
                proposal.kind === 'congestion' ? 'text-crowd-critical' : 'text-crowd-moderate',
              )}
            >
              {proposal.kind === 'congestion' ? 'AI Detected Congestion' : 'AI Risk Forecast'}
            </span>
            <span className="h-px flex-1 bg-white/8" />
            <span className="font-mono text-[0.62rem] text-mist-500">{proposal.basisLabel}</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                icon: BusFront,
                label: 'Route',
                value: proposal.routeNumber,
                hint: proposal.routeName,
              },
              {
                icon: Gauge,
                label: 'Current occupancy',
                value: `${proposal.currentPct.toFixed(1)}%`,
                hint: proposal.stop ? `worst stop · ${proposal.stop.name}` : 'monitored stop',
                level: proposal.currentLevel,
                ratio: proposal.currentPct / 100,
              },
              {
                icon: TrendingDown,
                label: 'Predicted occupancy',
                value: `${proposal.predictedPct.toFixed(1)}%`,
                hint: `${proposal.confidencePct.toFixed(0)}% model confidence`,
                level: proposal.predictedLevel,
                ratio: proposal.predictedPct / 100,
              },
              {
                icon: Clock3,
                label: 'Time to congestion',
                value: minutesLabel(proposal.minutesToCongestion),
                hint:
                  proposal.minutesToCongestion === null
                    ? 'no threshold crossing in the scan'
                    : `${formatClock(impact.targetAt)} local · target instant`,
              },
            ].map((tile) => (
              <div
                key={tile.label}
                className="rounded-xl border border-white/8 bg-ink-950/40 px-3.5 py-3"
              >
                <div className="flex items-center gap-2 text-mist-500">
                  <tile.icon className="size-3.5" />
                  <span className="text-[0.62rem] tracking-wider uppercase">{tile.label}</span>
                </div>
                <p className={cn('mt-1.5 font-mono text-xl leading-none', LEVEL_TEXT[tile.level ?? 'none'])}>
                  {tile.value}
                </p>
                <p className="mt-1 truncate text-[0.62rem] text-mist-500">{tile.hint}</p>
                {tile.level && tile.ratio !== undefined ? (
                  <div className="mt-2">
                    <CrowdMeter ratio={tile.ratio} level={tile.level} height="sm" showTicks={false} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <ScanChart
            scan={impact.scan}
            thresholdPct={proposal.thresholdPct}
            crossingMinutes={proposal.minutesToCongestion}
          />
        </section>

        {/* -------------------------------------------- AI RECOMMENDED ACTION */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[0.68rem] tracking-[0.22em] text-pulse-200 uppercase">
              AI Recommended Action
            </span>
            <span className="h-px flex-1 bg-white/8" />
            <span className="font-mono text-[0.62rem] text-mist-500">
              {actions.length} play(s) · {proposal.reserveVehicles} reserve unit(s)
            </span>
          </div>

          <ol className="space-y-2.5">
            {actions.map((action, index) => {
              const Icon = ACTION_ICONS[action.key] ?? CircleDot;
              return (
                <li
                  key={action.key}
                  className="flex gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-3"
                >
                  <span
                    className={cn(
                      'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border font-mono text-[0.68rem]',
                      action.applied
                        ? 'border-crowd-low/50 bg-crowd-low/15 text-crowd-low'
                        : 'border-white/15 bg-white/6 text-mist-300',
                    )}
                  >
                    {action.applied ? <Check className="size-3.5" /> : index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Icon className="size-3.5 text-mist-400" />
                      <p className="text-sm font-medium text-mist-100">{action.title}</p>
                      <Badge tone={action.key === 'deploy_vehicle' ? 'pulse' : 'neutral'} size="xs">
                        −{action.expectedReliefPct.toFixed(1)} pts
                      </Badge>
                      {action.targetLabel ? (
                        <span className="font-mono text-[0.62rem] text-mist-500">
                          target · {action.targetLabel}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-mist-400">{action.detail}</p>
                    {action.evidence.length ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {action.evidence.map((item) => (
                          <span
                            key={`${action.key}-${item.label}`}
                            className="rounded-md border border-white/8 bg-ink-950/40 px-2 py-0.5 font-mono text-[0.6rem] text-mist-400"
                          >
                            {item.label}: <span className="text-mist-200">{item.value}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        {/* -------------------------------------------------- EXPECTED IMPACT */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[0.68rem] tracking-[0.22em] text-mist-200 uppercase">
              Expected impact
            </span>
            <span className="h-px flex-1 bg-white/8" />
            <Badge tone={predictedTone} size="xs">
              {impact.withoutLevel} → {impact.withLevel}
            </Badge>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <ImpactBar
              label="Without intervention"
              pct={impact.withoutPct}
              tone="critical"
              animateTo={revealed}
              hint={`${formatClock(impact.targetAt)} local${impact.stopName ? ` · ${impact.stopName}` : ''}`}
            />
            <ImpactBar
              label="With recommended intervention"
              pct={impact.withPct}
              tone="low"
              animateTo={revealed}
              hint={`−${impact.reliefPct.toFixed(1)} points · about ${impact.passengersEased} riders eased`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-white/8 bg-ink-950/40 px-3.5 py-2.5">
            <span className="inline-flex items-center gap-1.5 text-[0.68rem] text-crowd-moderate">
              <ArrowRight className="size-3.5" />
              {confirmedPct.toFixed(1)}% → {impact.withPct.toFixed(1)}% projected
            </span>
            <span className="text-[0.62rem] text-mist-500">{impact.method}</span>
            <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[0.6rem] tracking-wider text-mist-400 uppercase">
              <FlaskConical className="size-3" />
              Simulated projection · not a measurement
            </span>
          </div>
        </section>

        {/* ------------------------------------------------------- apply row */}
        {isApplied && applied ? (
          <section className="animate-rise space-y-3 rounded-2xl border border-crowd-low/35 bg-crowd-low/8 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="relative grid size-9 place-items-center rounded-full border border-crowd-low/50 bg-crowd-low/15">
                <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden>
                  <path
                    d="M5 13l4 4L19 7"
                    stroke="currentColor"
                    className="animate-draw text-crowd-low"
                    strokeWidth={2.4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pathLength={1}
                    strokeDasharray={1}
                  />
                </svg>
                <span className="absolute inset-0 animate-pulse-ring rounded-full border border-crowd-low/40" />
              </span>
              <div>
                <p className="text-sm font-medium text-mist-100">AI intervention applied</p>
                <p className="text-xs text-mist-400">
                  {proposal.routeNumber} projected from {applied.decision.impact.withoutPct.toFixed(1)}% to{' '}
                  {applied.decision.impact.withPct.toFixed(1)}% occupancy · decision{' '}
                  <span className="font-mono text-mist-300">{applied.effects.decisionId}</span>
                </p>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {deltas.map((delta) => (
                <div
                  key={delta.label}
                  className="rounded-xl border border-white/8 bg-ink-950/40 px-3 py-2.5"
                >
                  <p className="text-[0.62rem] tracking-wider text-mist-500 uppercase">{delta.label}</p>
                  <p className="mt-1 font-mono text-sm text-mist-100">
                    {delta.before}
                    {'unit' in delta && delta.unit ? delta.unit : ''}
                    {delta.after !== delta.before ? (
                      <>
                        <span className="mx-1.5 text-mist-500">→</span>
                        <span className={delta.tone === 'down' ? 'text-crowd-low' : 'text-pulse-200'}>
                          {delta.after}
                          {'unit' in delta && delta.unit ? delta.unit : ''}
                        </span>
                      </>
                    ) : null}
                  </p>
                </div>
              ))}
            </div>

            <ul className="space-y-1.5 text-xs text-mist-300">
              {applied.effects.vehicle ? (
                <li className="flex items-center gap-2">
                  <BusFront className="size-3.5 text-pulse-300" />
                  {applied.effects.vehicle.created ? 'Standby unit created' : 'Reserve unit released'} ·{' '}
                  <span className="font-mono text-mist-100">{applied.effects.vehicle.code}</span>
                  {applied.effects.vehicle.previousStatus
                    ? ` (${applied.effects.vehicle.previousStatus.replace('_', ' ')} → in service${
                        applied.effects.vehicle.previousLineCode
                          ? `, moved from ${applied.effects.vehicle.previousLineCode}`
                          : ''
                      })`
                    : ' (depot reserve → in service)'}
                </li>
              ) : null}
              <li className="flex items-center gap-2">
                <AlertTriangle className="size-3.5 text-crowd-moderate" />
                Rider alert raised ·{' '}
                <span className="font-mono text-mist-100">{applied.effects.alert.id}</span> ·{' '}
                {applied.effects.alert.severity} · {applied.effects.alert.category}
              </li>
              <li className="flex items-center gap-2">
                <BadgeCheck className="size-3.5 text-crowd-low" />
                Ledger written ·{' '}
                <span className="font-mono text-mist-100">
                  ai_decisions + {actions.length} ai_decision_actions
                </span>{' '}
                · visible in the Data Explorer
              </li>
            </ul>
          </section>
        ) : (
          <section className="space-y-2">
            {conflict ? (
              <div className="rounded-xl border border-crowd-moderate/35 bg-crowd-moderate/10 px-3.5 py-2.5 text-xs text-crowd-moderate">
                An intervention was already applied to {title}{' '}
                {conflict.appliedAt ? `at ${formatClock(conflict.appliedAt)}` : ''} — projected{' '}
                {conflict.projectedPct.toFixed(1)}% (decision{' '}
                <span className="font-mono">{conflict.id}</span>). Press <em>Re-assess</em> to
                recompute the route with the extra vehicle in service.
              </div>
            ) : null}
            {applyError ? (
              <div className="rounded-xl border border-crowd-critical/35 bg-crowd-critical/10 px-3.5 py-2.5 text-xs text-crowd-critical">
                {applyError}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                icon={
                  isApplying ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )
                }
                disabled={isApplying}
                onClick={onApply}
              >
                {isApplying ? 'Applying intervention…' : 'Apply AI Recommendation'}
              </Button>
              <span className="text-[0.62rem] leading-relaxed text-mist-500">
                Writes the decision ledger, releases{' '}
                <span className="font-mono text-mist-400">
                  {actions[0]?.targetLabel ?? 'a reserve unit'}
                </span>{' '}
                to {proposal.routeNumber} and raises the rider alert.
              </span>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/** Compact strip of interventions already applied — shown with the console. */
export function InterventionHistory({
  decisions,
  className,
}: {
  decisions: AiInterventionSummary[];
  className?: string;
}) {
  if (!decisions.length) {
    return (
      <p className={cn('text-xs text-mist-500', className)}>
        No AI interventions applied yet — select a route and apply a recommendation.
      </p>
    );
  }

  return (
    <ul className={cn('grid gap-2 sm:grid-cols-2 xl:grid-cols-3', className)}>
      {decisions.map((item) => (
        <li
          key={item.id}
          className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 text-xs"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="font-mono text-mist-200">{item.routeNumber}</span>
            </span>
            <span className="font-mono text-[0.62rem] text-mist-500">
              {item.appliedAt ? formatClock(item.appliedAt) : '—'}
            </span>
          </div>
          <p className="mt-1.5 text-mist-400">
            {item.predictedPct.toFixed(0)}% → {item.projectedPct.toFixed(0)}% projected ·{' '}
            {item.actionCount} action(s)
          </p>
          <p className="mt-1 flex items-center gap-2 font-mono text-[0.6rem] text-mist-500">
            <span>{item.id}</span>
            {item.vehicleCode ? <span>· {item.vehicleCode}</span> : null}
            {item.alertId ? <span>· {item.alertId}</span> : null}
          </p>
        </li>
      ))}
    </ul>
  );
}
