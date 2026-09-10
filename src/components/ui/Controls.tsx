import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export function Field({
  label,
  hint,
  children,
  className,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <label htmlFor={htmlFor} className={cn('block space-y-1.5', className)}>
      <span className="flex items-center justify-between gap-2 text-[0.7rem] font-medium tracking-wide text-mist-400 uppercase">
        {label}
      </span>
      {children}
      {hint ? <span className="block text-xs text-mist-500">{hint}</span> : null}
    </label>
  );
}

const CONTROL =
  'w-full rounded-xl border border-white/10 bg-ink-900/70 px-3 py-2.5 text-sm text-mist-100 placeholder:text-mist-500 transition focus:border-pulse-400/60 focus:bg-ink-900 disabled:opacity-50';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cn(CONTROL, className)} />;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string; disabled?: boolean }[];
}

export function Select({ options, className, ...rest }: SelectProps) {
  return (
    <select {...rest} className={cn(CONTROL, 'appearance-none pr-9', className)}>
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-mist-100">{label}</p>
        {description ? <p className="mt-0.5 text-xs text-mist-400">{description}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-300',
          checked
            ? 'border-pulse-400/60 bg-pulse-400/30'
            : 'border-white/12 bg-white/8',
          disabled && 'opacity-50',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-4.5 rounded-full transition-all duration-300',
            checked
              ? 'left-[1.45rem] bg-pulse-300 shadow-[0_0_12px_rgba(56,245,192,0.8)]'
              : 'left-0.5 bg-mist-400',
          )}
        />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  size = 'md',
}: {
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (next: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      role="tablist"
      className={cn(
        'scrollbar-none inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-white/10 bg-ink-900/60 p-1',
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          type="button"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-lg font-medium transition-all duration-200',
            size === 'sm' ? 'px-2.5 py-1.5 text-[0.7rem]' : 'px-3.5 py-2 text-xs',
            value === option.value
              ? 'bg-white/12 text-mist-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
              : 'text-mist-400 hover:text-mist-200',
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  label,
  format,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  label: string;
  format?: (value: number) => string;
}) {
  const percent = ((value - min) / (max - min)) * 100;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-mist-300">{label}</span>
        <span className="font-mono text-mist-200">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-pulse-400
          [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-pulse-400
          [&::-webkit-slider-thumb]:shadow-[0_0_14px_rgba(56,245,192,0.75)]"
        style={{
          background: `linear-gradient(90deg, var(--color-pulse-400) ${percent}%, rgba(255,255,255,0.1) ${percent}%)`,
        }}
      />
    </div>
  );
}
