import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Compass,
  Info,
  Lightbulb,
  Sparkles,
  TrendingDown,
  TriangleAlert,
} from 'lucide-react';
import type { RecommendationKind, RouteOption } from '@shared/types';
import { useNetwork, usePlan } from '../hooks/useTransitData';
import { JourneyPlanner, type PlannerValues } from '../components/route/JourneyPlanner';
import { RouteOptionCard } from '../components/route/RouteOptionCard';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Segmented } from '../components/ui/Controls';
import { EmptyState, ErrorState, PanelSkeleton } from '../components/ui/Skeleton';
import { CrowdLegend } from '../components/crowd/CrowdIndicators';
import { LivePill } from '../components/crowd/CrowdHotspotList';
import { cn, formatClock, formatDuration, formatPercent } from '../lib/utils';

type SortMode = 'recommended' | RecommendationKind | 'quietest';

export function RouteResults() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: network } = useNetwork();

  const origin = searchParams.get('origin') ?? '';
  const destination = searchParams.get('destination') ?? '';
  const departAfter = searchParams.get('departAfter') ?? undefined;
  const avoidCrowding = searchParams.get('avoidCrowding') !== 'false';
  const maxTransfers = Number(searchParams.get('maxTransfers') ?? 1);

  const [values, setValues] = useState<PlannerValues>(() => ({
    originStopId: origin,
    destinationStopId: destination,
    departMode: departAfter ? 'later' : 'now',
    departTime: departAfter
      ? formatClock(departAfter)
      : formatClock(new Date(Date.now() + 30 * 60000)),
    avoidCrowding,
    maxTransfers,
  }));
  const [sort, setSort] = useState<SortMode>('recommended');

  useEffect(() => {
    setValues((previous) => ({
      ...previous,
      originStopId: origin,
      destinationStopId: destination,
      avoidCrowding,
      maxTransfers,
      departMode: departAfter ? 'later' : 'now',
      departTime: departAfter ? formatClock(departAfter) : previous.departTime,
    }));
  }, [origin, destination, departAfter, avoidCrowding, maxTransfers]);

  const plan = usePlan({
    origin,
    destination,
    departAfter,
    avoidCrowding,
    maxTransfers,
    enabled: Boolean(origin && destination),
  });

  const options = useMemo(() => {
    const list = plan.data?.options ?? [];
    if (sort === 'recommended') return list;
    if (sort === 'fastest') return [...list].sort((a, b) => a.totalMinutes - b.totalMinutes);
    if (sort === 'quietest') return [...list].sort((a, b) => a.crowdRisk - b.crowdRisk);
    if (sort === 'fewest_transfers')
      return [...list].sort((a, b) => a.transfers - b.transfers || a.totalMinutes - b.totalMinutes);
    return list;
  }, [plan.data?.options, sort]);

  const recommended = plan.data?.options.find(
    (option) => option.id === plan.data?.recommendedOptionId,
  );
  const worst = plan.data?.options.find((option) => option.id === plan.data?.worstOptionId);

  const openDetails = (option: RouteOption): void => {
    const firstLeg = option.legs.find((leg) => leg.kind === 'transit');
    const params = new URLSearchParams(searchParams);
    params.set('option', option.id);
    if (firstLeg?.lineId) params.set('lineId', firstLeg.lineId);
    if (firstLeg?.fromStopId) params.set('stopId', firstLeg.fromStopId);
    navigate(`/routes/details?${params.toString()}`);
  };

  const submit = (): void => {
    const params = new URLSearchParams({
      origin: values.originStopId,
      destination: values.destinationStopId,
      avoidCrowding: String(values.avoidCrowding),
      maxTransfers: String(values.maxTransfers),
    });
    if (values.departMode === 'later' && values.departTime) {
      params.set(
        'departAfter',
        new Date(`${new Date().toISOString().slice(0, 10)}T${values.departTime}:00`).toISOString(),
      );
    }
    setSearchParams(params);
  };

  const hasQuery = Boolean(origin && destination);

  return (
    <div className="space-y-5">
      <JourneyPlanner
        values={values}
        onChange={(patch) => setValues((previous) => ({ ...previous, ...patch }))}
        onSubmit={submit}
        loading={plan.isFetching}
        quickPicks={network?.stops.slice(0, 6)}
      />

      {!hasQuery ? (
        <EmptyState
          icon={<Compass className="size-5" />}
          title="Choose a start and end stop"
          description="TransitPulse will generate crowd-aware itineraries using the timetable and the live crowd model."
        />
      ) : plan.isError ? (
        <ErrorState
          title="Could not plan that journey"
          message={(plan.error as Error).message}
          onRetry={() => void plan.refetch()}
        />
      ) : plan.isLoading ? (
        <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
          <PanelSkeleton rows={4} />
          <PanelSkeleton rows={3} />
        </div>
      ) : plan.data && plan.data.options.length === 0 ? (
        <EmptyState
          title="No service found"
          description={plan.data.insights[0] ?? 'Try increasing the number of allowed changes.'}
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const params = new URLSearchParams(searchParams);
                params.set('maxTransfers', String(Math.min(3, maxTransfers + 1)));
                setSearchParams(params);
              }}
            >
              Allow one more change
            </Button>
          }
        />
      ) : plan.data ? (
        <div className="grid gap-5 xl:grid-cols-[1.65fr_1fr]">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold text-mist-100">
                  {plan.data.options.length} crowd-aware option
                  {plan.data.options.length === 1 ? '' : 's'}
                </h2>
                <p className="mt-0.5 text-xs text-mist-400">
                  {plan.data.origin.name} → {plan.data.destination.name} · departing{' '}
                  {formatClock(plan.data.departAfter)}
                  {avoidCrowding ? ' · crowding weighted' : ' · time only'}
                </p>
              </div>
              <Segmented<SortMode>
                size="sm"
                value={sort}
                onChange={setSort}
                options={[
                  { value: 'recommended', label: 'Recommended' },
                  { value: 'fastest', label: 'Fastest' },
                  { value: 'quietest', label: 'Quietest' },
                  { value: 'fewest_transfers', label: 'Fewest changes' },
                ]}
              />
            </div>

            {options.map((option, index) => (
              <RouteOptionCard
                key={option.id}
                option={option}
                isRecommended={option.id === plan.data?.recommendedOptionId}
                onOpen={() => openDetails(option)}
                style={{ animationDelay: `${index * 70}ms` }}
              />
            ))}
          </div>

          {/* Side rail: why these options, and what they avoid */}
          <div className="space-y-4">
            <Card accent="pulse">
              <CardHeader
                title="Why this recommendation"
                subtitle={`Model ${plan.data.modelVersion} · scored on time, crowding, changes and walking`}
                icon={<Sparkles className="size-4" />}
                actions={<LivePill label="Scored" />}
              />
              <CardBody className="space-y-3">
                {recommended ? (
                  <div className="rounded-xl border border-pulse-400/25 bg-pulse-400/8 px-3.5 py-3">
                    <p className="text-sm leading-relaxed text-mist-100">{recommended.headline}</p>
                    <ul className="mt-2 space-y-1">
                      {recommended.rationale.map((line) => (
                        <li key={line} className="flex gap-2 text-[0.7rem] leading-relaxed text-mist-300">
                          <span className="mt-1.5 size-1 shrink-0 rounded-full bg-pulse-400" />
                          {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {recommended && worst && worst.id !== recommended.id ? (
                  <div className="rounded-xl border border-crowd-critical/20 bg-crowd-critical/8 px-3.5 py-3">
                    <p className="flex items-center gap-2 text-[0.7rem] font-semibold text-crowd-critical">
                      <TriangleAlert className="size-3.5" />
                      What you avoid
                    </p>
                    <p className="mt-1.5 text-[0.72rem] leading-relaxed text-mist-300">
                      The busiest itinerary on this corridor peaks at{' '}
                      <span className="font-mono text-mist-100">
                        {formatPercent(worst.crowdRisk)}
                      </span>{' '}
                      — about{' '}
                      <span className="font-mono text-crowd-low">
                        {Math.round(recommended.crowdingAvoidedPct)}%
                      </span>{' '}
                      busier than the recommendation, for{' '}
                      {Math.abs(worst.totalMinutes - recommended.totalMinutes)} min{' '}
                      {worst.totalMinutes < recommended.totalMinutes ? 'saved' : 'extra'}.
                    </p>
                  </div>
                ) : null}

                <ul className="space-y-2">
                  {plan.data.insights.map((insight) => (
                    <li
                      key={insight}
                      className="flex gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 text-[0.72rem] leading-relaxed text-mist-300"
                    >
                      <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-crowd-moderate" />
                      {insight}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Crowding scale"
                subtitle="Occupancy is riders on board ÷ vehicle capacity"
                icon={<Info className="size-4" />}
              />
              <CardBody className="space-y-3">
                <CrowdLegend />
                <div className="grid grid-cols-2 gap-2 text-[0.68rem]">
                  <Metric
                    label="Recommended peak"
                    value={recommended ? formatPercent(recommended.crowdRisk) : '—'}
                    tone="low"
                  />
                  <Metric
                    label="Busiest option"
                    value={worst ? formatPercent(worst.crowdRisk) : '—'}
                    tone="critical"
                  />
                  <Metric
                    label="Recommended time"
                    value={recommended ? formatDuration(recommended.totalMinutes) : '—'}
                  />
                  <Metric
                    label="Fastest option"
                    value={
                      options.length
                        ? formatDuration(Math.min(...options.map((option) => option.totalMinutes)))
                        : '—'
                    }
                  />
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Optimize your trip"
                subtitle="Model-suggested tweaks to the recommendation"
                icon={<TrendingDown className="size-4" />}
              />
              <CardBody className="space-y-2">
                {[15, 30, 45].map((offset) => (
                  <button
                    key={offset}
                    type="button"
                    onClick={() => {
                      const params = new URLSearchParams(searchParams);
                      params.set(
                        'departAfter',
                        new Date(Date.now() + offset * 60000).toISOString(),
                      );
                      setSearchParams(params);
                    }}
                    className="flex w-full items-center justify-between rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 text-left transition hover:border-pulse-400/40 hover:bg-white/[0.05]"
                  >
                    <span className="text-xs text-mist-200">
                      Leave in {offset} minutes
                    </span>
                    <ArrowRight className="size-3.5 text-mist-500" />
                  </button>
                ))}
                <p className="pt-1 text-[0.68rem] leading-relaxed text-mist-500">
                  Re-planning shows whether waiting for the next service buys a quieter carriage.
                </p>
              </CardBody>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'low' | 'critical' }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2">
      <p className="text-[0.62rem] tracking-wider text-mist-500 uppercase">{label}</p>
      <p
        className={cn(
          'mt-0.5 font-mono text-sm',
          tone === 'low' ? 'text-crowd-low' : tone === 'critical' ? 'text-crowd-critical' : 'text-mist-100',
        )}
      >
        {value}
      </p>
    </div>
  );
}

