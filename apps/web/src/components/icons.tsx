import type { CSSProperties } from 'react'

export const PATHS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  timeline: 'M6 3v18M6 6h0M10 6h10M10 12h10M10 18h6',
  review: 'M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5M12 8v4l3 2',
  progress: 'M3 21h18M6 18v-6M11 18V6M16 18v-9M21 18V9',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  pin: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z',
  book: 'M4 19.5V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2zM8 7h8',
  moon: 'M20.5 13.5A8.5 8.5 0 1 1 10.5 3.5a6.5 6.5 0 0 0 10 10z',
  chevron: 'M6 9l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  target: 'M12 3v3M12 18v3M3 12h3M18 12h3M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  layers: 'M12 3 3 8l9 5 9-5-9-5zM3 12.5l9 5 9-5M3 17l9 5 9-5',
  close: 'M6 6l12 12M18 6 6 18',
} as const

export function Icon({ d, size = 22, sw = 1.8, style }: { d: keyof typeof PATHS; size?: number; sw?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
      <path d={PATHS[d]} />
    </svg>
  )
}

export const GlobeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>
)
export const SunIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
)

/** Compass for the 3D view: the needle turns against the map's bearing, so it always points north. */
export const CompassIcon = ({ bearing = 0 }: { bearing?: number }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="1.6" />
    <g style={{ transform: `rotate(${-bearing}deg)`, transformOrigin: '12px 12px' }}>
      <path d="M12 5.2 14.6 12H9.4z" fill="var(--primary)" />
      <path d="M12 18.8 9.4 12h5.2z" fill="currentColor" opacity=".35" />
    </g>
  </svg>
)
