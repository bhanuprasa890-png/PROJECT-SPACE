import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BellRing,
  Bookmark,
  Clock,
  Gauge,
  MapPinned,
  Route as RouteIcon,
  ShieldCheck,
  Sparkles,
  TrainFront,
  Trash2,
  Users,
} from 'lucide-react';
import type { DashboardStat, UpcomingDeparture, WatchlistItem } from '@shared/types';
import { useDashboard, useDeleteWatchlistItem, useToggleWatchlistItem } from '../hooks/useTransitData';
import { JourneyPlanner, type PlannerValues, type QuickJourney } from '../components/route/JourneyPlanner';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState, ErrorState, PanelSkeleton, StatGridSkeleton } from '../components/ui/Skeleton';
import { SectionHeading } from '../components/ui/Section';
import { StatTile } from '../components/ui/StatTile';
import { CrowdBadge, CrowdLegend, CrowdMeter, ConfidencePill } from '../components/crowd/CrowdIndicators';
import { CrowdHotspotList, LivePill } from '../components/crowd/CrowdHotspotList';
import { LegTimeline } from '../components/route/LegTimeline';
import { OperatorNetworkMap } from '../components/map/OperatorNetworkMap';
import { severityTone, formatClock, formatDuration, formatPercent, cn } from '../lib/utils';

const STAT_ICONS: Record<string, typeof Clock> = {
  clock: Clock,
  shield: ShieldCheck,
  activity: Activity,
  alert: AlertTriangle,
  bookmark: Bookmark,
};

const STAT_TONES: Record<DashboardStat['tone'], 'positive' | 'negative' | 'neutral'> = {
  positive: 'positive',
  negative: 'negative',
  warning: 'neutral',
  neutral: 'neutral',
};

/** The three product verbs — kept as one quiet strip, not three loud cards. */
const STAGES = [
  { icon: Activity, title: 'Predict', text: 'Forecast occupancy per leg' },
  { icon: ShieldCheck, title: 'Avoid', text: 'Skip the crowded services' },
  { icon: RouteIcon, title: 'Optimize', text: 'Score time against crowding' },
];

