import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface CardProps {
  children: ReactNode;
  className?: string;
  /** Accent glow along the top edge — used sparingly for hero surfaces. */
  accent?: 'none' | 'pulse' | 'warning' | 'critical' | 'sky';
  interactive?: boolean;
  style?: CSSProperties;
  as?: 'div' | 'section' | 'article' | 'li';
}

const ACCENTS: Record<NonNullable<CardProps['accent']>, string> = {
  none: '',
  pulse: 'before:bg-gradient-to-r before:from-transparent before:via-pulse-400/70 before:to-transparent',
  sky: 'before:bg-gradient-to-r before:from-transparent before:via-sky-400/60 before:to-transparent',
  warning: 'before:bg-gradient-to-r before:from-transparent before:via-crowd-moderate/70 before:to-transparent',
  critical: 'before:bg-gradient-to-r before:from-transparent before:via-crowd-critical/70 before:to-transparent',
};

export function Card({
  children,
  className,
  accent = 'none',
  interactive = false,
  style,
  as: Tag = 'div',
}: CardProps) {
  return (
    <Tag
      style={style}
      className={cn(
        'glass relative overflow-hidden rounded-2xl',
        accent !== 'none' &&
          cn(
            'before:absolute before:inset-x-0 before:top-0 before:h-px before:content-[""]',
            ACCENTS[accent],
          ),
        interactive &&
          'transition-all duration-300 hover:-translate-y-0.5 hover:border-white/18 hover:shadow-[0_20px_50px_-30px_rgba(56,245,192,0.45)]',
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
}

export function CardHeader({ title, subtitle, icon, actions, className }: CardHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-5 pt-5', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/6 text-pulse-300">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h3 className="truncate text-[0.95rem] font-semibold text-mist-100">{title}</h3>
          {subtitle ? (
            <p className="mt-0.5 text-xs leading-relaxed text-mist-400">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-5 py-4', className)}>{children}</div>;
}
