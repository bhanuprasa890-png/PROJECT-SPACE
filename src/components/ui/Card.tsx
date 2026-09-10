import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface CardProps {
  children: ReactNode;
  className?: string;
  /** Accent glow along the top edge — used sparingly for hero surfaces. */
  accent?: 'none' | 'pulse' | 'warning' | 'critical' | 'sky';
  /** Surface weight: glass panels by default, `quiet` for nested blocks. */
  tone?: 'glass' | 'quiet' | 'strong';
  interactive?: boolean;
  style?: CSSProperties;
  as?: 'div' | 'section' | 'article' | 'li';
}

const ACCENTS: Record<NonNullable<CardProps['accent']>, string> = {
  none: '',
  pulse: 'before:bg-gradient-to-r before:from-transparent before:via-pulse-400/70 before:to-transparent',
  sky: 'before:bg-gradient-to-r before:from-transparent before:via-sky-400/60 before:to-transparent',
  warning:
    'before:bg-gradient-to-r before:from-transparent before:via-crowd-moderate/70 before:to-transparent',
  critical:
    'before:bg-gradient-to-r before:from-transparent before:via-crowd-critical/70 before:to-transparent',
};

const TONES: Record<NonNullable<CardProps['tone']>, string> = {
  glass: 'glass shadow-panel',
  strong: 'glass-strong shadow-panel',
  quiet: 'border border-white/8 bg-white/[0.02]',
};

export function Card({
  children,
  className,
  accent = 'none',
  tone = 'glass',
  interactive = false,
  style,
  as: Tag = 'div',
}: CardProps) {
  return (
    <Tag
      style={style}
      className={cn(
        'relative overflow-hidden rounded-2xl',
        TONES[tone],
        accent !== 'none' &&
          cn(
            'before:absolute before:inset-x-0 before:top-0 before:h-px before:content-[""]',
            ACCENTS[accent],
          ),
        interactive &&
          'transition-[transform,border-color,box-shadow] duration-300 hover:-translate-y-0.5 hover:border-white/18 hover:shadow-lift',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** `compact` tightens the header for dense console panels. */
  size?: 'default' | 'compact';
}

export function CardHeader({
  title,
  subtitle,
  icon,
  actions,
  className,
  size = 'default',
}: CardHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-x-4 gap-y-2',
        size === 'compact' ? 'px-4 pt-4' : 'px-5 pt-5',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {icon ? (
          <span
            className={cn(
              'grid shrink-0 place-items-center rounded-xl border border-white/10 bg-gradient-to-br from-white/8 to-white/[0.02] text-pulse-300',
              size === 'compact' ? 'size-8 [&>svg]:size-4' : 'mt-0.5 size-9',
            )}
            aria-hidden
          >
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h2
            className={cn(
              'font-display font-semibold text-mist-100',
              size === 'compact' ? 'text-[0.9rem]' : 'text-[0.98rem]',
            )}
          >
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-mist-400">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

export function CardBody({
  children,
  className,
  padding = 'default',
}: {
  children: ReactNode;
  className?: string;
  padding?: 'default' | 'compact' | 'none';
}) {
  return (
    <div
      className={cn(
        padding === 'none' ? '' : padding === 'compact' ? 'px-4 py-3.5' : 'px-5 py-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Full-bleed divided section inside a card — keeps long panels scannable. */
export function CardSection({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
}) {
  return (
    <section className={cn('border-t border-white/6 px-5 py-4 first:border-t-0', className)}>
      {title ? <p className="eyebrow mb-2.5 text-mist-500">{title}</p> : null}
      {children}
    </section>
  );
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t border-white/6 bg-ink-950/30 px-5 py-3',
        className,
      )}
    >
      {children}
    </div>
  );
}
