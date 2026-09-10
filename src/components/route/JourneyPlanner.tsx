import { useState } from 'react';
import { ArrowLeftRight, CalendarClock, Sparkles, Zap } from 'lucide-react';
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

/** Journey input card used on the dashboard and on the results screen. */
export function JourneyPlanner({
  values,
  onChange,
  onSubmit,
  loading,
  className,
  quickPicks,
  compact = false,
}: {
  values: PlannerValues;
  onChange: (patch: Partial<PlannerValues>) => void;
  onSubmit: () => void;
  loading?: boolean;
  className?: string;
  quickPicks?: { id: string; name: string }[];
  compact?: boolean;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const disabled =
    !values.originStopId ||
    !values.destinationStopId ||
    values.originStopId === values.destinationStopId;

  return (
    <Card accent="pulse" className={cn('p-5', className)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-pulse-300" />
            <h2 className="font-display text-base font-semibold text-mist-100">
              Where are you heading?
            </h2>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-mist-400">
            TransitPulse predicts carriage load at your boarding time and ranks the alternatives.
          </p>
        </div>
        {!compact ? (
          <span className="hidden shrink-0 rounded-full border border-pulse-400/25 bg-pulse-400/10 px-2.5 py-1 text-[0.65rem] font-medium text-pulse-300 sm:inline-flex">
            Predict · Avoid · Optimize
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
        <StopPicker
          label="From"
          value={values.originStopId}
          onChange={(originStopId) => onChange({ originStopId })}
          quickPicks={quickPicks}
        />

        <Button
          variant="secondary"
          size="icon"
          className="justify-self-center sm:mb-1"
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
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="flex rounded-xl border border-white/10 bg-ink-900/60 p-1">
          {(['now', 'later'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onChange({ departMode: mode })}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition',
                values.departMode === mode
                  ? 'bg-white/12 text-mist-100'
                  : 'text-mist-400 hover:text-mist-200',
              )}
            >
              {mode === 'now' ? <Zap className="size-3.5" /> : <CalendarClock className="size-3.5" />}
              {mode === 'now' ? 'Depart now' : 'Leave at'}
            </button>
          ))}
        </div>

        {values.departMode === 'later' ? (
          <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-ink-900/60 px-3 py-2">
            <CalendarClock className="size-4 text-pulse-300" />
            <input
              type="time"
              value={values.departTime}
              onChange={(event) => onChange({ departTime: event.target.value })}
              className="bg-transparent font-mono text-sm text-mist-100 focus:outline-none"
            />
          </label>
        ) : null}

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowAdvanced((previous) => !previous)}
          className="ml-auto"
        >
          {showAdvanced ? 'Hide options' : 'Routing options'}
        </Button>

        <Button
          variant="primary"
          size="lg"
          loading={loading}
          disabled={disabled}
          onClick={onSubmit}
          icon={<Sparkles className="size-4" />}
        >
          Find crowd-aware routes
        </Button>
      </div>

      {showAdvanced ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Toggle
            checked={values.avoidCrowding}
            onChange={(avoidCrowding) => onChange({ avoidCrowding })}
            label="Minimise crowding"
            description="Weight predicted carriage load more heavily than journey time."
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
