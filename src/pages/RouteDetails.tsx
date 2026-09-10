import { useMemo, useState } from 'react';
import { NavLink, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Brain,
  FlaskConical,
  Leaf,
  MapPin,
  Route as RouteIcon,
  Scale,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  useForecast,
  useJourneyContext,
  useLine,
  useNetwork,
  usePlan,
  useProfile,
} from '../hooks/useTransitData';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Segmented } from '../components/ui/Controls';
import { InfoRow, Metric } from '../components/ui/Section';
import { EmptyState, ErrorState, PanelSkeleton } from '../components/ui/Skeleton';
import { CrowdBadge, CrowdLegend, CrowdMeter, ConfidencePill } from '../components/crowd/CrowdIndicators';
import { ForecastChart } from '../components/crowd/ForecastChart';
import { FactorBreakdown } from '../components/crowd/FactorBreakdown';
import { LegTimeline } from '../components/route/LegTimeline';
import { JourneyMap } from '../components/map/JourneyMap';
import { ScoreBreakdown } from '../components/route/ScoreBreakdown';
import { OccupancyPredictionCard } from '../components/route/OccupancyPredictionCard';
import { LivePill } from '../components/crowd/CrowdHotspotList';
import { cn, formatClock, formatDuration, formatPercent } from '../lib/utils';

type DetailTab = 'plan' | 'forecast' | 'model' | 'line';

const KIND_TONE = {
  best: 'pulse',
  quietest: 'low',
  fastest: 'info',
  fewest_changes: 'neutral',
} as const;

