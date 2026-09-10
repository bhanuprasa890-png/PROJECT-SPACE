import { useId, useMemo, useState } from 'react';
import { CROWD_THRESHOLDS } from '@shared/crowd';
import type { CrowdForecastPoint } from '@shared/types';
import { cn, crowdToneForRatio, formatClock, formatPercent } from '../../lib/utils';

const WIDTH = 720;
const HEIGHT = 250;
const PAD = { top: 20, right: 46, bottom: 30, left: 38 };
const MAX_RATIO = 1.4;

/**
 * Forecast chart: measured history → live edge → model prediction with an 80%
 * prediction interval. Pure SVG, no chart dependency, fully responsive.
 *
 * Reading order is deliberate: thresholds first, then the band of uncertainty,
 * then the line, then the hovered value — so the eye lands on "how full will it
 * be" before any decoration.
 */
export function ForecastChart({
  points,
  history = [],
  className,
  onSelect,
}: {
  points: CrowdForecastPoint[];
  history?: CrowdForecastPoint[];
  className?: string;
  onSelect?: (point: CrowdForecastPoint) => void;
}) {
  const bandId = useId();
  const strokeId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const series = useMemo(
    () =>
      [...history, ...points].sort(
        (a, b) => new Date(a.targetAt).getTime() - new Date(b.targetAt).getTime(),
      ),
    [history, points],
  );

  if (series.length < 2) {
    return (
      <div className={cn('grid h-48 place-items-center text-xs text-mist-500', className)}>
        Not enough data to plot a forecast yet.
      </div>
    );
  }

  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const toX = (index: number): number => PAD.left + (index / (series.length - 1)) * innerW;
  const toY = (ratio: number): number =>
    PAD.top + innerH - (Math.min(Math.max(ratio, 0), MAX_RATIO) / MAX_RATIO) * innerH;

  const historyCount = history.length;
  const forecastStart = Math.max(0, historyCount - 1);
  const nowX = historyCount > 0 ? toX(forecastStart) : PAD.left;

  const linePath = series
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'}${toX(index).toFixed(2)},${toY(point.ratio).toFixed(2)}`,
    )
    .join(' ');

  const forecastPoints = series.slice(forecastStart);
  const areaPath = [
    ...forecastPoints.map((point, index) => {
      const absoluteIndex = forecastStart + index;
      return `${index === 0 ? 'M' : 'L'}${toX(absoluteIndex).toFixed(2)},${toY(point.upper).toFixed(2)}`;
    }),
    ...[...forecastPoints].reverse().map((point, reverseIndex) => {
      const absoluteIndex = forecastStart + (forecastPoints.length - 1 - reverseIndex);
      return `L${toX(absoluteIndex).toFixed(2)},${toY(point.lower).toFixed(2)}`;
    }),
    'Z',
  ].join(' ');

  const active = hover !== null ? series[hover] : null;
  const isForecast = hover !== null && hover >= forecastStart;

  const gridRatios: { ratio: number; label: string }[] = [
    { ratio: 0, label: '0%' },
    { ratio: CROWD_THRESHOLDS.moderate, label: 'moderate' },
    { ratio: CROWD_THRESHOLDS.high, label: 'high' },
    { ratio: 1.3, label: '130%' },
  ];

  const xLabelStep = Math.max(1, Math.ceil(series.length / 6));

  const pick = (clientX: number, target: SVGSVGElement): void => {
    const rect = target.getBoundingClientRect();
    const ratioX = ((clientX - rect.left) / rect.width) * WIDTH;
    const index = Math.round(((ratioX - PAD.left) / innerW) * (series.length - 1));
    setHover(Math.max(0, Math.min(series.length - 1, index)));
  };

  return (
    <div className={cn('relative w-full', className)}>
      {/* legend */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-3xs text-mist-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-mist-400" aria-hidden />
          measured
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-pulse-400" aria-hidden />
          model forecast
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-pulse-400/20" aria-hidden />
          80% interval
        </span>
        <span className="ml-auto hidden items-center gap-1.5 sm:inline-flex">
          <span className="h-px w-4 border-t border-dashed border-white/40" aria-hidden />
          crowd thresholds
        </span>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label={`Crowd forecast chart, ${series.length} points. ${Math.round(series[0].ratio * 100)}% at ${formatClock(series[0].targetAt)} rising to a peak of ${Math.round(Math.max(...series.map((point) => point.ratio)) * 100)}%.`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => pick(event.clientX, event.currentTarget)}
        onTouchStart={(event) => pick(event.touches[0].clientX, event.currentTarget)}
        onTouchMove={(event) => pick(event.touches[0].clientX, event.currentTarget)}
        onClick={() => {
          if (active && onSelect) onSelect(active);
        }}
      >
        <defs>
          <linearGradient id={bandId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38f5c0" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#38f5c0" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id={strokeId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#38f5c0" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#38f5c0" />
          </linearGradient>
        </defs>

        {/* horizontal thresholds + right-hand band labels */}
        {gridRatios.map(({ ratio, label }) => (
          <g key={ratio}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={toY(ratio)}
              y2={toY(ratio)}
              stroke={ratio === 0 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.07)'}
              strokeDasharray={ratio === 0 ? '0' : '3 5'}
            />
            <text
              x={8}
              y={toY(ratio) + 3.5}
              fill="#55658a"
              fontSize="10"
              fontFamily="JetBrains Mono"
            >
              {Math.round(ratio * 100)}%
            </text>
            {ratio !== 0 ? (
              <text
                x={WIDTH - PAD.right + 6}
                y={toY(ratio) + 3.5}
                fill="#55658a"
                fontSize="9.5"
                fontFamily="JetBrains Mono"
              >
                {label}
              </text>
            ) : null}
          </g>
        ))}

        {/* vertical gridlines at the labelled ticks */}
        {series.map((point, index) =>
          index % xLabelStep === 0 ? (
            <line
              key={`grid-${point.targetAt}`}
              x1={toX(index)}
              x2={toX(index)}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke="rgba(255,255,255,0.035)"
            />
          ) : null,
        )}

        {/* prediction interval */}
        <path d={areaPath} fill={`url(#${bandId})`} />

        {/* forecast boundary */}
        {historyCount > 0 ? (
          <g>
            <line
              x1={nowX}
              x2={nowX}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke="rgba(56,245,192,0.45)"
              strokeDasharray="4 4"
            />
            <text x={nowX + 6} y={PAD.top + 11} fill="#38f5c0" fontSize="10">
              now
            </text>
          </g>
        ) : null}

        {/* measured history — deliberately quieter than the forecast */}
        <path d={linePath} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="1.5" />

        {/* forecast emphasis */}
        <path
          d={forecastPoints
            .map(
              (point, index) =>
                `${index === 0 ? 'M' : 'L'}${toX(forecastStart + index).toFixed(2)},${toY(point.ratio).toFixed(2)}`,
            )
            .join(' ')}
          fill="none"
          stroke={`url(#${strokeId})`}
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* per-point markers */}
        {series.map((point, index) =>
          index % 3 === 0 || index === series.length - 1 ? (
            <circle
              key={point.targetAt}
              cx={toX(index)}
              cy={toY(point.ratio)}
              r={hover === index ? 5 : 3}
              fill={crowdToneForRatio(point.ratio).stroke}
              stroke="#04060c"
              strokeWidth="1.5"
              className="transition-[r] duration-150"
            />
          ) : null,
        )}

        {/* x labels */}
        {series.map((point, index) =>
          index % xLabelStep === 0 ? (
            <text
              key={`label-${point.targetAt}`}
              x={toX(index)}
              y={HEIGHT - 10}
              fill="#55658a"
              fontSize="10"
              textAnchor="middle"
              fontFamily="JetBrains Mono"
            >
              {formatClock(point.targetAt)}
            </text>
          ) : null,
        )}

        {hover !== null ? (
          <>
            <line
              x1={toX(hover)}
              x2={toX(hover)}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke="rgba(255,255,255,0.32)"
            />
            <circle
              cx={toX(hover)}
              cy={toY(series[hover].ratio)}
              r="9"
              fill={crowdToneForRatio(series[hover].ratio).stroke}
              opacity="0.18"
            />
          </>
        ) : null}
      </svg>

      {active ? (
        <div
          className="glass-strong pointer-events-none absolute top-8 min-w-[9.5rem] rounded-xl px-3 py-2 shadow-2xl"
          style={{
            left: `${(toX(hover ?? 0) / WIDTH) * 100}%`,
            transform: `translateX(${(hover ?? 0) > series.length / 2 ? '-105%' : '8%'})`,
          }}
        >
          <p className="figure text-3xs text-mist-400">{formatClock(active.targetAt)}</p>
          <p
            className={cn(
              'mt-0.5 font-display text-lg leading-none font-semibold',
              crowdToneForRatio(active.ratio).text,
            )}
          >
            {formatPercent(active.ratio)}
          </p>
          <p className="figure mt-1 text-3xs text-mist-400">
            {active.headcount}/{active.capacity} riders
          </p>
          <p className="mt-0.5 text-3xs text-mist-500">
            {isForecast
              ? `${active.horizonMinutes} min ahead · ${Math.round(active.confidence * 100)}% confidence`
              : 'measured reading'}
          </p>
        </div>
      ) : null}

      {/* text alternative for screen readers */}
      <ul className="sr-only">
        {series.slice(-8).map((point) => (
          <li key={`sr-${point.targetAt}`}>
            {formatClock(point.targetAt)}: {formatPercent(point.ratio)}, {point.headcount} of{' '}
            {point.capacity} seats
          </li>
        ))}
      </ul>
    </div>
  );
}
