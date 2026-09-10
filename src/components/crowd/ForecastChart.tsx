import { useId, useMemo, useState } from 'react';
import { CROWD_THRESHOLDS } from '@shared/crowd';
import type { CrowdForecastPoint } from '@shared/types';
import { cn, crowdToneForRatio, formatClock } from '../../lib/utils';

const WIDTH = 720;
const HEIGHT = 240;
const PAD = { top: 18, right: 16, bottom: 26, left: 34 };
const MAX_RATIO = 1.4;

/**
 * Forecast chart: measured history → live edge → model prediction with an 80%
 * prediction interval. Pure SVG, no chart dependency, fully responsive.
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
  const [hover, setHover] = useState<number | null>(null);

  const series = useMemo(
    () => [...history, ...points].sort((a, b) => new Date(a.targetAt).getTime() - new Date(b.targetAt).getTime()),
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
  const toY = (ratio: number): number => PAD.top + innerH - (Math.min(ratio, MAX_RATIO) / MAX_RATIO) * innerH;

  const historyCount = history.length;
  const forecastStart = Math.max(0, historyCount - 1);
  const nowX = historyCount > 0 ? toX(forecastStart) : PAD.left;

  const linePath = series
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${toX(index).toFixed(2)},${toY(point.ratio).toFixed(2)}`)
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

  const gridRatios = [0, CROWD_THRESHOLDS.moderate, CROWD_THRESHOLDS.high, 1.3];

  return (
    <div className={cn('relative w-full', className)}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label="Crowd forecast chart"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const ratioX = ((event.clientX - rect.left) / rect.width) * WIDTH;
          const index = Math.round(((ratioX - PAD.left) / innerW) * (series.length - 1));
          setHover(Math.max(0, Math.min(series.length - 1, index)));
        }}
        onClick={() => {
          if (active && onSelect) onSelect(active);
        }}
      >
        <defs>
          <linearGradient id={bandId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38f5c0" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#38f5c0" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* horizontal thresholds */}
        {gridRatios.map((ratio) => (
          <g key={ratio}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={toY(ratio)}
              y2={toY(ratio)}
              stroke={ratio === 0 ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.07)'}
              strokeDasharray={ratio === 0 ? '0' : '3 5'}
            />
            <text x={8} y={toY(ratio) + 3.5} fill="#55658a" fontSize="10" fontFamily="JetBrains Mono">
              {Math.round(ratio * 100)}%
            </text>
          </g>
        ))}

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

        {/* full line */}
        <path d={linePath} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />

        {/* forecast emphasis */}
        <path
          d={forecastPoints
            .map((point, index) => `${index === 0 ? 'M' : 'L'}${toX(forecastStart + index).toFixed(2)},${toY(point.ratio).toFixed(2)}`)
            .join(' ')}
          fill="none"
          stroke="#38f5c0"
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
            />
          ) : null,
        )}

        {/* x labels */}
        {series
          .filter((_, index) => index % Math.ceil(series.length / 6) === 0)
          .map((point) => {
            const index = series.indexOf(point);
            return (
              <text
                key={`label-${point.targetAt}`}
                x={toX(index)}
                y={HEIGHT - 8}
                fill="#55658a"
                fontSize="10"
                textAnchor="middle"
                fontFamily="JetBrains Mono"
              >
                {formatClock(point.targetAt)}
              </text>
            );
          })}

        {hover !== null ? (
          <line
            x1={toX(hover)}
            x2={toX(hover)}
            y1={PAD.top}
            y2={PAD.top + innerH}
            stroke="rgba(255,255,255,0.35)"
          />
        ) : null}
      </svg>

      {active ? (
        <div
          className="pointer-events-none absolute top-1 rounded-xl border border-white/10 bg-ink-900/95 px-3 py-2 text-xs shadow-xl backdrop-blur"
          style={{
            left: `${(toX(hover ?? 0) / WIDTH) * 100}%`,
            transform: `translateX(${(hover ?? 0) > series.length / 2 ? '-105%' : '8%'})`,
          }}
        >
          <p className="font-mono text-[0.7rem] text-mist-400">{formatClock(active.targetAt)}</p>
          <p className={cn('font-display text-base font-semibold', crowdToneForRatio(active.ratio).text)}>
            {Math.round(active.ratio * 100)}%
          </p>
          <p className="text-[0.68rem] text-mist-400">
            {active.headcount}/{active.capacity} riders
          </p>
          <p className="mt-0.5 text-[0.62rem] text-mist-500">
            {isForecast ? `${active.horizonMinutes} min ahead · ${Math.round(active.confidence * 100)}% conf.` : 'measured'}
          </p>
        </div>
      ) : null}
    </div>
  );
}
