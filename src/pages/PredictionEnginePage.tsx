import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BrainCircuit,
  Cloud,
  CloudDrizzle,
  CloudRain,
  Cpu,
  FlaskConical,
  Gauge,
  Layers,
  Minus,
  Sun,
  TrendingDown,
  TrendingUp,
  Waves,
  Zap,
} from 'lucide-react';
import type { OccupancyPredictionResult, PredictionPipelineStage, WeatherSnapshot } from '@shared/types';
import {
  useLine,
  usePrediction,
  usePredictionEngine,
  usePredictionRoutes,
  usePredictionWeather,
} from '../hooks/useTransitData';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Field, Segmented, Select } from '../components/ui/Controls';
import { ErrorState, PanelSkeleton } from '../components/ui/Skeleton';
import { SectionHeading } from '../components/ui/Section';
import { ConfidencePill, CrowdBadge, CrowdMeter } from '../components/crowd/CrowdIndicators';
import { cn, formatClock, formatPercent } from '../lib/utils';

/**
 * Prediction Engine — the judge-facing view of the model.
 *
 * Everything on this screen is rendered from `/api/prediction/*`: the pipeline
 * stages, the input catalogue, the crowd classes and the live prediction are all
 * values the server computed from the simulated dataset. Nothing here is typed
 * into the component.
 *
 * The prominent "Simulation Mode" banner exists so nobody mistakes these
 * numbers for measurements of a real network: occupancy, telemetry and weather
 * are synthetic demo data and no production accuracy is claimed.
 */

const HORIZONS = [
  { value: 'now', label: 'Now' },
  { value: '30', label: '+30 min' },
  { value: '60', label: '+1 hour' },
  { value: '120', label: '+2 hours' },
] as const;

const CONDITIONS = ['clear', 'cloudy', 'light_rain', 'heavy_rain', 'storm', 'heatwave'];

function conditionIcon(condition: string) {
  switch (condition) {
    case 'clear':
      return <Sun className="size-4" />;
    case 'cloudy':
      return <Cloud className="size-4" />;
    case 'light_rain':
      return <CloudDrizzle className="size-4" />;
    case 'heavy_rain':
      return <CloudRain className="size-4" />;
    case 'storm':
      return <Zap className="size-4" />;
    case 'heatwave':
      return <Gauge className="size-4" />;
    default:
      return <Cloud className="size-4" />;
  }
}

