import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-gradient-to-r from-pulse-500 to-pulse-400 text-ink-950 font-semibold shadow-[0_10px_30px_-12px_rgba(20,217,168,0.7)] hover:from-pulse-400 hover:to-pulse-300',
  secondary: 'bg-white/8 text-mist-100 hover:bg-white/14 border border-white/10',
  ghost: 'text-mist-300 hover:text-mist-100 hover:bg-white/6',
  outline: 'border border-white/15 text-mist-200 hover:border-pulse-400/50 hover:text-mist-100',
  danger: 'bg-crowd-critical/15 text-crowd-critical border border-crowd-critical/40 hover:bg-crowd-critical/25',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-[0.95rem] gap-2.5',
  icon: 'h-9 w-9 justify-center',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  iconRight,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded-xl font-medium tracking-tight transition-all duration-200',
        'disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.985]',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
      {iconRight}
    </button>
  );
}
