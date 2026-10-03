/* Minimal stroke icon set — 1.6px strokes, currentColor */

type P = { size?: number; className?: string }

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

export const GrowthIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M4 19l5-6 4 4 6.4-10" />
    <circle cx="20" cy="6" r="1.7" />
  </svg>
)

export const LockIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <rect x="5.5" y="10.5" width="13" height="9.5" rx="2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5" />
  </svg>
)

export const SlidersIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
    <circle cx="16" cy="8" r="2" />
    <circle cx="10" cy="16" r="2" />
  </svg>
)

export const LayersIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M12 4l8 4.5-8 4.5-8-4.5L12 4z" />
    <path d="M4 13l8 4.5 8-4.5" />
  </svg>
)

export const FilmIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M7 5v14M17 5v14M3 10h4M3 14h4M17 10h4M17 14h4" />
  </svg>
)

export const TuneIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M5 5v5m0 4v5M12 5v9m0 4v1M19 5v1m0 4v9" />
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="16" r="2" />
    <circle cx="19" cy="8" r="2" />
  </svg>
)

export const FolderIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M3 7a2 2 0 012-2h4l2 2.5h8a2 2 0 012 2V17a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
  </svg>
)

export const CloseIcon = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

export const PlayIcon = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M8 5.5v13l10-6.5-10-6.5z" fill="currentColor" stroke="none" />
  </svg>
)

export const PauseIcon = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <rect x="7" y="5.5" width="3.4" height="13" rx="1" fill="currentColor" stroke="none" />
    <rect x="13.6" y="5.5" width="3.4" height="13" rx="1" fill="currentColor" stroke="none" />
  </svg>
)

export const SkipStartIcon = ({ size = 15, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M7 5.5v13" />
    <path d="M18 5.5v13L9 12l9-6.5z" fill="currentColor" stroke="none" />
  </svg>
)

export const SkipEndIcon = ({ size = 15, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M17 5.5v13" />
    <path d="M6 5.5v13L15 12 6 5.5z" fill="currentColor" stroke="none" />
  </svg>
)

export const ChevronUpIcon = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M6 14l6-6 6 6" />
  </svg>
)

export const ChevronDownIcon = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M6 10l6 6 6-6" />
  </svg>
)

export const ExpandIcon = ({ size = 15, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5" />
  </svg>
)

export const RouteIcon = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <circle cx="5.5" cy="18.5" r="2" />
    <circle cx="18.5" cy="5.5" r="2" />
    <path d="M7.2 16.8C9 12 11 10.5 12.5 10c2-.7 3.5-1.8 4.3-3.3" />
  </svg>
)

export const CameraIcon = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M4 8.5A1.5 1.5 0 015.5 7H8l1.4-2h5.2L16 7h2.5A1.5 1.5 0 0120 8.5v8a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 16.5v-8z" />
    <circle cx="12" cy="12.5" r="3.2" />
  </svg>
)

export const TargetIcon = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="7" />
    <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
  </svg>
)

export const RenderIcon = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M12 4v10m0 0l-3.5-3.5M12 14l3.5-3.5" />
    <path d="M5 17.5v1A1.5 1.5 0 006.5 20h11a1.5 1.5 0 001.5-1.5v-1" />
  </svg>
)

export const SunIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
  </svg>
)

export const ClockIcon = ({ size = 15, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
)
