export default function BrandMark({ size = 34, withWord = true, tone = 'hi' }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--size-space-3)' }}>
      <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
        <defs>
          <linearGradient id="mise-lid" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FFD28A" />
            <stop offset="100%" stopColor="#FF8A3D" />
          </linearGradient>
        </defs>
        <rect x="0.5" y="0.5" width="39" height="39" rx="11" fill="#171310" stroke="#3E342D" />
        <path d="M8 25.5C8 18.6 13.4 13 20 13s12 5.6 12 12.5H8z" fill="url(#mise-lid)" />
        <path d="M6 28.5h28" stroke="#7ED9A6" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="20" cy="9.5" r="2.6" fill="#FFF8F1" />
        <path d="M25.5 19.5c1.8-1.4 1.6-3.6-.4-4.8" stroke="#1A120C" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity=".5" />
      </svg>
      {withWord ? (
        <span style={{ fontFamily: 'var(--font-family-display)', fontWeight: 700, letterSpacing: '-0.02em', fontSize: 'var(--font-size-md)', color: `var(--color-text-${tone})` }}>
          Mise
          <span style={{ color: 'var(--color-text-low)', fontWeight: 500 }}> · kitchen co-pilot</span>
        </span>
      ) : null}
    </span>
  );
}
