import { useState } from 'react';
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
 * under a minute — routing preferences live behind the options toggle.
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

  const disabled =
    !values.originStopId ||
    !values.destinationStopId ||
    values.originStopId === values.destinationStopId;

  return (
    <Card accent="pulse" className={cn(tone === 'hero' ? 'p-5 sm:p-6' : 'p-4', className)}>
      {!compact && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-pulse-300" />
              <h2 className="font-display text-base font-semibold text-mist-100">Plan a journey</h2>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-mist-400">
              TransitPulse predicts how full each service will be at your boarding time, then picks
              the option that keeps you comfortable.
            </p>
          </div>
          <span className="hidden shrink-0 rounded-full border border-pulse-400/25 bg-pulse-400/10 px-2.5 py-1 text-[0.65rem] font-medium text-pulse-300 sm:inline-flex">
            Predict · Avoid · Optimize
          </span>
        </div>
      )}

      {/* ------------------------------------------------------ the three inputs */}
      <div className="grid gap-3 lg:grid-cols-[1.1fr_auto_1.1fr_auto] lg:items-end">
        <StopPicker
          label="From"
          value={values.originStopId}
          onChange={(originStopId) => onChange({ originStopId })}
          quickPicks={quickPicks}
        />

        <Button
          variant="secondary"
          size="icon"
          className="hidden justify-self-center lg:mb-1 lg:inline-flex"
          aria-label="Swap origin and destination"
          onClick={() =>
            onChange({
              originStopId: values.destinationStopId,
              destinationStopId: values.originStopId,
            })
          }
        >
          <ArrowLeftRight className="size-4" />
        </Button>

        <StopPicker
          label="To"
          value={values.destinationStopId}
          onChange={(destinationStopId) => onChange({ destinationStopId })}
          quickPicks={quickPicks}
        />

        <div className="space-y-1.5 lg:min-w-[13.5rem]">
          <span className="flex items-center gap-1.5 text-[0.68rem] font-medium tracking-wider text-mist-400 uppercase">
            <Clock className="size-3" />
            Departure time
          </span>
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-ink-900/60 p-1">
            {(['now', 'later'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onChange({ departMode: mode })}
                className={cn(
                  'inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition',
                  values.departMode === mode
                    ? 'bg-white/12 text-mist-100'
                    : 'text-mist-400 hover:text-mist-200',
                )}
              >
                {mode === 'now' ? <Zap className="size-3.5" /> : <CalendarClock className="size-3.5" />}
                {mode === 'now' ? 'Now' : 'Leave at'}
              </button>
            ))}
            {values.departMode === 'later' && (
              <input
                type="time"
                aria-label="Departure time"
                value={values.departTime}
                onChange={(event) => onChange({ departTime: event.target.value })}
                className="w-[5.6rem] rounded-lg bg-white/6 px-2 py-1.5 font-mono text-xs text-mist-100 focus:outline-none"
              />
            )}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------- the action */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          size="lg"
          loading={loading}
          disabled={disabled}
          onClick={onSubmit}
          icon={<Sparkles className="size-4" />}
          className="w-full sm:w-auto"
        >
          Find Best Route
        </Button>

        <button
          type="button"
          onClick={() => setShowAdvanced((previous) => !previous)}
          className="inline-flex items-center gap-1 text-xs text-mist-400 transition hover:text-mist-200"
        >
          {showAdvanced ? 'Hide options' : 'Routing options'}
          <ChevronDown className={cn('size-3.5 transition-transform', showAdvanced && 'rotate-180')} />
        </button>

        <p className="ml-auto hidden text-[0.68rem] text-mist-500 sm:block">
          {values.avoidCrowding
            ? 'Optimising for comfort and time'
            : 'Optimising for the fastest arrival'}
        </p>
      </div>

      {quickJourneys?.length ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/8 pt-3">
          <span className="text-[0.65rem] tracking-wider text-mist-500 uppercase">Try</span>
          {quickJourneys.map((journey) => (
            <button
              key={journey.label}
              type="button"
              onClick={() =>
                onChange({
                  originStopId: journey.originStopId,
                  destinationStopId: journey.destinationStopId,
                })
              }
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[0.68rem] transition',
                values.originStopId === journey.originStopId &&
                  values.destinationStopId === journey.destinationStopId
                  ? 'border-pulse-400/45 bg-pulse-400/12 text-pulse-100'
                  : 'border-white/10 bg-white/4 text-mist-300 hover:border-white/20 hover:text-mist-100',
              )}
            >
              <MapPin className="size-3" />
              {journey.label}
            </button>
          ))}
        </div>
      ) : null}

      {showAdvanced ? (
        <div className="mt-4 grid gap-3 rounded-xl border border-white/8 bg-white/[0.02] p-3 sm:grid-cols-2">
          <Toggle
            checked={values.avoidCrowding}
            onChange={(avoidCrowding) => onChange({ avoidCrowding })}
            label="Minimise crowding"
            description="Weight the predicted crowd penalty more heavily than journey time."
          />
          <label className="block space-y-1.5">
            <span className="text-[0.68rem] font-medium tracking-wider text-mist-400 uppercase">
              Maximum changes
            </span>
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

      {disabled && values.originStopId && values.destinationStopId ? (
        <p className="mt-3 text-xs text-crowd-moderate">
          Pick two different stops to plan a journey.
        </p>
      ) : null}
    </Card>
  );
}
