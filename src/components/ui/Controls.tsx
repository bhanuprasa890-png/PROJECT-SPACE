import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { ChevronDown } from 'lucide-react';
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
      <span className="eyebrow flex items-center justify-between gap-2 text-mist-400">{label}</span>
      {children}
      {hint ? <span className="block text-2xs leading-relaxed text-mist-500">{hint}</span> : null}
    </label>
  );
}

const CONTROL =
  'w-full min-h-11 rounded-xl border border-white/10 bg-ink-900/70 px-3 py-2.5 text-sm text-mist-100 placeholder:text-mist-500 transition-[border-color,background-color,box-shadow] duration-200 hover:border-white/18 focus:border-pulse-400/60 focus:bg-ink-900 focus-visible:ring-2 focus-visible:ring-pulse-400/40 disabled:cursor-not-allowed disabled:opacity-50';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cn(CONTROL, className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cn(CONTROL, 'min-h-24 resize-y leading-relaxed', className)} />;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string; disabled?: boolean }[];
}

export function Select({ options, className, ...rest }: SelectProps) {
  return (
    <span className="relative block">
      <select {...rest} className={cn(CONTROL, 'appearance-none pr-9', className)}>
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-mist-500"
        aria-hidden
      />
    </span>
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
    <div className="flex items-start justify-between gap-4 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 transition-colors hover:border-white/14">
      <div className="min-w-0">
        <p className="text-[0.82rem] font-medium text-mist-100">{label}</p>
        {description ? <p className="mt-1 text-2xs leading-relaxed text-mist-400">{description}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors duration-300',
          'focus-visible:ring-2 focus-visible:ring-pulse-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950',
          checked ? 'border-pulse-400/60 bg-pulse-400/30' : 'border-white/12 bg-white/8 hover:border-white/20',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-[1.1rem] rounded-full transition-all duration-300',
            checked
              ? 'left-[1.5rem] bg-pulse-300 shadow-[0_0_12px_rgba(56,245,192,0.8)]'
              : 'left-0.5 bg-mist-400',
          )}
          aria-hidden
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
            size === 'sm' ? 'px-2.5 py-1.5 text-2xs' : 'px-3.5 py-2 text-xs',
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
        <span className="figure text-mist-200">{format ? format(value) : value}</span>
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
