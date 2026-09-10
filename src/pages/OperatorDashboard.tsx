import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Brain,
  BusFront,
  CircleDot,
  Cloud,
  FlaskConical,
  Gauge,
  History,
  MapPinned,
  RefreshCw,
  Siren,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { AiAlert, AiDecisionApplyResult, AiRecommendation } from '@shared/types';
import {
  useAiDecision,
  useApplyAiDecision,
  useCommandCenter,
  useCreateAlert,
} from '../hooks/useTransitData';
import { ApiError } from '../lib/api';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { StatTile } from '../components/ui/StatTile';
import { ErrorState, PanelSkeleton } from '../components/ui/Skeleton';
import { NetworkHeatmap, type HeatmapMode } from '../components/operator/NetworkHeatmap';
import { AiAlertFeed } from '../components/operator/AiAlertFeed';
import { AiRecommendations } from '../components/operator/AiRecommendations';
import { LiveRouteTable } from '../components/operator/LiveRouteTable';
import { RouteAnalyticsPanel } from '../components/operator/RouteAnalyticsPanel';
import {
  AiDecisionConsole,
  InterventionHistory,
} from '../components/operator/AiDecisionConsole';
import { cn } from '../lib/utils';

/**
 * Operator Command Center — `/operator`.
 *
 * A transportation operations console rather than a generic admin dashboard:
 * a live status bar, the network overview, live route status, a schematic
 * crowd heatmap, the AI alert feed, the AI recommendation plays and per-route
 * analytics. Every figure arrives in one payload from
 * `GET /api/operator/command-center`, which aggregates the simulated dataset in
 * Postgres and runs the prediction layer for the forecast columns.
 *
 * DEMO / SIMULATED DATA — the console says so on the status bar and in the
 * footer; nothing here describes a real network.
 */

const STATUS_META = {
  nominal: { label: 'Network nominal', tone: 'low' as const, icon: CircleDot },
  elevated: { label: 'Elevated crowding', tone: 'moderate' as const, icon: AlertTriangle },
  critical: { label: 'Critical', tone: 'critical' as const, icon: Siren },
};