export function CommuterDashboard() {
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch } = useDashboard();
  const toggleWatchlist = useToggleWatchlistItem();
  const deleteWatchlist = useDeleteWatchlistItem();

  const [values, setValues] = useState<PlannerValues>({
    originStopId: '',
    destinationStopId: '',
    departMode: 'now',
    departTime: '08:15',
    avoidCrowding: true,
    maxTransfers: 1,
  });

  // Default the planner to the rider's saved home → work pair (from the DB).
  useEffect(() => {
    if (!data?.profile) return;
    setValues((previous) => ({
      ...previous,
      originStopId: previous.originStopId || data.profile.homeStopId || '',
      destinationStopId: previous.destinationStopId || data.profile.workStopId || '',
    }));
  }, [data?.profile]);

  // One-tap demo journeys, built from the rider's saved trips in the database.
  const quickJourneys = useMemo<QuickJourney[]>(() => {
    const items = data?.watchlist ?? [];
    const seen = new Set<string>();
    return items
      .filter((item) => {
        const key = `${item.originStopId}-${item.destinationStopId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 3)
      .map((item) => ({
        label: `${item.originStopName} → ${item.destinationStopName}`,
        originStopId: item.originStopId,
        destinationStopId: item.destinationStopId,
      }));
  }, [data?.watchlist]);

  const payload = useMemo(
    () =>
      values.departMode === 'now' || !values.departTime
        ? undefined
        : new Date(`${new Date().toISOString().slice(0, 10)}T${values.departTime}:00`).toISOString(),
    [values.departMode, values.departTime],
  );

  const submit = (): void => {
    const params = new URLSearchParams({
      origin: values.originStopId,
      destination: values.destinationStopId,
      avoidCrowding: String(values.avoidCrowding),
      maxTransfers: String(values.maxTransfers),
    });
    if (payload) params.set('departAfter', payload);
    navigate(`/routes?${params.toString()}`);
  };

  if (isError) {
    return (
      <ErrorState
        title="Dashboard data unavailable"
        message={(error as Error)?.message}
        onRetry={() => void refetch()}
      />
    );
  }

  const nextJourney = data?.nextJourney;
  const bestOption = nextJourney?.planned.options.find(
    (option) => option.id === nextJourney.planned.recommendedOptionId,
  );

  const busiest = data?.stats.find((stat) => stat.key === 'busiest_line');
  const alertsStat = data?.stats.find((stat) => stat.key === 'alerts');

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------------ hero */}
      <section className="glass-strong relative overflow-hidden rounded-3xl p-5 sm:p-7 lg:p-8">
        <span
          className="pointer-events-none absolute -top-32 -right-24 size-80 rounded-full bg-pulse-400/8 blur-3xl"
          aria-hidden
        />
        <span
          className="pointer-events-none absolute -bottom-40 -left-24 size-80 rounded-full bg-sky-glow/8 blur-3xl"
          aria-hidden
        />

        <div className="relative grid gap-7 xl:grid-cols-[minmax(0,1.02fr)_minmax(0,0.98fr)] xl:items-center">
          <div className="space-y-5">
            <span className="inline-flex items-center gap-2 rounded-full border border-pulse-400/25 bg-pulse-400/8 px-3 py-1 text-2xs font-medium tracking-wider text-pulse-200 uppercase">
              <Sparkles className="size-3" aria-hidden />
              Live crowd forecasting
              <span className="text-pulse-300/60">·</span>
              <span className="normal-case">{data?.model ? `model ${data.model.version}` : 'TransitPulse AI'}</span>
            </span>

            <div className="space-y-3">
              <h1 className="font-display text-display-md leading-[1.08] font-semibold tracking-tight text-mist-50 sm:text-4xl lg:text-display-xl">
                Know the crowd <span className="text-glow text-pulse-300">before you board.</span>
              </h1>
              <p className="max-w-xl text-sm leading-relaxed text-mist-300">
                Tell TransitPulse where you are going. It predicts how full every option will be at
                your departure time, then recommends the route that keeps you comfortable — with the
                numbers to prove it.
              </p>
            </div>

            <ol className="grid gap-2 sm:grid-cols-3">
              {STAGES.map(({ icon: Icon, title, text }, index) => (
                <li
                  key={title}
                  className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 transition-colors hover:border-white/14"
                >
                  <span className="flex items-center gap-1.5 text-2xs font-semibold text-mist-100">
                    <Icon className="size-3.5 text-pulse-300" aria-hidden />
                    {title}
                    <span className="figure ml-auto text-3xs text-mist-600">0{index + 1}</span>
                  </span>
                  <span className="mt-1 block text-3xs leading-relaxed text-mist-400">{text}</span>
                </li>
              ))}
            </ol>

            <div className="flex flex-wrap items-center gap-2 text-2xs">
              <LivePill label="Telemetry" />
              {busiest ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/4 px-2.5 py-1 text-mist-300">
                  <Gauge className="size-3" aria-hidden />
                  Busiest right now <span className="figure text-mist-100">{busiest.value}</span>
                </span>
              ) : null}
              {alertsStat ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/4 px-2.5 py-1 text-mist-300">
                  <BellRing className="size-3" aria-hidden />
                  <span className="figure text-mist-100">{alertsStat.value}</span> active alerts
                </span>
              ) : null}
            </div>
          </div>

          <JourneyPlanner
            values={values}
            onChange={(patch) => setValues((previous) => ({ ...previous, ...patch }))}
            onSubmit={submit}
            quickJourneys={quickJourneys}
            quickPicks={data?.watchlist.map((item) => ({
              id: item.originStopId,
              name: item.originStopName,
            }))}
          />
        </div>
      </section>

      {/* ------------------------------------------------- network snapshot (KPI) */}
      <section aria-labelledby="network-snapshot" className="space-y-3">
        <SectionHeading
          id="network-snapshot"
          eyebrow="Network"
          title="Today at a glance"
          description="Every tile is an aggregation the API runs over live telemetry in Postgres."
          icon={Gauge}
          actions={<LivePill />}
        />
        {isLoading ? (
          <StatGridSkeleton count={5} className="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {data?.stats.map((stat, index) => (
              <StatTile
                key={stat.key}
                label={stat.label}
                value={stat.value}
                hint={stat.hint}
                icon={STAT_ICONS[stat.icon] ?? Activity}
                tone={STAT_TONES[stat.tone]}
                accent={index === 0 ? 'pulse' : 'none'}
                animated={false}
              />
            ))}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------- network map */}
      <section aria-labelledby="network-map" className="space-y-3">
        <SectionHeading
          id="network-map"
          eyebrow="Live map"
          title="Where the crowds are right now"
          description="The TransitPulse crowd layer drawn on Google Maps: corridor tint is the predicted crowd band, markers are the simulated fleet."
          icon={MapPinned}
          actions={<LivePill label="Crowd layer" />}
        />
        <OperatorNetworkMap heightClass="h-[320px] sm:h-[400px] xl:h-[460px]" />
      </section>

      {/* --------------------------------------- next journey + network pressure */}
      <div className="grid gap-5 xl:grid-cols-[1.12fr_1fr]">
        <Card accent="pulse" className="flex flex-col">
          <CardHeader
            title={nextJourney ? nextJourney.label : 'No saved journey yet'}
            subtitle={
              nextJourney
                ? `${nextJourney.origin.name} → ${nextJourney.destination.name}`
                : 'Save a journey in Settings to get a live recommendation here'
            }
            icon={<TrainFront className="size-4" />}
            actions={<LivePill label="Forecast" />}
          />

          <CardBody className="flex flex-1 flex-col">
            {isLoading ? (
              <PanelSkeleton rows={3} />
            ) : bestOption && nextJourney ? (
              <div className="flex flex-1 flex-col gap-4">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                  <div className="flex items-end gap-4">
                    <div>
                      <p className="eyebrow text-mist-500">Board at</p>
                      <p className="mt-1 font-display text-display-md leading-none font-semibold text-mist-100">
                        {formatClock(bestOption.departAt)}
                      </p>
                    </div>
                    <div className="pb-1 text-2xs leading-relaxed text-mist-400">
                      <p className="figure">Arrives {formatClock(bestOption.arriveAt)}</p>
                      <p className="figure">{formatDuration(bestOption.totalMinutes)} · {bestOption.transfers === 0 ? 'direct' : `${bestOption.transfers} change`}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-start gap-1.5 sm:items-end">
                    <Badge tone="pulse" size="xs" icon={<Sparkles className="size-3" />} dot live>
                      AI recommended
                    </Badge>
                    <CrowdBadge
                      level={bestOption.crowdRiskLevel}
                      label={`Peak ${formatPercent(bestOption.crowdRisk)}`}
                      size="xs"
                    />
                    <span className="figure text-3xs text-mist-500">
                      score {bestOption.score.toFixed(0)}
                    </span>
                  </div>
                </div>

                <p className="rounded-xl border border-pulse-400/18 bg-pulse-400/[0.07] px-3.5 py-3 text-sm leading-relaxed text-mist-200">
                  {bestOption.headline}
                </p>

                <LegTimeline legs={bestOption.legs} />

                <div className="mt-auto flex flex-wrap gap-2 pt-1">
                  <Button
                    variant="primary"
                    size="sm"
                    iconRight={<ArrowRight className="size-3.5" aria-hidden />}
                    onClick={() =>
                      navigate(
                        `/routes/details?origin=${nextJourney.origin.id}&destination=${
                          nextJourney.destination.id
                        }&option=${bestOption.id}&lineId=${bestOption.legs[0]?.lineId ?? ''}&stopId=${
                          bestOption.legs[0]?.fromStopId ?? ''
                        }`,
                      )
                    }
                  >
                    Open boarding plan
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => navigate('/routes')}>
                    Compare all options
                  </Button>
                </div>
              </div>
            ) : (
              <EmptyState
                compact
                title="No journey to recommend yet"
                description="Save a regular trip and TransitPulse will forecast crowding for it automatically."
                icon={<Bookmark className="size-5" />}
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<ArrowRight className="size-3.5" aria-hidden />}
                    onClick={() => navigate('/settings')}
                  >
                    Add a saved journey
                  </Button>
                }
              />
            )}
          </CardBody>
        </Card>

        <Card className="flex flex-col">
          <CardHeader
            title="Network pressure right now"
            subtitle="Highest measured load per line, from live telemetry"
            icon={<Gauge className="size-4" />}
            actions={<LivePill />}
          />
          <CardBody className="flex-1">
            {isLoading ? (
              <PanelSkeleton rows={4} />
            ) : data?.crowdingNow.length ? (
              <>
                <CrowdHotspotList hotspots={data.crowdingNow} />
                <CrowdLegend className="mt-4 border-t border-white/6 pt-3" />
              </>
            ) : (
              <EmptyState
                compact
                title="No live readings yet"
                description="The network has no measured load in the current service window."
                icon={<Gauge className="size-5" />}
              />
            )}
          </CardBody>
        </Card>
      </div>

      {/* --------------------------------------------- boards + alerts (2 columns) */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Departure boards"
            subtitle="Predicted load for every service leaving your stops"
            icon={<Clock className="size-4" />}
          />
          <CardBody className="space-y-5">
            {isLoading ? (
              <PanelSkeleton rows={4} />
            ) : data?.stationBoards.length ? (
              data.stationBoards.map((board) => (
                <div key={board.stop.id}>
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <p className="text-xs font-semibold tracking-wide text-mist-200 uppercase">
                      {board.stop.name}
                    </p>
                    <span className="figure text-3xs text-mist-500">{board.stop.code}</span>
                  </div>
                  <ul className="space-y-2">
                    {board.departures.slice(0, 4).map((departure) => (
                      <DepartureRow
                        key={`${departure.lineId}-${departure.departureAt}`}
                        departure={departure}
                      />
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <EmptyState
                compact
                title="No upcoming departures"
                description="Nothing is scheduled to leave your saved stops in the next window."
                icon={<Clock className="size-5" />}
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Service alerts"
            subtitle="Notices currently reaching riders"
            icon={<BellRing className="size-4" />}
            actions={
              <Button size="sm" variant="ghost" onClick={() => navigate('/alerts')}>
                All alerts
              </Button>
            }
          />
          <CardBody className="space-y-2.5">
            {isLoading ? (
              <PanelSkeleton rows={3} />
            ) : data?.activeAlerts.length ? (
              data.activeAlerts.map((alert) => {
                const tone = severityTone(alert.severity);
                return (
                  <div key={alert.id} className={cn('rounded-xl border px-3.5 py-3', tone.border, tone.bg)}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn('text-2xs font-semibold tracking-wide uppercase', tone.text)}>
                        {tone.label}
                        {alert.lineCode ? ` · Line ${alert.lineCode}` : ''}
                      </span>
                      <span className="figure text-3xs text-mist-500">{formatClock(alert.startsAt)}</span>
                    </div>
                    <p className="mt-1.5 text-xs font-medium text-mist-100">{alert.title}</p>
                    <p className="mt-1 line-clamp-2 text-2xs leading-relaxed text-mist-400">{alert.body}</p>
                  </div>
                );
              })
            ) : (
              <EmptyState
                compact
                title="No active alerts"
                description="The network is running normally — nothing to report for your stops."
                icon={<BellRing className="size-5" />}
              />
            )}
          </CardBody>
        </Card>
      </div>

      {/* ---------------------------------------------------------- saved journeys */}
      <Card>
        <CardHeader
          title="Saved journeys"
          subtitle="Live crowd snapshot for each saved trip, refreshed every 45 seconds"
          icon={<Bookmark className="size-4" />}
          actions={
            <Button size="sm" variant="outline" onClick={() => navigate('/settings')}>
              Manage
            </Button>
          }
        />
        <CardBody>
          {isLoading ? (
            <PanelSkeleton rows={2} />
          ) : data?.watchlist.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.watchlist.map((item) => (
                <WatchlistCard
                  key={item.id}
                  item={item}
                  onPlan={() =>
                    navigate(
                      `/routes?origin=${item.originStopId}&destination=${item.destinationStopId}${
                        item.avoidCrowded ? '&avoidCrowding=true' : ''
                      }`,
                    )
                  }
                  onToggle={() => toggleWatchlist.mutate(item.id)}
                  onDelete={() => deleteWatchlist.mutate(item.id)}
                  busy={toggleWatchlist.isPending || deleteWatchlist.isPending}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No saved journeys yet"
              description="Add a regular trip from Settings and TransitPulse will keep forecasting its crowding."
              icon={<Bookmark className="size-5" />}
              action={
                <Button size="sm" variant="outline" onClick={() => navigate('/settings')}>
                  Add a saved journey
                </Button>
              }
            />
          )}
        </CardBody>
      </Card>

      <p className="pb-2 text-center text-3xs leading-relaxed text-mist-600">
        Every figure on this page is served by the TransitPulse API from Postgres
        {data?.model
          ? ` · model ${data.model.version} (${Math.round(data.model.accuracy * 100)}% backtest accuracy on simulated data)`
          : ''}
      </p>
    </div>
  );
}

function DepartureRow({ departure }: { departure: UpcomingDeparture }) {
  return (
    <li className="group flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 transition-colors hover:border-white/14 hover:bg-white/[0.04]">
      <span
        className="grid size-9 shrink-0 place-items-center rounded-lg text-2xs font-bold text-ink-950"
        style={{ backgroundColor: departure.lineColor }}
      >
        {departure.lineCode.slice(0, 3)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-xs text-mist-200">
            {departure.lineName}
            <span className="ml-1.5 text-3xs text-mist-500">
              {departure.direction === 0 ? 'outbound' : 'inbound'}
            </span>
          </p>
          <span className="figure shrink-0 text-xs text-mist-100">{departure.minutesAway}′</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <CrowdMeter
            ratio={departure.prediction.ratio}
            level={departure.prediction.level}
            height="sm"
            className="flex-1"
          />
          <span className="figure text-3xs text-mist-400">{formatPercent(departure.prediction.ratio)}</span>
        </div>
      </div>
      {departure.isRecommended ? (
        <Badge tone="pulse" size="xs">
          Quieter
        </Badge>
      ) : null}
    </li>
  );
}

function WatchlistCard({
  item,
  onPlan,
  onToggle,
  onDelete,
  busy,
}: {
  item: WatchlistItem;
  onPlan: () => void;
  onToggle: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const prediction = item.prediction;
  return (
    <div className="flex flex-col rounded-xl border border-white/8 bg-white/[0.02] p-3.5 transition-colors hover:border-white/14">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-mist-100">{item.label}</p>
          <p className="mt-0.5 truncate text-2xs text-mist-400">
            {item.originStopName} → {item.destinationStopName}
          </p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          aria-label={`Delete ${item.label}`}
          className="rounded-lg p-1.5 text-mist-500 transition-colors hover:bg-crowd-critical/15 hover:text-crowd-critical focus-visible:bg-crowd-critical/15 disabled:opacity-50"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      </div>

      <div className="mt-2.5 flex items-center gap-2 text-2xs text-mist-500">
        <Clock className="size-3" aria-hidden />
        {item.departTime ?? 'Anytime'}
        <span className="text-mist-600">·</span>
        <span className="figure">{item.days.map((day) => day.slice(0, 1).toUpperCase()).join('')}</span>
      </div>

      {prediction ? (
        <div className="mt-3 rounded-lg border border-white/8 bg-ink-900/50 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-2xs text-mist-300">
              <span className="size-2 rounded-full" style={{ backgroundColor: prediction.lineColor }} aria-hidden />
              <span className="figure">{prediction.lineCode}</span>
            </span>
            <CrowdBadge level={prediction.level} ratio={prediction.ratio} size="xs" />
          </div>
          <CrowdMeter ratio={prediction.ratio} level={prediction.level} height="sm" className="mt-2" />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-3xs text-mist-500">{prediction.status}</span>
            <ConfidencePill value={prediction.confidence} />
          </div>
        </div>
      ) : (
        <p className="mt-3 rounded-lg border border-dashed border-white/10 px-3 py-2.5 text-3xs text-mist-500">
          No service found for that departure time today.
        </p>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
        <Badge tone={item.avoidCrowded ? 'low' : 'neutral'} size="xs" icon={<Users className="size-3" />}>
          {item.avoidCrowded ? 'Crowd-aware' : 'Time only'}
        </Badge>
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={onToggle} disabled={busy}>
            Toggle
          </Button>
          <Button size="sm" variant="outline" onClick={onPlan}>
            Routes
          </Button>
        </div>
      </div>
    </div>
  );
}
