import { useId, useState } from 'react';
import { ArrowLeftRight, CalendarClock, ChevronDown, Clock, MapPin, Sparkles, Zap } from 'lucide-react';
import { StopPicker } from './StopPicker';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Select, Toggle } from '../ui/Controls';
import { cn } from '../../lib/utils';

export interface PlannerValues {
  originStopId: string;
  destinationStopId: string;
  departMode: 'now' | 'later';
  departTime: string;
  avoidCrowding: boolean;
  maxTransfers: number;
}

export interface QuickJourney {
  label: string;
  originStopId: string;
  destinationStopId: string;
}

/**
 * The commuter search panel: From → To → Departure time → "Find Best Route".
 *
 * Kept intentionally to three inputs so the whole flow can be demonstrated in
 * under a minute — routing preferences live behind the options toggle. It is a
 * real `<form>`, so Enter submits and screen readers get standard semantics.
 */
export function JourneyPlanner({
  values,
  onChange,
  onSubmit,
  loading,
  className,
  quickPicks,
  quickJourneys,
  compact = false,
  tone = 'hero',
}: {
  values: PlannerValues;
  onChange: (patch: Partial<PlannerValues>) => void;
  onSubmit: () => void;
  loading?: boolean;
  className?: string;
  quickPicks?: { id: string; name: string }[];
  /** One-tap demo journeys, resolved from stops in the database. */
  quickJourneys?: QuickJourney[];
  compact?: boolean;
  tone?: 'hero' | 'panel';
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const optionsId = useId();

  const sameStop =
    Boolean(values.originStopId) && values.originStopId === values.destinationStopId;
  const disabled = !values.originStopId || !values.destinationStopId || sameStop;

  return (
    <Card
      accent="pulse"
      tone={tone === 'hero' ? 'strong' : 'glass'}
      className={cn(tone === 'hero' ? 'p-5 sm:p-6' : 'p-4', 'scroll-mt-24', className)}
    >
      {!compact && (
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 shrink-0 text-pulse-300" aria-hidden />
              <h2 className="font-display text-base font-semibold text-mist-100">Plan a journey</h2>
            </div>
            <p className="mt-1 max-w-md text-xs leading-relaxed text-mist-400">
              TransitPulse predicts how full each service will be at your boarding time, then picks
              the option that keeps you comfortable.
            </p>
          </div>
          <span className="hidden shrink-0 rounded-full border border-pulse-400/25 bg-pulse-400/8 px-2.5 py-1 text-2xs font-medium text-pulse-300 sm:inline-flex">
            Predict · Avoid · Optimize
          </span>
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled) onSubmit();
        }}
        className="space-y-4"
      >
        {/* -------------------------------------------------- the three inputs */}
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.05fr)_auto_minmax(0,1.05fr)_auto] lg:items-end">
          <StopPicker
            label="From"
            value={values.originStopId}
            onChange={(originStopId) => onChange({ originStopId })}
            quickPicks={quickPicks}
          />

          <Button
            variant="secondary"
            size="icon"
            type="button"
            className="self-start lg:mb-1 lg:self-auto"
            aria-label="Swap origin and destination"
            title="Swap origin and destination"
            onClick={() =>
              onChange({
                originStopId: values.destinationStopId,
                destinationStopId: values.originStopId,
              })
            }
          >
            <ArrowLeftRight className="size-4" aria-hidden />
          </Button>

          <StopPicker
            label="To"
            value={values.destinationStopId}
            onChange={(destinationStopId) => onChange({ destinationStopId })}
            quickPicks={quickPicks}
          />

          <fieldset className="min-w-0 space-y-1.5 lg:min-w-[13.25rem]">
            <legend className="mb-1.5 flex items-center gap-1.5 text-2xs font-medium tracking-wider text-mist-400 uppercase">
              <Clock className="size-3" aria-hidden />
              Departure time
            </legend>
            <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-ink-900/60 p-1 focus-within:border-pulse-400/40">
              {(['now', 'later'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={values.departMode === mode}
                  onClick={() => onChange({ departMode: mode })}
                  className={cn(
                    'inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors duration-200',
                    values.departMode === mode
                      ? 'bg-white/12 text-mist-100 inset-highlight'
                      : 'text-mist-400 hover:bg-white/4 hover:text-mist-200',
                  )}
                >
                  {mode === 'now' ? (
                    <Zap className="size-3.5" aria-hidden />
                  ) : (
                    <CalendarClock className="size-3.5" aria-hidden />
                  )}
                  {mode === 'now' ? 'Now' : 'Leave at'}
                </button>
              ))}
              {values.departMode === 'later' ? (
                <input
                  type="time"
                  aria-label="Departure time (24 hour)"
                  value={values.departTime}
                  onChange={(event) => onChange({ departTime: event.target.value })}
                  className="figure w-[5.75rem] rounded-lg bg-white/6 px-2 py-2 text-xs text-mist-100 outline-none focus-visible:bg-white/10"
                />
              ) : null}
            </div>
          </fieldset>
        </div>

        {/* ----------------------------------------------------------- actions */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={loading}
            disabled={disabled}
            icon={<Sparkles className="size-4" aria-hidden />}
            className="w-full sm:w-auto"
          >
            Find Best Route
          </Button>

          <button
            type="button"
            onClick={() => setShowAdvanced((previous) => !previous)}
            aria-expanded={showAdvanced}
            aria-controls={optionsId}
            className="inline-flex items-center gap-1 text-xs text-mist-400 transition-colors hover:text-mist-200"
          >
            {showAdvanced ? 'Hide options' : 'Routing options'}
            <ChevronDown
              className={cn('size-3.5 transition-transform duration-200', showAdvanced && 'rotate-180')}
              aria-hidden
            />
          </button>

          <p className="ml-auto hidden text-2xs text-mist-500 sm:block">
            {values.avoidCrowding
              ? 'Optimising for comfort and time'
              : 'Optimising for the fastest arrival'}
          </p>
        </div>

        {disabled && values.originStopId && values.destinationStopId && sameStop ? (
          <p role="status" className="text-2xs text-crowd-moderate">
            Pick two different stops to plan a journey.
          </p>
        ) : null}
      </form>

      {quickJourneys?.length ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/8 pt-3.5">
          <span className="eyebrow text-mist-500">Try</span>
          {quickJourneys.map((journey) => {
            const active =
              values.originStopId === journey.originStopId &&
              values.destinationStopId === journey.destinationStopId;
            return (
              <button
                key={journey.label}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  onChange({
                    originStopId: journey.originStopId,
                    destinationStopId: journey.destinationStopId,
                  })
                }
                className={cn(
                  'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs transition-colors duration-200',
                  active
                    ? 'border-pulse-400/45 bg-pulse-400/12 text-pulse-100'
                    : 'border-white/10 bg-white/4 text-mist-300 hover:border-white/20 hover:text-mist-100',
                )}
              >
                <MapPin className="size-3 shrink-0" aria-hidden />
                <span className="truncate">{journey.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {showAdvanced ? (
        <div
          id={optionsId}
          className="animate-fade mt-4 grid gap-4 rounded-xl border border-white/8 bg-white/[0.02] p-3.5 sm:grid-cols-2"
        >
          <Toggle
            checked={values.avoidCrowding}
            onChange={(avoidCrowding) => onChange({ avoidCrowding })}
            label="Minimise crowding"
            description="Weight the predicted crowd penalty more heavily than journey time."
          />
          <label className="block space-y-1.5">
            <span className="eyebrow block text-mist-400">Maximum changes</span>
            <Select
              value={String(values.maxTransfers)}
              onChange={(event) => onChange({ maxTransfers: Number(event.target.value) })}
              options={[
                { value: '0', label: 'Direct services only' },
                { value: '1', label: 'Up to 1 change' },
                { value: '2', label: 'Up to 2 changes' },
                { value: '3', label: 'Up to 3 changes' },
              ]}
            />
          </label>
        </div>
      ) : null}
    </Card>
  );
}