function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function OperatorDashboard() {
  const command = useCommandCenter(60_000);
  const createAlert = useCreateAlert();

  const applyDecision = useApplyAiDecision();

  const [routeFilter, setRouteFilter] = useState<string | null>(null);
  const [focusRoute, setFocusRoute] = useState<string | null>(null);
  const [mode, setMode] = useState<HeatmapMode>('live');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [applied, setApplied] = useState<AiDecisionApplyResult | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const now = useClock();

  const data = command.data;

  /**
   * Which route the AI decision console is about: the route an operator picked,
   * or — before anyone picks — the route the engine rates as most at risk, so the
   * console is never empty when the demo opens.
   */
  const decisionRoute = useMemo(() => {
    if (focusRoute) return focusRoute;
    if (!data?.routes.length) return null;
    const risk = (route: (typeof data.routes)[number]) =>
      Math.max(route.occupancyPct, route.predictedPct, route.activeIntervention ? 0 : 0);
    return [...data.routes].sort((a, b) => risk(b) - risk(a))[0]?.routeNumber ?? null;
  }, [data, focusRoute]);

  const decision = useAiDecision(decisionRoute);

  const analytics = useMemo(() => {
    if (!data) return null;
    if (!routeFilter) return data.analytics.routes;
    const filtered = data.analytics.routes.filter((item) => item.routeNumber === routeFilter);
    return filtered.length ? filtered : data.analytics.routes;
  }, [data, routeFilter]);

  if (command.isError) {
    return (
      <ErrorState
        title="Control room feed unavailable"
        message={(command.error as Error).message}
        onRetry={() => void command.refetch()}
      />
    );
  }

  const status = data ? STATUS_META[data.kpis.status] : STATUS_META.nominal;
  const StatusIcon = status.icon;

  const publish = async (
    key: string,
    input: Parameters<typeof createAlert.mutateAsync>[0],
    confirmation: string,
  ): Promise<void> => {
    setPendingId(key);
    try {
      await createAlert.mutateAsync(input);
      setFlash(confirmation);
      window.setTimeout(() => setFlash(null), 3_500);
    } finally {
      setPendingId(null);
    }
  };

  const handlePublishAlert = (alert: AiAlert) =>
    void publish(
      alert.id,
      {
        lineId: alert.lineId,
        severity: alert.severity === 'info' ? 'minor' : alert.severity,
        category: alert.kind === 'disruption' ? 'disruption' : 'crowding',
        title: `Crowd advisory · Route ${alert.routeNumber}`,
        body: `${alert.message}. Action: ${alert.recommendedAction}`,
        issuedBy: 'Control Room A',
      },
      `Advisory published for Route ${alert.routeNumber}`,
    );

  const handleDispatch = (recommendation: AiRecommendation) =>
    void publish(
      recommendation.id,
      {
        lineId: recommendation.lineId || null,
        severity: recommendation.urgency === 'now' ? 'major' : 'minor',
        category: 'crowding',
        title: `Dispatch · ${recommendation.title}`,
        body: `${recommendation.detail}\n\nExpected impact: ${recommendation.impactLabel}`,
        issuedBy: 'Control Room A',
      },
      `Dispatched: ${recommendation.title}`,
    );

  const handleApplyDecision = async (): Promise<void> => {
    if (!decisionRoute) return;
    setApplyError(null);
    try {
      const result = await applyDecision.mutateAsync({ lineId: decisionRoute });
      setApplied(result);
      setFlash(
        `AI intervention applied to ${result.intervention.routeNumber} · ${result.intervention.predictedPct.toFixed(
          0,
        )}% → ${result.intervention.projectedPct.toFixed(0)}% projected occupancy · ${result.effects.alert.id} raised`,
      );
      window.setTimeout(() => setFlash(null), 8_000);
    } catch (error) {
      setApplyError(
        error instanceof ApiError && error.status === 409
          ? `${error.message} Press Re-assess to recompute the route with the extra vehicle.`
          : (error as Error).message,
      );
    }
  };

  const handleReassess = (): void => {
    setApplied(null);
    setApplyError(null);
    void decision.refetch();
  };

  /** Selecting a route focuses the AI decision console as well as the tables. */
  const handleSelectRoute = (routeNumber: string | null): void => {
    setRouteFilter(routeNumber);
    if (!routeNumber) return;
    setFocusRoute(routeNumber);
    setApplyError(null);
    setApplied((current) =>
      current && current.intervention.routeNumber === routeNumber ? current : null,
    );
  };

  /** An intervention already applied to the focused route (from the payload). */
  const focusIntervention = useMemo(() => {
    if (!data || !decisionRoute) return null;
    if (applied?.intervention.routeNumber === decisionRoute) return null;
    return (
      data.routes.find((route) => route.routeNumber === decisionRoute)?.activeIntervention ?? null
    );
  }, [data, decisionRoute, applied]);

  const routesShown = data && routeFilter
    ? data.routes.filter((route) => route.routeNumber === routeFilter)
    : data?.routes ?? [];

  return (
    <div className="space-y-5 pb-24 lg:pb-6">
      {/* ---------------------------------------------------------- status bar */}
      <Card accent="pulse" className="overflow-hidden">
        <div className="flex flex-col gap-3 p-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-ink-950/60 px-3 py-2">
              <Activity className="size-4 text-pulse-300" />
              <span className="font-mono text-xs tracking-[0.18em] text-mist-300 uppercase">
                Operations Control
              </span>
            </span>
            <Badge tone={status.tone} icon={<StatusIcon className="size-3" />}>
              {status.label}
            </Badge>
            {data ? (
              <>
                <Badge tone="violet" size="sm" icon={<Sparkles className="size-3" />}>
                  Simulation Mode
                </Badge>
                <Badge tone="neutral" size="sm" icon={<MapPinned className="size-3" />}>
                  {data.timeZone}
                </Badge>
              </>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="text-right">
              <p className="font-mono text-lg leading-none text-mist-100">
                {now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </p>
              <p className="mt-1 text-[0.62rem] tracking-wide text-mist-500 uppercase">
                {now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })}
                {data ? ` · updated ${new Date(data.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className={cn('size-3.5', command.isFetching && 'animate-spin')} />}
              onClick={() => void command.refetch()}
            >
              Refresh
            </Button>
          </div>
        </div>

        {data ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-white/6 px-4 py-2 text-[0.68rem] text-mist-400">
            <span>{data.kpis.statusDetail}</span>
            <span className="font-mono text-mist-500">
              engine {data.engine.id} · {data.engine.version}
            </span>
            <span className="font-mono text-mist-500">
              thresholds · moderate ≥60% · high ≥{data.crowdingThresholdPct.toFixed(0)}%
            </span>
          </div>
        ) : null}
      </Card>

      {flash ? (
        <div className="rounded-xl border border-pulse-400/35 bg-pulse-400/10 px-4 py-2.5 text-xs text-pulse-200">
          {flash}
        </div>
      ) : null}

      {/* --------------------------------------------------- 1 network overview */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Gauge className="size-4 text-pulse-300" />
          <h2 className="text-sm font-semibold tracking-wide text-mist-200 uppercase">
            Network overview
          </h2>
        </div>

        {!data ? (
          <PanelSkeleton rows={3} />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile
                label="Active routes"
                value={data.kpis.activeRoutes}
                unit={`of ${data.kpis.totalRoutes}`}
                icon={BusFront}
                accent="pulse"
                hint={`${data.heatmap.segments.length} monitored segments · ${data.heatmap.stops.length} stops`}
              />
              <StatTile
                label="Active vehicles"
                value={data.kpis.activeVehicles}
                unit={`of ${data.kpis.totalVehicles}`}
                icon={Activity}
                accent="sky"
                hint={`${data.kpis.maintenanceVehicles} in maintenance · ${data.kpis.idleVehicles} idle`}
              />
              <StatTile
                label="High crowd routes"
                value={data.kpis.highCrowdRoutes}
                unit={`≥ ${data.crowdingThresholdPct.toFixed(0)}%`}
                icon={AlertTriangle}
                accent={data.kpis.highCrowdRoutes ? 'critical' : 'none'}
                hint={`${data.kpis.watchRoutes} route(s) on watch between 70% and the threshold`}
              />
              <StatTile
                label="Average network occupancy"
                value={data.kpis.averageOccupancyPct}
                unit="%"
                icon={TrendingUp}
                accent="warning"
                hint={`Forecast +30 min: ${data.kpis.predictedOccupancyPct.toFixed(1)}%`}
                deltaPct={Number((data.kpis.predictedOccupancyPct - data.kpis.averageOccupancyPct).toFixed(1))}
                comparisonLabel="vs now"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  icon: Users,
                  label: 'Passengers on board',
                  value: data.kpis.passengersOnboard.toLocaleString(),
                  hint: `${Math.round(
                    (data.kpis.passengersOnboard / Math.max(data.kpis.networkCapacity, 1)) * 100,
                  )}% of monitored capacity`,
                },
                {
                  icon: CircleDot,
                  label: 'Monitored stops',
                  value: `${data.heatmap.stops.length}`,
                  hint: `${data.heatmap.stops.filter((stop) => stop.interchange).length} interchanges`,
                },
                {
                  icon: Siren,
                  label: 'Open notices',
                  value: `${data.alerts.filter((alert) => alert.kind === 'disruption').length}`,
                  hint: `${data.alerts.filter((alert) => alert.severity === 'critical').length} critical`,
                },
                {
                  icon: Cloud,
                  label: 'Weather input',
                  value: data.engine.weatherSource === 'disabled' ? 'off' : 'simulated',
                  hint: 'Optional model factor — synthetic demo data',
                },
              ].map((tile) => (
                <div
                  key={tile.label}
                  className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/6 text-mist-300">
                    <tile.icon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[0.62rem] tracking-wider text-mist-500 uppercase">{tile.label}</p>
                    <p className="font-mono text-sm text-mist-100">{tile.value}</p>
                    <p className="truncate text-[0.62rem] text-mist-500">{tile.hint}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* -------------------------------------------------- 2 live route status */}
      <Card>
        <CardHeader
          title="Live route status"
          subtitle="Every active route with measured load, forecast, fleet and operating status"
          icon={<BusFront className="size-4" />}
          actions={
            routeFilter ? (
              <Button size="sm" variant="ghost" onClick={() => setRouteFilter(null)}>
                Clear filter · {routeFilter}
              </Button>
            ) : (
              <Badge tone="neutral" size="xs">
                {data?.routes.length ?? 0} routes
              </Badge>
            )
          }
        />
        <CardBody className="p-0 pt-3">
          {!data ? (
            <PanelSkeleton rows={6} className="px-5" />
          ) : (
            <LiveRouteTable
              routes={routesShown}
              selectedRoute={routeFilter}
              onSelectRoute={handleSelectRoute}
            />
          )}
        </CardBody>
      </Card>

      {/* ------------------------------------------- 2b AI decision console */}
      <Card accent={applied ? 'pulse' : 'none'}>
        <CardHeader
          title="AI decision console"
          subtitle="Select a route to detect its next congestion event, review the numbered actions and apply the recommendation"
          icon={<Sparkles className="size-4" />}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {decisionRoute ? (
                <Badge tone="neutral" size="xs">
                  {decisionRoute}
                </Badge>
              ) : null}
              <Badge tone="violet" size="xs" icon={<FlaskConical className="size-3" />}>
                Simulated projections
              </Badge>
            </div>
          }
        />
        <CardBody className="space-y-4 pt-3">
          <AiDecisionConsole
            proposal={decision.data?.decision}
            isLoading={decision.isLoading}
            isError={decision.isError}
            errorMessage={decision.error ? (decision.error as Error).message : undefined}
            routeLabel={decisionRoute}
            applied={applied && applied.intervention.routeNumber === decisionRoute ? applied : null}
            conflict={focusIntervention}
            isApplying={applyDecision.isPending}
            applyError={applyError}
            onApply={() => void handleApplyDecision()}
            onReassess={handleReassess}
            onRetry={() => void decision.refetch()}
          />

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <History className="size-3.5 text-mist-400" />
              <span className="text-[0.62rem] tracking-wider text-mist-500 uppercase">
                Interventions applied
              </span>
              <span className="h-px flex-1 bg-white/8" />
              <span className="font-mono text-[0.62rem] text-mist-500">
                {data?.kpis.interventions24h ?? 0} in the last 24 h · ledger ai_decisions
              </span>
            </div>
            <InterventionHistory decisions={data?.decisions ?? []} />
          </div>
        </CardBody>
      </Card>

      {/* ------------------------------------------------ 3 heatmap + 4 alerts */}
      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader
            title="Crowd heatmap"
            subtitle="Schematic network map — segment colour is the crowding band on that corridor"
            icon={<MapPinned className="size-4" />}
            actions={
              <Badge tone="neutral" size="xs">
                green · yellow · red
              </Badge>
            }
          />
          {!data ? (
            <PanelSkeleton rows={5} className="px-5 py-4" />
          ) : (
            <NetworkHeatmap
              heatmap={data.heatmap}
              mode={mode}
              onModeChange={setMode}
              selectedRoute={routeFilter}
              onSelectRoute={handleSelectRoute}
              className="mt-3"
            />
          )}
        </Card>

        <Card className="flex flex-col overflow-hidden">
          <CardHeader
            title="AI alerts"
            subtitle="Prediction-driven advisories, highest severity first"
            icon={<Brain className="size-4" />}
            actions={
              <Badge tone={data?.alerts.some((alert) => alert.severity === 'critical') ? 'critical' : 'neutral'} size="xs">
                {data?.alerts.length ?? 0} open
              </Badge>
            }
          />
          <div className="mt-3 max-h-[560px] flex-1 overflow-y-auto">
            {!data ? (
              <PanelSkeleton rows={5} className="px-5" />
            ) : (
              <AiAlertFeed
                alerts={data.alerts}
                onPublishAdvisory={handlePublishAlert}
                publishingId={pendingId}
              />
            )}
          </div>
        </Card>
      </div>

      {/* ------------------------------------------------- 5 AI recommendations */}
      <Card>
        <CardHeader
          title="AI recommendations"
          subtitle="Ranked interventions with the evidence and expected impact behind each one"
          icon={<Sparkles className="size-4" />}
          actions={
            <Badge tone="pulse" size="xs">
              {data?.recommendations.length ?? 0} plays
            </Badge>
          }
        />
        <CardBody className="pt-3">
          {!data ? (
            <PanelSkeleton rows={4} />
          ) : (
            <AiRecommendations
              recommendations={data.recommendations}
              onDispatch={handleDispatch}
              dispatchingId={pendingId}
              className="xl:grid-cols-2"
            />
          )}
        </CardBody>
      </Card>

      {/* ------------------------------------------------------ 6 route analytics */}
      <Card>
        <CardHeader
          title="Route analytics"
          subtitle="Occupancy trend (measured → predicted), current vs forecast and the crowd trend per route"
          icon={<TrendingUp className="size-4" />}
          actions={
            routeFilter ? (
              <Badge tone="pulse" size="xs">
                {routeFilter} selected
              </Badge>
            ) : null
          }
        />
        <CardBody className="pt-3">
          {!data || !analytics ? (
            <PanelSkeleton rows={5} />
          ) : (
            <RouteAnalyticsPanel
              analytics={analytics}
              selectedRoute={routeFilter}
              onSelectRoute={setRouteFilter}
            />
          )}
        </CardBody>
      </Card>

      <p className="px-1 text-[0.65rem] leading-relaxed text-mist-600">
        {data?.disclaimer ??
          'Simulated prototype — occupancy, telemetry and weather are synthetic demo data, not real-world measurements.'}
      </p>
    </div>
  );
}
