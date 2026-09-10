import { useId } from 'react';
import { cn } from '../../lib/utils';

/**
 * Tiny SVG trend line. Used inside KPI tiles and list rows — deliberately
 * unlabelled because the surrounding copy carries the meaning.
 */
export function Sparkline({
  data,
  colorClassName = 'text-pulse-400',
  className,
  height = 34,
  filled = true,
  strokeWidth = 1.75,
}: {
  data: number[];
  /** Token class driving the line, area gradient and end cap (`currentColor`). */
  colorClassName?: string;
  className?: string;
  height?: number;
  filled?: boolean;
  strokeWidth?: number;
}) {
  const gradientId = useId();
  const points = data.filter((value) => Number.isFinite(value));

  if (points.length < 2) {
    return (
      <div
        className={cn('flex items-center text-3xs text-mist-500', className)}
        style={{ height }}
      >
        —
      </div>
    );
  }

  const width = 100;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;

  const coordinates = points.map((value, index) => {
    const x = (index / (points.length - 1)) * width;
    const y = height - ((value - min) / span) * (height - 6) - 3;
    return [x, y] as const;
  });

  const line = coordinates
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn('w-full', colorClassName, className)}
      style={{ height }}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.32" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {filled ? <path d={area} fill={`url(#${gradientId})`} /> : null}
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={coordinates[coordinates.length - 1][0]}
        cy={coordinates[coordinates.length - 1][1]}
        r="2"
        fill="currentColor"
      />
    </svg>
  );
}