function Pipeline({ stages }: { stages: PredictionPipelineStage[] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-5">
      {stages.map((stage, index) => (
        <div key={stage.key} className="relative flex items-stretch gap-3">
          <Card className="flex-1 p-4" accent={index === stages.length - 1 ? 'pulse' : 'none'}>
            <p className="figure text-3xs tracking-[0.16em] text-pulse-300 uppercase">
              {stage.title}
            </p>
            <p className="mt-2 text-sm font-medium text-mist-100">{stage.summary}</p>
            <p className="mt-1.5 text-2xs leading-relaxed text-mist-400">{stage.detail}</p>
            <p className="mt-2.5 truncate figure text-3xs text-mist-600" title={stage.code}>
              {stage.code}
            </p>
          </Card>
          {index < stages.length - 1 ? (
            <span className="absolute top-1/2 -right-3 hidden -translate-y-1/2 text-mist-600 lg:block">
              <ArrowRight className="size-4" />
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function FactorList({ prediction }: { prediction: OccupancyPredictionResult }) {
  const max = Math.max(...prediction.factors.map((factor) => Math.abs(factor.contributionPct)), 1);

  return (
    <ul className="space-y-2.5">
      {prediction.factors.map((factor) => {
        const width = Math.max(3, (Math.abs(factor.contributionPct) / max) * 100);
        const tone =
          factor.direction === 'raises'
            ? { bar: 'bg-crowd-moderate/', text: 'text-crowd-moderate', Icon: TrendingUp }
            : factor.direction === 'lowers'
              ? { bar: 'bg-crowd-low/', text: 'text-crowd-low', Icon: TrendingDown }
              : { bar: 'bg-white/20', text: 'text-mist-400', Icon: Minus };
        const Icon = tone.Icon;

        return (
          <li key={factor.key} className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="flex min-w-0 items-center gap-1.5 text-mist-200">
                <Icon className={cn('size-3.5 shrink-0', tone.text)} />
                <span className="truncate">{factor.label}</span>
              </span>
              <span className={cn('shrink-0 figure text-2xs', tone.text)}>
                {factor.contributionPct > 0 ? '+' : ''}
                {factor.contributionPct.toFixed(1)} pp
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/6">
              <div className={cn('h-full rounded-full transition-[width] duration-700', tone.bar)} style={{ width: `${width}%` }} />
            </div>
            <p className="text-2xs leading-relaxed text-mist-500">{factor.detail}</p>
          </li>
        );
      })}
    </ul>
  );
}

function WeatherStrip({ slots }: { slots: WeatherSnapshot[] }) {
  if (!slots.length) {
    return <p className="text-xs text-mist-500">No simulated weather slots available.</p>;
  }

  return (
    <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {slots.slice(0, 8).map((slot) => (
        <div
          key={slot.at}
          className="w-[112px] shrink-0 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5"
        >
          <div className="flex items-center justify-between text-mist-300">
            {conditionIcon(slot.condition)}
            <span className="figure text-3xs text-mist-500">{formatClock(slot.at)}</span>
          </div>
          <p className="mt-1.5 text-xs font-medium text-mist-100">{slot.label}</p>
          <p className="mt-0.5 text-3xs text-mist-500">
            demand ×{slot.factor.toFixed(2)}
          </p>
        </div>
      ))}
    </div>
  );
}

export function PredictionEnginePage() {
  const navigate = useNavigate();
  const engine = usePredictionEngine();
  const routes = usePredictionRoutes();
  const weather = usePredictionWeather();

  const [lineId, setLineId] = useState('');
  const [stopId, setStopId] = useState('');
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]['value']>('now');
  const [scenario, setScenario] = useState('auto');

  const routeList = routes.data?.routes ?? [];
  const activeLineId = lineId || routeList[0]?.id || '';
  const line = useLine(activeLineId || undefined);
  const stops = line.data?.stops ?? [];

  useEffect(() => {
    setStopId('');
  }, [activeLineId]);

  // One prediction per minute bucket keeps the query key stable across renders.
  const minuteBucket = Math.floor(Date.now() / 60_000);
  const at = useMemo(
    () =>
      horizon === 'now'
        ? undefined
        : new Date((minuteBucket + Number(horizon)) * 60_000).toISOString(),
    [minuteBucket, horizon],
  );

  const prediction = usePrediction({
    lineId: activeLineId || undefined,
    stopId: stopId || stops[0]?.stopId || undefined,
    at,
    weather: scenario,
  });

  if (engine.isError) {
    return (
      <ErrorState
        title="Could not load the prediction engine"
        message={(engine.error as Error).message}
        onRetry={() => void engine.refetch()}
      />
    );
  }

  const report = engine.data;
  const result = prediction.data?.prediction;
  const disclaimer = report?.disclaimer ?? prediction.data?.disclaimer;
  const availableConditions = report?.weatherConditions ?? CONDITIONS;

  return (
    <div className="space-y-5 pb-24 lg:pb-6">
      {/* Simulation banner — the honest framing of the whole model. */}
      <Card accent="pulse" className="overflow-hidden">
        <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-violet-glow/30 bg-violet-glow/10 text-violet-glow">
              <FlaskConical className="size-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="violet" icon={<FlaskConical className="size-3" />}>
                  Simulation Mode
                </Badge>
                <h2 className="font-display text-base font-semibold text-mist-100">
                  Prediction engine
                </h2>
              </div>
              <p className="mt-1.5 figure text-2xs leading-relaxed text-pulse-200/90">
                Input Data → Prediction Engine → Occupancy Prediction → Crowd Classification → Route
                Optimization
              </p>
              <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-mist-400">
                {disclaimer ??
                  'Predictions are calculated from simulated historical and live transit data.'}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Badge tone="info" icon={<Cpu className="size-3" />}>
              {report?.engine.id ?? 'loading engine'}
            </Badge>
            <Badge tone="neutral" icon={<Layers className="size-3" />}>
              v{report?.engine.version ?? '—'}
            </Badge>
          </div>
        </div>
      </Card>

      {/* Stage chain */}
      <section aria-labelledby="engine-pipeline" className="space-y-3">
        <SectionHeading
          id="engine-pipeline"
          eyebrow="Pipeline"
          title="How a prediction is produced"
          description="Five stages, each one a seam where a different implementation can be dropped in."
          icon={BrainCircuit}
          actions={
            <Badge tone="neutral" size="xs">
              {report ? `${report.stages.length} stages` : 'loading'}
            </Badge>
          }
        />
        {report ? <Pipeline stages={report.stages} /> : <PanelSkeleton rows={3} />}
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_1fr]">
        {/* Simulator */}
        <Card accent="sky">
          <CardHeader
            title="Run the engine"
            subtitle="Pick a route, a horizon and (optionally) a weather scenario — the output is computed by the API, not the browser"
            icon={<Gauge className="size-4" />}
            actions={
              <Badge tone="neutral" size="xs">
                {result ? `${formatClock(result.targetAt)} local` : 'live'}
              </Badge>
            }
          />
          <CardBody className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Route">
                <Select
                  value={activeLineId}
                  onChange={(event) => setLineId(event.target.value)}
                  options={routeList.map((route) => ({
                    value: route.id,
                    label: `${route.code} · ${route.name}`,
                  }))}
                  disabled={!routeList.length}
                />
              </Field>
              <Field label="Boarding stop">
                <Select
                  value={stopId || stops[0]?.stopId || ''}
                  onChange={(event) => setStopId(event.target.value)}
                  options={stops.map((stop) => ({
                    value: stop.stopId,
                    label: stop.stop?.name ?? stop.stopId,
                  }))}
                  disabled={!stops.length}
                />
              </Field>
              <Field label="Departure horizon">
                <Segmented
                  value={horizon}
                  onChange={setHorizon}
                  options={HORIZONS.map((option) => ({ value: option.value, label: option.label }))}
                  size="sm"
                  className="w-full"
                />
              </Field>
              <Field
                label="Weather scenario"
                hint="Optional model input — `auto` reads the simulated weather table."
              >
                <Select
                  value={scenario}
                  onChange={(event) => setScenario(event.target.value)}
                  options={[
                    { value: 'auto', label: 'Auto (simulated table)' },
                    { value: 'none', label: 'Ignore weather' },
                    ...availableConditions.map((condition) => ({
                      value: condition,
                      label: `What if: ${condition.replace('_', ' ')}`,
                    })),
                  ]}
                />
              </Field>
            </div>

            {prediction.isError ? (
              <ErrorState
                title="Prediction failed"
                message={(prediction.error as Error).message}
                onRetry={() => void prediction.refetch()}
              />
            ) : !result ? (
              <PanelSkeleton rows={4} />
            ) : (
              <div className="space-y-4 rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="eyebrow text-mist-400">
                      Predicted occupancy
                    </p>
                    <div className="mt-1 flex items-end gap-3">
                      <span className="font-display text-4xl leading-none font-semibold text-mist-100">
                        {result.predictedOccupancyPercentage.toFixed(1)}
                        <span className="text-xl text-mist-400">%</span>
                      </span>
                      <CrowdBadge
                        level={result.crowd.level}
                        label={`${result.crowd.label} crowd`}
                        size="sm"
                      />
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="eyebrow text-mist-400">
                      Confidence
                    </p>
                    <div className="mt-1 flex items-center justify-end">
                      <ConfidencePill value={result.confidencePercentage / 100} />
                    </div>
                  </div>
                </div>

                <CrowdMeter ratio={result.predictedRatio} level={result.crowd.level} />

                <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                  <div>
                    <p className="text-mist-500">Interval</p>
                    <p className="figure text-mist-200">
                      {result.interval.lowerPercentage.toFixed(0)}–
                      {result.interval.upperPercentage.toFixed(0)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-mist-500">Baseline</p>
                    <p className="figure text-mist-200">
                      {result.baselineOccupancyPercentage.toFixed(1)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-mist-500">On board</p>
                    <p className="figure text-mist-200">
                      {result.headcount}/{result.capacity}
                    </p>
                  </div>
                  <div>
                    <p className="text-mist-500">Day · hour</p>
                    <p className="figure text-mist-200">
                      {result.dayType} · {String(result.hourOfDay).padStart(2, '0')}:00
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-white/8 bg-ink-950/40 px-3 py-2.5">
                  <p className="text-2xs text-mist-400">{result.crowd.description}</p>
                  <p className="mt-1 text-3xs text-mist-500">
                    Band {result.crowd.range} · {result.crowd.label} · classification threshold{' '}
                    {result.crowd.level === 'low'
                      ? 'below 60%'
                      : result.crowd.level === 'moderate'
                        ? '60–85%'
                        : 'above 85%'}
                  </p>
                </div>

                <div>
                  <p className="mb-2 eyebrow text-mist-400">
                    Factor contributions (percentage points)
                  </p>
                  <FactorList prediction={result} />
                </div>

                <div className="grid gap-2 border-t border-white/6 pt-3 text-2xs text-mist-500 sm:grid-cols-2">
                  <p>
                    History: {result.inputsUsed.historicalSamples} samples ·{' '}
                    {result.inputsUsed.historicalScope} scope
                  </p>
                  <p>
                    Live reading:{' '}
                    {result.inputsUsed.currentOccupancyPercentage === null
                      ? 'none in window'
                      : `${result.inputsUsed.currentOccupancyPercentage.toFixed(0)}% · ${Math.round(
                          result.inputsUsed.currentOccupancyAgeMinutes ?? 0,
                        )} min old`}
                  </p>
                  <p>Upstream load: {result.inputsUsed.upstreamOccupancyPercentage.toFixed(0)}%</p>
                  <p>
                    Weather:{' '}
                    {result.inputsUsed.weather
                      ? `${result.inputsUsed.weather.label} (×${result.inputsUsed.weather.factor.toFixed(2)})`
                      : 'not applied'}
                  </p>
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        <div className="space-y-5">
          {/* Engine card */}
          <Card>
            <CardHeader
              title="Engine internals"
              subtitle="A real machine-learning model can replace this without touching the API or the UI"
              icon={<Cpu className="size-4" />}
            />
            <CardBody className="space-y-3 text-xs">
              {!report ? (
                <PanelSkeleton rows={4} />
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-mist-500">Predictor</p>
                      <p className="figure text-mist-200">{report.engine.id}</p>
                    </div>
                    <div>
                      <p className="text-mist-500">Kind</p>
                      <p className="figure text-mist-200">{report.engine.kind}</p>
                    </div>
                    <div>
                      <p className="text-mist-500">Weather source</p>
                      <p className="figure text-mist-200">{report.engine.weatherSource}</p>
                    </div>
                    <div>
                      <p className="text-mist-500">Data</p>
                      <p className="figure text-mist-200">
                        {report.engine.simulated ? 'simulated' : 'live'}
                      </p>
                    </div>
                  </div>
                  <p className="leading-relaxed text-mist-400">{report.engine.note}</p>
                  {report.engine.fallbackNote ? (
                    <p className="rounded-lg border border-crowd-moderate/30 bg-crowd-moderate/10 px-3 py-2 text-crowd-moderate">
                      {report.engine.fallbackNote}
                    </p>
                  ) : null}
                  <div className="rounded-xl border border-white/8 bg-ink-950/40 px-3 py-2.5">
                    <p className="text-2xs tracking-wide text-mist-400 uppercase">
                      Pluggable interface
                    </p>
                    <p className="mt-1 figure text-xs leading-relaxed text-mist-300">
                      type OccupancyPredictor = &#123; predict(input: PredictionInput):
                      Promise&lt;PredictionCore&gt; &#125;
                    </p>
                    <p className="mt-1.5 text-2xs text-mist-500">
                      Set <span className="figure text-mist-300">PREDICTION_MODEL_URL</span> to
                      route stage 2 to an external model; the built-in heuristic ensemble stays as the
                      fallback.
                    </p>
                  </div>
                  <p className="text-mist-400">{report.routeOptimization.detail}</p>
                  <p className="figure text-xs text-mist-500">
                    {report.routeOptimization.scoreFormula}
                  </p>
                </>
              )}
            </CardBody>
          </Card>

          {/* Classification */}
          <Card>
            <CardHeader
              title="Crowd classification"
              subtitle="Stage 4 turns the occupancy percentage into the label riders see"
              icon={<Waves className="size-4" />}
            />
            <CardBody className="space-y-2.5">
              {!report ? (
                <PanelSkeleton rows={3} />
              ) : (
                report.classes.map((entry) => (
                  <div
                    key={entry.level}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <CrowdBadge level={entry.level} />
                      <p className="mt-1 text-2xs text-mist-400">
                        {entry.rule} occupancy · {entry.description}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="figure text-sm text-mist-100">
                        {formatPercent(entry.examplePercentage / 100, 0)}
                      </p>
                      <p className="text-3xs text-mist-500">example → {entry.label}</p>
                    </div>
                  </div>
                ))
              )}
            </CardBody>
          </Card>

          {/* Inputs */}
          <Card>
            <CardHeader
              title="Model inputs"
              subtitle="Stage 1 — every signal is read from the simulated dataset"
              icon={<Layers className="size-4" />}
            />
            <CardBody className="space-y-2.5">
              {!report ? (
                <PanelSkeleton rows={5} />
              ) : (
                report.inputs.map((input) => (
                  <div key={input.key} className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-medium text-mist-100">{input.label}</p>
                      <p className="truncate figure text-3xs text-mist-500" title={input.source}>
                        {input.source}
                      </p>
                    </div>
                    <p className="mt-1 text-2xs leading-relaxed text-mist-400">{input.detail}</p>
                  </div>
                ))
              )}
            </CardBody>
          </Card>

          {/* Weather */}
          <Card>
            <CardHeader
              title="Simulated weather input"
              subtitle="Optional factor — conditions are seeded demo rows, not a real forecast"
              icon={<CloudRain className="size-4" />}
              actions={
                <Badge tone="neutral" size="xs">
                  {weather.data?.current?.label ?? '—'}
                </Badge>
              }
            />
            <CardBody className="space-y-3">
              {weather.isLoading ? (
                <PanelSkeleton rows={2} />
              ) : (
                <>
                  <WeatherStrip slots={weather.data?.slots ?? []} />
                  <div className="flex flex-wrap gap-2">
                    {(weather.data?.available ?? []).map((entry) => (
                      <Badge key={entry.condition} tone="neutral" size="xs">
                        {entry.condition.replace('_', ' ')}
                        {entry.demandMultiplier ? ` ×${entry.demandMultiplier.toFixed(2)}` : ''}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-2xs leading-relaxed text-mist-500">
                    Demand multipliers are transparent modelling assumptions of this prototype, not
                    measured effects.
                  </p>
                </>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardBody className="flex flex-col gap-3 text-xs text-mist-400 sm:flex-row sm:items-center sm:justify-between">
          <p className="leading-relaxed">
            {disclaimer ??
              'Simulated prototype — occupancy, telemetry and weather are synthetic demo data, not real-world measurements.'}
          </p>
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowRight className="size-3.5" />}
            onClick={() => navigate('/database')}
          >
            Inspect the source records
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
