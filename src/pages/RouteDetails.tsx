import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Brain,
  CalendarClock,
  Coins,
  Footprints,
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
import { EmptyState, ErrorState, PanelSkeleton } from '../components/ui/Skeleton';
import { CrowdBadge, CrowdLegend, CrowdMeter, ConfidencePill } from '../components/crowd/CrowdIndicators';
import { ForecastChart } from '../components/crowd/ForecastChart';
import { FactorBreakdown } from '../components/crowd/FactorBreakdown';
import { LegTimeline } from '../components/route/LegTimeline';
import { ScoreBreakdown } from '../components/route/ScoreBreakdown';
import { LivePill } from '../components/crowd/CrowdHotspotList';
import { cn, crowdTone, formatClock, formatDuration, formatPercent } from '../lib/utils';

type DetailTab = 'plan' | 'forecast' | 'model' | 'line';

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

  const forecast = useForecast(
    context.data?.line.id,
    context.data?.stop.id,
    120,
  );

  if (!origin || !destination) {
    return (
      <EmptyState
        title="No itinerary selected"
        description="Pick a journey on the Plan screen, then open a boarding plan from the results."
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
        message={(plan.error as Error).message}
        onRetry={() => void plan.refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button size="icon" variant="secondary" aria-label="Back to results" onClick={() => navigate(-1)}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h2 className="font-display text-lg font-semibold text-mist-100">
              {plan.data ? `${plan.data.origin.name} → ${plan.data.destination.name}` : 'Journey'}
            </h2>
            <p className="text-xs text-mist-400">
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

      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        {/* Left: itinerary + tabs */}
        <div className="space-y-4">
          {plan.isLoading || !option ? (
            <PanelSkeleton rows={4} />
          ) : (
            <>
              <Card accent="pulse">
                <CardHeader
                  title="Boarding plan"
                  subtitle={option.headline}
                  icon={<RouteIcon className="size-4" />}
                  actions={<CrowdBadge level={option.crowdRiskLevel} label={`Peak ${formatPercent(option.crowdRisk)}`} />}
                />
                <CardBody className="space-y-4">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Metric icon={<CalendarClock className="size-3.5" />} label="Depart" value={formatClock(option.departAt)} />
                    <Metric icon={<CalendarClock className="size-3.5" />} label="Arrive" value={formatClock(option.arriveAt)} />
                    <Metric icon={<Footprints className="size-3.5" />} label="Walking" value={`${option.walkMinutes} min`} />
                    <Metric icon={<Coins className="size-3.5" />} label="Fare" value={option.fare.toFixed(2)} />
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-[0.68rem] text-mist-400">
                      <span>Peak predicted load across this itinerary</span>
                      <span className="font-mono">
                        {formatPercent(option.crowdRisk)} · avg {formatPercent(option.avgCrowdRatio)}
                      </span>
                    </div>
                    <CrowdMeter ratio={option.crowdRisk} level={option.crowdRiskLevel} />
                  </div>

                  <LegTimeline legs={option.legs} expanded />
                </CardBody>
              </Card>

              <Segmented<DetailTab>
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'forecast', label: 'Crowd forecast', icon: <Sparkles className="size-3.5" /> },
                  { value: 'model', label: 'Model breakdown', icon: <Brain className="size-3.5" /> },
                  { value: 'line', label: 'Line & stops', icon: <MapPin className="size-3.5" /> },
                  { value: 'plan', label: 'Trade-offs', icon: <Scale className="size-3.5" /> },
                ]}
              />

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
                  />
                  <CardBody className="space-y-4">
                    {!lineId || !stopId ? (
                      <EmptyState
                        title="Choose a leg"
                        description="Open a boarding plan from the results screen to see its forecast."
                      />
                    ) : forecast.isLoading ? (
                      <PanelSkeleton rows={2} />
                    ) : forecast.data ? (
                      <>
                        <ForecastChart
                          points={forecast.data.points}
                          history={forecast.data.baseline}
                        />
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-3">
                            <p className="text-[0.62rem] tracking-wider text-mist-500 uppercase">
                              In 10 minutes
                            </p>
                            <p className={cn('mt-1 font-display text-2xl font-semibold', crowdTone(forecast.data.headline.level).text)}>
                              {formatPercent(forecast.data.headline.ratio)}
                            </p>
                            <p className="mt-0.5 text-[0.68rem] text-mist-400">
                              {forecast.data.headline.headcount}/{forecast.data.headline.capacity} riders
                            </p>
                          </div>
                          <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-3">
                            <p className="text-[0.62rem] tracking-wider text-mist-500 uppercase">
                              Model quality
                            </p>
                            <p className="mt-1 font-display text-2xl font-semibold text-mist-100">
                              {Math.round(forecast.data.accuracy * 100)}%
                            </p>
                            <p className="mt-0.5 text-[0.68rem] text-mist-400">
                              {forecast.data.sampleSize} historical samples for this hour
                            </p>
                          </div>
                          <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-3">
                            <p className="text-[0.62rem] tracking-wider text-mist-500 uppercase">
                              Horizon
                            </p>
                            <p className="mt-1 font-display text-2xl font-semibold text-mist-100">
                              {Math.max(...forecast.data.points.map((point) => point.horizonMinutes))}
                              <span className="ml-1 text-xs font-normal text-mist-400">min</span>
                            </p>
                            <p className="mt-0.5 text-[0.68rem] text-mist-400">
                              {forecast.data.modelVersion}
                            </p>
                          </div>
                        </div>
                        <CrowdLegend />
                        <p className="text-[0.68rem] leading-relaxed text-mist-500">
                          Solid line shows measured occupancy over the last 24 hours; the accent line
                          is the model forecast with an 80% prediction interval. Predictions are
                          stored back into <span className="font-mono">crowd_forecasts</span>.
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
                    subtitle={`${forecast.data.modelVersion} · driven by ${forecast.data.factors.length} live signals`}
                    icon={<Brain className="size-4" />}
                    actions={<ConfidencePill value={forecast.data.headline.confidence} />}
                  />
                  <CardBody>
                    <FactorBreakdown factors={forecast.data.factors} />
                  </CardBody>
                </Card>
              ) : null}

              {tab === 'line' ? (
                <Card>
                  <CardHeader
                    title={context.data ? `${context.data.line.code} ${context.data.line.name}` : 'Line information'}
                    subtitle={
                      context.data
                        ? `${context.data.line.mode.toUpperCase()} · every ${context.data.line.headwayMinutes} min · ${
                            network?.stops.length ?? 0
                          } stops in network`
                        : undefined
                    }
                    icon={<MapPin className="size-4" />}
                  />
                  <CardBody className="space-y-4">
                    {context.isLoading ? (
                      <PanelSkeleton rows={2} />
                    ) : context.data ? (
                      <>
                        <div className="flex flex-wrap gap-2">
                          <Badge tone="neutral">{context.data.line.capacityPerVehicle} capacity</Badge>
                          <Badge tone="neutral">every {context.data.line.headwayMinutes} min</Badge>
                          <Badge tone="pulse">{context.data.line.mode}</Badge>
                        </div>
                        <ol className="space-y-1.5">
                          <LineStops lineId={context.data.line.id} />
                        </ol>
                        {context.data.alerts.length ? (
                          <div className="space-y-2 border-t border-white/6 pt-3">
                            <p className="text-[0.68rem] tracking-wider text-mist-500 uppercase">
                              Active notices on this line
                            </p>
                            {context.data.alerts.map((alert) => (
                              <div
                                key={alert.id}
                                className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5"
                              >
                                <p className="text-xs font-medium text-mist-100">{alert.title}</p>
                                <p className="mt-0.5 text-[0.68rem] leading-relaxed text-mist-400">
                                  {alert.body}
                                </p>
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
                                  Math.min(
                                    ...plan.data!.options.map((entry) => entry.totalMinutes),
                                  ),
                            )
                      }
                    />
                    <ul className="space-y-2 border-t border-white/6 pt-3">
                      {option.rationale.map((line) => (
                        <li key={line} className="flex gap-2 text-[0.72rem] leading-relaxed text-mist-300">
                          <span className="mt-1.5 size-1 shrink-0 rounded-full bg-pulse-400" />
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

        {/* Right: rider context + alternatives */}
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Your routing profile"
              subtitle="Alerts and weights adapt to these preferences"
              icon={<Users className="size-4" />}
            />
            <CardBody className="space-y-2 text-[0.72rem]">
              {profile.isLoading ? (
                <PanelSkeleton rows={3} />
              ) : profile.data ? (
                <>
                  <Row label="Rider" value={profile.data.displayName} />
                  <Row
                    label="Crowd tolerance"
                    value={`${Math.round(profile.data.crowdTolerance * 100)}% (${describeTolerance(profile.data.crowdTolerance)})`}
                  />
                  <Row label="Max changes" value={String(profile.data.maxTransfers)} />
                  <Row label="Max walking" value={`${profile.data.maxWalkMinutes} min`} />
                  <Row
                    label="Preferred modes"
                    value={profile.data.preferredModes.length ? profile.data.preferredModes.join(', ') : 'Any'}
                  />
                  <Row
                    label="Alert threshold"
                    value={`${Math.round(profile.data.crowdThresholdAlert * 100)}% occupancy`}
                  />
                </>
              ) : (
                <p className="text-mist-500">Profile unavailable.</p>
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
              ) : (
                plan.data?.options.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => {
                      const params = new URLSearchParams(searchParams);
                      params.set('option', candidate.id);
                      const firstLeg = candidate.legs.find((leg) => leg.kind === 'transit');
                      if (firstLeg?.lineId) params.set('lineId', firstLeg.lineId);
                      if (firstLeg?.fromStopId) params.set('stopId', firstLeg.fromStopId);
                      navigate(`/routes/details?${params.toString()}`);
                    }}
                    className={cn(
                      'w-full rounded-xl border px-3.5 py-3 text-left transition',
                      candidate.id === option?.id
                        ? 'border-pulse-400/40 bg-pulse-400/8'
                        : 'border-white/8 bg-white/[0.02] hover:border-white/16',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Badge
                        tone={
                          candidate.kind === 'best'
                            ? 'pulse'
                            : candidate.kind === 'quietest'
                              ? 'low'
                              : candidate.kind === 'fastest'
                                ? 'info'
                                : 'neutral'
                        }
                        size="xs"
                      >
                        {candidate.badgeLabel}
                      </Badge>
                      <span className="font-mono text-[0.7rem] text-mist-300">
                        {formatDuration(candidate.totalMinutes)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <CrowdMeter ratio={candidate.crowdRisk} level={candidate.crowdRiskLevel} height="sm" className="flex-1" />
                      <span className="font-mono text-[0.68rem] text-mist-400">
                        {formatPercent(candidate.crowdRisk)}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-[0.68rem] leading-relaxed text-mist-400">
                      {candidate.headline}
                    </p>
                  </button>
                ))
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
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-3xl font-semibold text-crowd-low">
                    {option.co2SavedKg.toFixed(2)}
                  </span>
                  <span className="text-xs text-mist-400">
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 pb-2 last:border-0">
      <span className="text-mist-500">{label}</span>
      <span className="text-right font-medium text-mist-200">{value}</span>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[0.62rem] tracking-wider text-mist-500 uppercase">
        {icon}
        {label}
      </p>
      <p className="mt-1 font-mono text-sm text-mist-100">{value}</p>
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
          <li key={entry.stopId} className="flex items-center justify-between gap-2.5 text-[0.72rem]">
            <span className="flex items-center gap-2.5">
              <span className="grid size-5 shrink-0 place-items-center rounded-md border border-white/10 bg-white/5 font-mono text-[0.6rem] text-mist-400">
                {index + 1}
              </span>
              <span className="text-mist-200">{entry.stop?.name ?? entry.stopId}</span>
            </span>
            <span className="font-mono text-[0.65rem] text-mist-500">+{cumulative} min</span>
          </li>
        );
      })}
    </>
  );
}
