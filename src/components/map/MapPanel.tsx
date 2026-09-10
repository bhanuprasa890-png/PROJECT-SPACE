import type { ReactNode } from 'react';
import { MapPin, Satellite } from 'lucide-react';
import { Card, CardBody, CardFooter, CardHeader } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { CROWD_LEVEL_META } from '@shared/crowd';
import { cn } from '../../lib/utils';

/**
 * Chrome shared by every map surface.
 *
 * The map itself stays the visual centre: this only adds a title row, the legend
 * that explains the TransitPulse crowd bands, and the "simulated data" statement
 * that has to travel with the picture.
 */

export function MapLegend({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)}>
      <span className="eyebrow text-mist-500">Crowd</span>
      {(['low', 'moderate', 'high'] as const).map((level) => (
        <span key={level} className="inline-flex items-center gap-1.5 text-2xs text-mist-400">
          <span
            className={cn(
              'size-2 rounded-full',
              level === 'low' ? 'bg-crowd-low' : level === 'moderate' ? 'bg-crowd-moderate' : 'bg-crowd-high',
            )}
            aria-hidden
          />
          {compact ? CROWD_LEVEL_META[level].range : `${CROWD_LEVEL_META[level].label} ${CROWD_LEVEL_META[level].range}`}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5 text-2xs text-mist-400">
        <span className="size-2 rotate-45 bg-mist-300" aria-hidden />
        Vehicles
      </span>
      <span className="inline-flex items-center gap-1.5 text-2xs text-mist-400">
        <span className="size-2 rounded-full border border-white/40 bg-ink-900" aria-hidden />
        Stops
      </span>
    </div>
  );
}

export interface MapPanelProps {
  title: string;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  /** Height of the map surface; the map is always the tallest element. */
  heightClass?: string;
  legend?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function MapPanel({
  title,
  subtitle,
  icon,
  actions,
  heightClass = 'h-[340px] sm:h-[420px] lg:h-[520px]',
  legend,
  footer,
  children,
  className,
  bodyClassName,
}: MapPanelProps) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader
        title={title}
        subtitle={subtitle}
        icon={icon}
        actions={
          <>
            <Badge tone="violet" size="xs" dot>
              SIMULATED DATA
            </Badge>
            {actions}
          </>
        }
      />
      <CardBody padding="compact" className={cn('mt-3 px-3 pb-0 sm:px-4', bodyClassName)}>
        <div
          className={cn(
            'relative w-full overflow-hidden rounded-xl border border-white/10 bg-ink-950/70',
            heightClass,
          )}
        >
          {children}
        </div>
      </CardBody>
      <CardFooter className="flex-col items-start gap-2.5">
        {legend ?? <MapLegend />}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-3xs text-mist-500">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="size-3" aria-hidden />
            Base map © Google · crowd layer © TransitPulse AI
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Satellite className="size-3" aria-hidden />
            Demo network — no live vehicle feed
          </span>
        </div>
        {footer}
      </CardFooter>
    </Card>
  );
}

