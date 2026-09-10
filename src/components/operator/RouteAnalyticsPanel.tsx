import { useMemo } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, LineChart } from 'lucide-react';
import { CROWD_THRESHOLDS } from '@shared/crowd';
import type { RouteAnalytics } from '@shared/types';
import { Badge } from '../ui/Badge';
import { cn, crowdTone, formatPercent } from '../../lib/utils';

/**
 * Route analytics — occupancy trend, predicted vs current occupancy and the
 * crowd trend direction per route.
 *
 * The series mixes measured `crowd_observations` (solid) with persisted
 * `crowd_forecasts` (dashed) so a controller sees where demand has been and
 * where the model expects it to go.
 */

const WIDTH = 720;
const HEIGHT = 190;
const PAD_X = 34;
const PAD_Y = 18;
/** Vertical space the chart represents — 130% covers crush loads. */
const MAX_RATIO = 1.3;

function buildPath(points: { x: number; y: number }[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ');
}

function TrendBadge({ trend }: { trend: RouteAnalytics['trend'] }) {
  if (trend === 'rising')
    return (
      <Badge tone="high" size="xs" icon={<ArrowUpRight className="size-3" />}>
        Rising
      </Badge>
    );
  if (trend === 'falling')
    return (
      <Badge tone="low" size="xs" icon={<ArrowDownRight className="size-3" />}>
        Falling
      </Badge>
    );
  return (
    <Badge tone="neutral" size="xs" icon={<ArrowRight className="size-3" />}>
      Stable
    </Badge>
  );
}

export function RouteAnalyticsPanel({
  analytics,
  selectedRoute,
  onSelectRoute,
  className,
}: {
  analytics: RouteAnalytics[];
  selectedRoute: string | null;
  onSelectRoute: (routeNumber: string) => void;
  className?: string;
}) {
  const active = analytics.find((item) => item.routeNumber === selectedRoute) ?? analytics[0] ?? null;

  const geometry = useMemo(() => {
    if (!active) return null;
    const series = active.series;
    const count = Math.max(series.length - 1, 1);
    const points = series.map((point, index) => ({
      x: PAD_X + (index / count) * (WIDTH - PAD_X * 2),
      y: HEIGHT - PAD_Y - (Math.min(point.ratio, MAX_RATIO) / MAX_RATIO) * (HEIGHT - PAD_Y * 2),
      ratio: point.ratio,
      kind: point.kind,
      at: point.at,
    }));
    const history = points.filter((point) => point.kind === 'history');
    const forecast = points.filter((point) => point.kind === 'forecast');
    const firstForecast = forecast[0];
    const lastHistory = history[history.length - 1];

    return {
      points,
      historyPath: history.length ? buildPath(history) : '',
      forecastPath:
        forecast.length && lastHistory ? buildPath([lastHistory, ...forecast]) : buildPath(forecast),
      nowX: firstForecast?.x ?? (lastHistory?.x ?? PAD_X),
      thresholdY: (ratio: number) => HEIGHT - PAD_Y - (ratio / MAX_RATIO) * (HEIGHT - PAD_Y * 2),
      last: points[points.length - 1],
    };
  }, [active]);

  if (!active || !geometry) {
    return (
      <p className={cn('px-5 py-6 text-sm text-mist-400', className)}>
        No occupancy history has been recorded yet.
      </p>
    );
  }

  const tone = crowdTone(active.predictedPct >= 85 ? 'high' : active.predictedPct >= 60 ? 'moderate' : 'low');

  return (
    <div className={cn('space-y-4 p-4', className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        {analytics.map((item) => {
          const isActive = item.lineId === active.lineId;
          return (
            <button
              key={item.lineId}
              type="button"
              onClick={() => onSelectRoute(item.routeNumber)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 figure text-3xs transition-colors',
                isActive
                  ? 'border-white/25 bg-white/10 text-mist-100'
                  : 'border-white/10 text-mist-400 hover:text-mist-200',
              )}
            >
              <span
                className="size-1.5 rounded-full"
                style={{ backgroundColor: item.color, boxShadow: `0 0 6px ${item.color}` }}
              />
              {item.routeNumber}
            </button>
          );
        })}
      </div>

      {/* Chart */}
      <div className="rounded-2xl border border-white/8 bg-ink-950/40 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-mist-100">{active.routeName}</p>
            <p className="figure text-3xs text-mist-500">
              last 24h measured · next 4h predicted · {active.peakLabel}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <TrendBadge trend={active.trend} />
            <span className={cn('figure text-2xs', tone.text)}>
              {active.currentPct.toFixed(0)}% → {active.predictedPct.toFixed(0)}%
            </span>
          </div>
        </div>

        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label={`${active.routeName} occupancy trend`}>
          {/* threshold guides (60% / 85%) from the shared crowd model */}
          {[
            { ratio: CROWD_THRESHOLDS.moderate, label: '60%' },
            { ratio: CROWD_THRESHOLDS.high, label: '85%' },
          ].map((guide) => (
            <g key={guide.label}>
              <line
                x1={PAD_X}
                x2={WIDTH - PAD_X}
                y1={geometry.thresholdY(guide.ratio)}
                y2={geometry.thresholdY(guide.ratio)}
                stroke="rgba(148,163,184,0.22)"
                strokeDasharray="4 6"
              />
              <text
                x={WIDTH - PAD_X}
                y={geometry.thresholdY(guide.ratio) - 4}
                textAnchor="end"
                className="fill-mist-500 font-mono"
                style={{ fontSize: 9 }}
              >
                {guide.label}
              </text>
            </g>
          ))}

          {/* measured history */}
          <path
            d={`${geometry.historyPath} L${geometry.points[geometry.points.length - 1].x},${HEIGHT - PAD_Y} L${PAD_X},${HEIGHT - PAD_Y} Z`}
            fill="rgba(56,245,192,0.08)"
          />
          <path d={geometry.historyPath} fill="none" stroke="#38f5c0" strokeWidth={2} strokeLinejoin="round" />

          {/* forecast */}
          {geometry.forecastPath ? (
            <path
              d={geometry.forecastPath}
              fill="none"
              stroke={tone.stroke}
              strokeWidth={2}
              strokeDasharray="5 4"
              strokeLinejoin="round"
            />
          ) : null}

          {/* "now" divider */}
          <line
            x1={geometry.nowX}
            x2={geometry.nowX}
            y1={PAD_Y - 6}
            y2={HEIGHT - PAD_Y + 4}
            stroke="rgba(226,232,240,0.5)"
            strokeDasharray="2 3"
          />
          <text x={geometry.nowX + 4} y={PAD_Y - 8} className="fill-mist-400 font-mono" style={{ fontSize: 9 }}>
            now
          </text>

          {/* current + predicted markers */}
          <circle cx={geometry.nowX} cy={geometry.thresholdY(active.currentPct / 100)} r={4} fill="#38f5c0" />
          {geometry.last ? (
            <circle cx={geometry.last.x} cy={geometry.last.y} r={4} fill={tone.stroke} />
          ) : null}
        </svg>

        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2">
            <p className="eyebrow text-mist-500">Current</p>
            <p className="figure text-sm text-mist-100">{active.currentPct.toFixed(1)}%</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2">
            <p className="eyebrow text-mist-500">Predicted +30</p>
            <p className={cn('figure text-sm', tone.text)}>{active.predictedPct.toFixed(1)}%</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2">
            <p className="eyebrow text-mist-500">Delta</p>
            <p
              className={cn(
                'figure text-sm',
                active.deltaPct > 0 ? 'text-crowd-critical' : active.deltaPct < 0 ? 'text-crowd-low' : 'text-mist-300',
              )}
            >
              {active.deltaPct > 0 ? '+' : ''}
              {active.deltaPct.toFixed(1)} pts
            </p>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2">
            <p className="eyebrow text-mist-500">24h peak</p>
            <p className="figure text-sm text-mist-100">{active.peakPct.toFixed(1)}%</p>
          </div>
        </div>
      </div>

      {/* Predicted vs current across every route */}
      <div className="overflow-hidden rounded-2xl border border-white/8">
        <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2.5">
          <LineChart className="size-3.5 text-pulse-300" />
          <p className="text-2xs font-medium tracking-wide text-mist-300 uppercase">
            Predicted vs current · all routes
          </p>
        </div>
        <ul className="divide-y divide-white/6">
          {analytics.map((item) => {
            const predictedTone = crowdTone(
              item.predictedPct >= 85 ? 'high' : item.predictedPct >= 60 ? 'moderate' : 'low',
            );
            const isActive = item.lineId === active.lineId;
            return (
              <li
                key={item.lineId}
                onClick={() => onSelectRoute(item.routeNumber)}
                className={cn(
                  'grid cursor-pointer grid-cols-[52px_1fr_auto] items-center gap-3 px-3 py-2.5 transition-colors',
                  isActive ? 'bg-white/[0.05]' : 'hover:bg-white/[0.02]',
                )}
              >
                <span className="figure text-2xs text-mist-200">{item.routeNumber}</span>

                <div className="space-y-1">
                  <div className="relative h-2 overflow-hidden rounded-full bg-white/6">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-white/25"
                      style={{ width: `${Math.min(100, item.currentPct)}%` }}
                    />
                    <div
                      className="absolute inset-y-0 rounded-full"
                      style={{
                        left: `${Math.min(100, item.currentPct)}%`,
                        width: `${Math.max(0, Math.min(100, item.predictedPct) - Math.min(100, item.currentPct))}%`,
                        backgroundColor: predictedTone.stroke,
                      }}
                    />
                  </div>
                  <p className="figure text-3xs text-mist-500">
                    now {formatPercent(item.currentPct / 100, 0)} → +30 {formatPercent(item.predictedPct / 100, 0)}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'figure text-2xs',
                      item.deltaPct > 0 ? 'text-crowd-critical' : item.deltaPct < 0 ? 'text-crowd-low' : 'text-mist-400',
                    )}
                  >
                    {item.deltaPct > 0 ? '+' : ''}
                    {item.deltaPct.toFixed(0)}
                  </span>
                  <TrendBadge trend={item.trend} />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