export function RouteDetails() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<DetailTab>('plan');

  const origin = searchParams.get('origin') ?? '';
  const destination = searchParams.get('destination') ?? '';
  const departAfter = searchParams.get('departAfter') ?? undefined;
  const optionId = searchParams.get('option') ?? undefined;
  const lineId = searchParams.get('lineId') ?? undefined;
  const stopId = searchParams.get('stopId') ?? undefined;

  const plan = usePlan({ origin, destination, departAfter, enabled: Boolean(origin && destination) });
  const context = useJourneyContext(lineId, stopId);
  const profile = useProfile();
  const { data: network } = useNetwork();

  const option = useMemo(() => {
    const options = plan.data?.options ?? [];
    if (!options.length) return undefined;
    return (
      options.find((candidate) => candidate.id === optionId) ??
      options.find((candidate) => candidate.id === plan.data?.recommendedOptionId) ??
      options[0]
    );
  }, [plan.data, optionId]);

  const recommended = plan.data?.options.find(
    (candidate) => candidate.id === plan.data?.recommendedOptionId,
  );

  const forecast = useForecast(context.data?.line.id, context.data?.stop.id, 120);

  if (!origin || !destination) {
    return (
      <EmptyState
        title="No itinerary selected"
        description="Pick a journey on the Plan screen, then open a boarding plan from the results."
        icon={<RouteIcon className="size-5" />}
        action={
          <Button size="sm" variant="outline" onClick={() => navigate('/routes')}>
            Plan a journey
          </Button>
        }
      />
    );
  }

  if (plan.isError) {
    return (
      <ErrorState
        title="Could not rebuild this itinerary"
        error={plan.error}
        onRetry={() => void plan.refetch()}
      />
    );
  }

  const peakHorizon = forecast.data
    ? Math.max(...forecast.data.points.map((point) => point.horizonMinutes))
    : 0;

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------------- header */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-start gap-3">
          <Button
            size="icon"
            variant="secondary"
            aria-label="Back to results"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="size-4" aria-hidden />
          </Button>
          <div className="min-w-0">
            <p className="eyebrow text-mist-500">Boarding plan</p>
            <h2 className="mt-0.5 font-display text-lg font-semibold text-mist-100">
              {plan.data ? `${plan.data.origin.name} → ${plan.data.destination.name}` : 'Journey'}
            </h2>
            <p className="mt-1 text-2xs text-mist-400">
              {option
                ? `${option.badgeLabel} · departs ${formatClock(option.departAt)} · arrives ${formatClock(option.arriveAt)}`
                : 'Rebuilding itinerary from the timetable…'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LivePill label="Live forecast" />
          <Button size="sm" variant="outline" onClick={() => navigate('/routes')}>
            Compare options
          </Button>
        </div>
      </div>

      {/* -------------------------------------------------------------- map */}
      {plan.data && plan.data.options.length ? (
        <JourneyMap
          origin={origin}
          destination={destination}
          departAfter={departAfter}
          options={plan.data.options}
          selectedOptionId={option?.id ?? null}
          onSelectOption={(optionId) => {
            const params = new URLSearchParams(searchParams);
            params.set('option', optionId);
            navigate(`/routes/details?${params.toString()}`);
          }}
          heightClass="h-[300px] sm:h-[380px] lg:h-[440px]"
          title="Route on the map"
          subtitle={
            option
              ? `${option.lineCodes.filter(Boolean).join(' → ')} · peak ${formatPercent(option.crowdRisk)} predicted`
              : undefined
          }
          footer={
            <span>
              Click any leg or stop to read its measured occupancy, forecast, confidence and expected
              trend. Switching itinerary re-draws the map.
            </span>
          }
        />
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
        {/* ------------------------------------------- left: itinerary + tabs */}
        <div className="space-y-4">
          {plan.isLoading || !option ? (
            <PanelSkeleton rows={5} />
          ) : (
            <>
              <Card accent="pulse">
                <CardHeader
                  title="Boarding plan"
                  subtitle={option.headline}
                  icon={<RouteIcon className="size-4" />}
                  actions={
                    <CrowdBadge
                      level={option.crowdRiskLevel}
                      label={`Peak ${formatPercent(option.crowdRisk)}`}
                    />
                  }
                />
                <CardBody className="space-y-4">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Metric
                      label="Depart"
                      value={formatClock(option.departAt)}
                      hint={`Platform boarding at ${plan.data?.origin.name ?? 'origin'}`}
                    />
                    <Metric
                      label="Arrive"
                      value={formatClock(option.arriveAt)}
                      hint={formatDuration(option.totalMinutes)}
                    />
                    <Metric
                      label="Walking"
                      value={option.walkMinutes}
                      unit="min"
                      hint="Access and interchange walking"
                    />
                    <Metric
                      label="Fare"
                      value={option.fare.toFixed(2)}
                      unit="₹"
                      hint="Single journey, cashless"
                    />
                  </div>

                  <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-2xs text-mist-400">
                        Peak predicted load across this itinerary
                      </span>
                      <span className="figure text-2xs text-mist-300">
                        {formatPercent(option.crowdRisk)} peak · {formatPercent(option.avgCrowdRatio)} avg
                      </span>
                    </div>
                    <CrowdMeter ratio={option.crowdRisk} level={option.crowdRiskLevel} />
                  </div>

                  <LegTimeline legs={option.legs} expanded />
                </CardBody>
              </Card>

              <OccupancyPredictionCard option={option} />

              <div className="scrollbar-none -mx-1 overflow-x-auto px-1">
                <Segmented<DetailTab>
                  value={tab}
                  onChange={setTab}
                  options={[
                    {
                      value: 'forecast',
                      label: 'Crowd forecast',
                      icon: <Sparkles className="size-3.5" aria-hidden />,
                    },
                    {
                      value: 'model',
                      label: 'Model breakdown',
                      icon: <Brain className="size-3.5" aria-hidden />,
                    },
                    {
                      value: 'line',
                      label: 'Line & stops',
                      icon: <MapPin className="size-3.5" aria-hidden />,
                    },
                    {
                      value: 'plan',
                      label: 'Trade-offs',
                      icon: <Scale className="size-3.5" aria-hidden />,
                    },
                  ]}
                />
              </div>

              {tab === 'forecast' ? (
                <Card>
                  <CardHeader
                    title="Predicted load before you board"
                    subtitle={
                      context.data
                        ? `${context.data.line.code} ${context.data.line.name} at ${context.data.stop.name}`
                        : 'Select a leg to inspect its forecast'
                    }
                    icon={<Sparkles className="size-4" />}
                    actions={<LivePill label="Model" />}
                  />
                  <CardBody className="space-y-4">
                    {!lineId || !stopId ? (
                      <EmptyState
                        compact
                        title="Choose a leg"
                        description="Open a boarding plan from the results screen to see its forecast."
                        icon={<MapPin className="size-5" />}
                      />
                    ) : forecast.isLoading ? (
                      <PanelSkeleton rows={3} />
                    ) : forecast.data ? (
                      <>
                        <ForecastChart points={forecast.data.points} history={forecast.data.baseline} />
                        <div className="grid gap-2 sm:grid-cols-3">
                          <Metric
                            label="In 10 minutes"
                            value={formatPercent(forecast.data.headline.ratio)}
                            tone={forecast.data.headline.level === 'high' ? 'high' : forecast.data.headline.level === 'moderate' ? 'moderate' : 'low'}
                            hint={`${forecast.data.headline.headcount}/${forecast.data.headline.capacity} riders on board`}
                          />
                          <Metric
                            label="Model quality"
                            value={`${Math.round(forecast.data.accuracy * 100)}%`}
                            hint={`${forecast.data.sampleSize} historical samples for this hour`}
                          />
                          <Metric
                            label="Horizon"
                            value={peakHorizon}
                            unit="min"
                            hint={forecast.data.modelVersion}
                          />
                        </div>
                        <CrowdLegend className="border-t border-white/6 pt-3" />
                        <p className="text-3xs leading-relaxed text-mist-500">
                          Solid line shows measured occupancy over the last 24 hours; the accent line is
                          the model forecast with an 80% prediction interval. Predictions are stored back
                          into <span className="figure">crowd_forecasts</span>. Simulated demo data.
                        </p>
                      </>
                    ) : (
                      <ErrorState title="No forecast available for this leg" />
                    )}
                  </CardBody>
                </Card>
              ) : null}

              {tab === 'model' && forecast.data ? (
                <Card>
                  <CardHeader
                    title="Why the model predicts this"
                    subtitle={
                      forecast.data.engine
                        ? `${forecast.data.engine.id} ${forecast.data.engine.version} · driven by ${forecast.data.factors.length} live signals`
                        : `${forecast.data.modelVersion} · driven by ${forecast.data.factors.length} live signals`
                    }
                    icon={<Brain className="size-4" />}
                    actions={
                      <div className="flex items-center gap-2">
                        <NavLink to="/engine" title="All predictions use simulated demo data">
                          <Badge tone="violet" size="xs" icon={<FlaskConical className="size-3" />}>
                            Simulation Mode
                          </Badge>
                        </NavLink>
                        <ConfidencePill value={forecast.data.headline.confidence} />
                      </div>
                    }
                  />
                  <CardBody className="space-y-3">
                    <FactorBreakdown factors={forecast.data.factors} />
                    <p className="border-t border-white/6 pt-3 text-3xs leading-relaxed text-mist-500">
                      {forecast.data.engine
                        ? `${forecast.data.engine.note} Weather input: ${forecast.data.engine.weatherSource}.`
                        : 'Predictions are calculated from simulated historical and live transit data.'}
                    </p>
                  </CardBody>
                </Card>
              ) : null}

              {tab === 'line' ? (
                <Card>
                  <CardHeader
                    title={
                      context.data
                        ? `${context.data.line.code} ${context.data.line.name}`
                        : 'Line information'
                    }
                    subtitle={
                      context.data
                        ? `${context.data.line.mode.toUpperCase()} · every ${context.data.line.headwayMinutes} min · ${network?.stops.length ?? 0} stops in network`
                        : undefined
                    }
                    icon={<MapPin className="size-4" />}
                  />
                  <CardBody className="space-y-4">
                    {context.isLoading ? (
                      <PanelSkeleton rows={3} />
                    ) : context.data ? (
                      <>
                        <div className="flex flex-wrap gap-2">
                          <Badge tone="neutral">{context.data.line.capacityPerVehicle} capacity</Badge>
                          <Badge tone="neutral">every {context.data.line.headwayMinutes} min</Badge>
                          <Badge tone="violet">{context.data.line.mode}</Badge>
                        </div>
                        <ol className="space-y-1.5">
                          <LineStops lineId={context.data.line.id} />
                        </ol>
                        {context.data.alerts.length ? (
                          <div className="space-y-2 border-t border-white/6 pt-3">
                            <p className="eyebrow text-mist-500">Active notices on this line</p>
                            {context.data.alerts.map((alert) => (
                              <div
                                key={alert.id}
                                className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5"
                              >
                                <p className="text-xs font-medium text-mist-100">{alert.title}</p>
                                <p className="mt-1 text-2xs leading-relaxed text-mist-400">{alert.body}</p>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <ErrorState title="Line data unavailable" />
                    )}
                  </CardBody>
                </Card>
              ) : null}

              {tab === 'plan' && option ? (
                <Card>
                  <CardHeader
                    title="How this itinerary was ranked"
                    subtitle="Weighted objective terms from model_config.planner_weights"
                    icon={<Scale className="size-4" />}
                  />
                  <CardBody className="space-y-4">
                    <ScoreBreakdown
                      option={option}
                      compareTo={
                        recommended && recommended.id !== option.id
                          ? recommended
                          : plan.data?.options.find(
                              (candidate) =>
                                candidate.id !== option.id &&
                                candidate.totalMinutes ===
                                  Math.min(...plan.data!.options.map((entry) => entry.totalMinutes)),
                            )
                      }
                    />
                    <ul className="space-y-2 border-t border-white/6 pt-3">
                      {option.rationale.map((line) => (
                        <li key={line} className="flex gap-2 text-2xs leading-relaxed text-mist-300">
                          <span className="mt-1.5 size-1 shrink-0 rounded-full bg-pulse-400" aria-hidden />
                          {line}
                        </li>
                      ))}
                    </ul>
                  </CardBody>
                </Card>
              ) : null}
            </>
          )}
        </div>

        {/* ------------------------- right: rider context + alternatives ----- */}
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Your routing profile"
              subtitle="Alerts and weights adapt to these preferences"
              icon={<Users className="size-4" />}
            />
            <CardBody>
              {profile.isLoading ? (
                <PanelSkeleton rows={3} />
              ) : profile.data ? (
                <div className="divide-y divide-white/5">
                  <InfoRow label="Rider" value={profile.data.displayName} />
                  <InfoRow
                    label="Crowd tolerance"
                    value={`${Math.round(profile.data.crowdTolerance * 100)}% (${describeTolerance(profile.data.crowdTolerance)})`}
                  />
                  <InfoRow label="Max changes" value={String(profile.data.maxTransfers)} />
                  <InfoRow label="Max walking" value={`${profile.data.maxWalkMinutes} min`} />
                  <InfoRow
                    label="Preferred modes"
                    value={
                      profile.data.preferredModes.length
                        ? profile.data.preferredModes.join(', ')
                        : 'Any'
                    }
                  />
                  <InfoRow
                    label="Alert threshold"
                    value={`${Math.round(profile.data.crowdThresholdAlert * 100)}% occupancy`}
                  />
                </div>
              ) : (
                <p className="text-xs text-mist-500">Profile unavailable.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Alternatives on this corridor"
              subtitle="Same origin and destination, different trade-offs"
              icon={<RouteIcon className="size-4" />}
            />
            <CardBody className="space-y-2">
              {plan.isLoading ? (
                <PanelSkeleton rows={3} />
              ) : plan.data?.options.length ? (
                plan.data.options.map((candidate) => {
                  const active = candidate.id === option?.id;
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      aria-current={active}
                      onClick={() => {
                        const params = new URLSearchParams(searchParams);
                        params.set('option', candidate.id);
                        const firstLeg = candidate.legs.find((leg) => leg.kind === 'transit');
                        if (firstLeg?.lineId) params.set('lineId', firstLeg.lineId);
                        if (firstLeg?.fromStopId) params.set('stopId', firstLeg.fromStopId);
                        navigate(`/routes/details?${params.toString()}`);
                      }}
                      className={cn(
                        'w-full rounded-xl border px-3.5 py-3 text-left transition-[border-color,background-color,transform] duration-200',
                        active
                          ? 'border-pulse-400/40 bg-pulse-400/[0.08]'
                          : 'border-white/8 bg-white/[0.02] hover:-translate-y-px hover:border-white/16 hover:bg-white/[0.045]',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Badge tone={KIND_TONE[candidate.kind as keyof typeof KIND_TONE] ?? 'neutral'} size="xs">
                          {candidate.badgeLabel}
                        </Badge>
                        <span className="figure text-2xs text-mist-300">
                          {formatDuration(candidate.totalMinutes)}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <CrowdMeter
                          ratio={candidate.crowdRisk}
                          level={candidate.crowdRiskLevel}
                          height="sm"
                          className="flex-1"
                        />
                        <span className="figure text-3xs text-mist-400">
                          {formatPercent(candidate.crowdRisk)} peak
                        </span>
                      </div>
                      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-3xs text-mist-500">
                        <span className="figure">{candidate.routeNumber}</span>
                        <span className="figure">arrives {formatClock(candidate.arriveAt)}</span>
                        <span className="figure">{candidate.confidencePct}% confidence</span>
                        {candidate.crowdingAvoidedPct > 5 ? (
                          <span className="text-crowd-low">
                            avoids {Math.round(candidate.crowdingAvoidedPct)}% crowding
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-1.5 line-clamp-2 text-2xs leading-relaxed text-mist-400">
                        {candidate.headline}
                      </p>
                    </button>
                  );
                })
              ) : (
                <EmptyState
                  compact
                  title="No other options"
                  description="This is the only itinerary the planner found for that departure time."
                  icon={<RouteIcon className="size-5" />}
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Sustainability"
              subtitle="Compared with driving the same distance"
              icon={<Leaf className="size-4" />}
            />
            <CardBody>
              {option ? (
                <div className="flex items-baseline gap-2" data-figures>
                  <span className="font-display text-3xl leading-none font-semibold text-crowd-low">
                    {option.co2SavedKg.toFixed(2)}
                  </span>
                  <span className="text-xs leading-relaxed text-mist-400">
                    kg CO₂ avoided vs. a single-occupancy car
                  </span>
                </div>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function describeTolerance(value: number): string {
  if (value >= 1) return 'happy to stand';
  if (value >= 0.8) return 'prefers a seat';
  if (value >= 0.6) return 'needs space';
  return 'strictly low crowding';
}

/**
 * Stop sequence for the selected line, served by `/api/lines/:id` (the
 * `line_stops` table). Rendered in order with running travel times.
 */
function LineStops({ lineId }: { lineId: string }) {
  const { data, isLoading } = useLine(lineId);

  if (isLoading) return <PanelSkeleton rows={2} />;
  if (!data) return <p className="text-xs text-mist-500">Stop sequence unavailable.</p>;

  let cumulative = 0;
  return (
    <>
      {data.stops.map((entry, index) => {
        cumulative += index === 0 ? 0 : entry.travelMinutesFromPrev;
        return (
          <li key={entry.stopId} className="flex items-center justify-between gap-2.5 text-2xs">
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="figure grid size-5 shrink-0 place-items-center rounded-md border border-white/10 bg-white/5 text-3xs text-mist-400">
                {index + 1}
              </span>
              <span className="truncate text-mist-200">{entry.stop?.name ?? entry.stopId}</span>
            </span>
            <span className="figure shrink-0 text-3xs text-mist-500">+{cumulative} min</span>
          </li>
        );
      })}
    </>
  );
}
