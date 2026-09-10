import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Section heading used across every screen: a micro label, a display title and
 * an optional description + actions rail. Keeping one component for this is what
 * makes the pages feel like the same product.
 */
export function SectionHeading({
  eyebrow,
  title,
  description,
  icon: Icon,
  actions,
  className,
  id,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-x-4 gap-y-2', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <span
            className="grid size-8 shrink-0 place-items-center rounded-xl border border-white/10 bg-gradient-to-br from-white/8 to-white/[0.02] text-pulse-300"
            aria-hidden
          >
            <Icon className="size-4" />
          </span>
        ) : null}
        <div className="min-w-0">
          {eyebrow ? <p className="eyebrow text-mist-500">{eyebrow}</p> : null}
          <h2 id={id} className="mt-0.5 font-display text-base font-semibold text-mist-100">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-mist-400">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

/**
 * One figure in a dense metric row. Values are typographically identical
 * everywhere so columns of numbers scan cleanly.
 */
export function Metric({
  label,
  value,
  unit,
  hint,
  tone = 'default',
  className,
  children,
}: {
  label: string;
  value: ReactNode;
  unit?: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'low' | 'moderate' | 'high' | 'pulse';
  className?: string;
  children?: ReactNode;
}) {
  const toneClass =
    tone === 'high'
      ? 'text-crowd-critical'
      : tone === 'moderate'
        ? 'text-crowd-moderate'
        : tone === 'low'
          ? 'text-crowd-low'
          : tone === 'pulse'
            ? 'text-pulse-300'
            : 'text-mist-100';

  return (
    <div className={cn('rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5', className)}>
      <p className="eyebrow text-mist-500">{label}</p>
      <p className={cn('mt-1.5 flex items-baseline gap-1 font-display text-lg font-semibold leading-none', toneClass)}>
        {value}
        {unit ? <span className="text-2xs font-normal text-mist-400">{unit}</span> : null}
      </p>
      {children}
      {hint ? <p className="mt-1.5 text-2xs leading-relaxed text-mist-500">{hint}</p> : null}
    </div>
  );
}

/** Label + value pair used in evidence rails and detail lists. */
export function InfoRow({
  label,
  value,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-1', className)}>
      <span className="text-2xs text-mist-500">{label}</span>
      <span className="figure text-2xs text-mist-200">{value}</span>
    </div>
  );
}

/** Centered section divider that reads as a deliberate break, not a border. */
export function Hairline({ className }: { className?: string }) {
  return <div className={cn('hairline my-1', className)} aria-hidden />;
}
