import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'subtle' | 'danger';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const VARIANTS: Record<Variant, string> = {
  primary:
    'glow-pulse bg-gradient-to-r from-pulse-500 to-pulse-400 font-semibold text-ink-950 transition-shadow hover:from-pulse-400 hover:to-pulse-300 hover:shadow-lift',
  secondary:
    'border border-white/10 bg-white/8 text-mist-100 hover:border-white/18 hover:bg-white/14',
  ghost: 'border border-transparent text-mist-300 hover:bg-white/6 hover:text-mist-100',
  outline:
    'border border-white/15 text-mist-200 hover:border-pulse-400/50 hover:bg-white/4 hover:text-mist-100',
  subtle: 'border border-transparent bg-white/4 text-mist-200 hover:bg-white/8 hover:text-mist-100',
  danger:
    'border border-crowd-critical/40 bg-crowd-critical/12 text-crowd-critical hover:bg-crowd-critical/22',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 gap-1.5 rounded-lg px-3 text-xs',
  md: 'h-10 gap-2 rounded-xl px-4 text-sm',
  lg: 'h-12 gap-2.5 rounded-xl px-6 text-md',
  icon: 'size-9 rounded-lg',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  /** Stretch to the full width of its container (mobile CTAs). */
  block?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  iconRight,
  block = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'relative inline-flex select-none items-center justify-center font-medium tracking-tight whitespace-nowrap',
        'transition-[background-color,background-image,border-color,color,box-shadow,transform] duration-200',
        'outline-none focus-visible:ring-2 focus-visible:ring-pulse-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950',
        'disabled:cursor-not-allowed disabled:opacity-45 active:scale-[0.985] disabled:active:scale-100',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
      {iconRight}
    </button>
  );
}

/** Small icon-only button with a tooltip label — used in dense panel headers. */
export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonProps & { label: string }) {
  return (
    <Button
      {...rest}
      size="icon"
      variant={rest.variant ?? 'ghost'}
      aria-label={label}
      title={label}
      className={className}
    >
      {children}
    </Button>
  );
}
