// Sun & time-of-day panel — the globe is lit by the Cesium clock: setting
// clock.currentTime moves the sun (direction + day/night terminator).
// Pure state → viewer sync, so screenshots / video exports pick it up too.
//
// Day/night shading has three modes (segmented control at the bottom):
//  · auto   — Cesium stock: shading fades out as the camera nears the ground
//             (lightingFadeOut/InDistance ≈ π/2·R → π·R), so close-ups are lit
//  · always — the fade window is collapsed to ~0: day/night holds at ANY zoom
//             (a study area stays dark at night even zoomed in)
//  · off    — enableLighting false: no terminator anywhere; sky & ground
//             atmosphere drop their dynamic lighting with it (Cesium derives
//             both from the same globe flags)

import { useEffect, useState, type ComponentType } from 'react'
import { JulianDate, type Viewer } from 'cesium'
import { getViewer } from '../../cesium/viewerRegistry'
import { useUI } from '../../store/ui'
import { PlayIcon, PauseIcon, CloseIcon, ClockIcon, DayNightIcon, DayNightZoomIcon, DayNightOffIcon } from '../../components/Icons'

const MINUTES_PER_DAY = 24 * 60
const PLAYBACK_RATE = 600 // simulated × real time
const TICK_MS = 100

type LightMode = 'auto' | 'always' | 'off'

const LIGHT_MODES: {
  id: LightMode
  label: string
  title: string
  Icon: ComponentType<{ size?: number; className?: string }>
}[] = [
  {
    id: 'auto',
    label: '昼夜（默认）',
    title: '默认 — 远景有昼夜明暗，贴近地面后自动变亮（Cesium 出厂行为）',
    Icon: DayNightIcon,
  },
  {
    id: 'always',
    label: '昼夜（全程）',
    title: '全程 — 昼夜明暗在任何缩放级别都生效，放大到研究区夜里仍是夜',
    Icon: DayNightZoomIcon,
  },
  {
    id: 'off',
    label: '昼夜（关闭）',
    title: '关闭 — 昼夜明暗完全关闭，地表恒亮，太阳只移动位置不出明暗',
    Icon: DayNightOffIcon,
  },
]

/** push a mode to the live globe. GlobeFS mixes shading by
 *  fade = clamp((cameraDist - fadeOut) / (fadeIn - fadeOut)) — a ~0 window
 *  keeps fade pinned at 1 (full shading) for every real camera distance;
 *  restoring the π-based Cesium defaults hands "auto" back its stock fade. */
function applyLighting(viewer: Viewer, mode: LightMode): void {
  const globe = viewer.scene.globe
  if (mode === 'off') {
    globe.enableLighting = false
    return
  }
  globe.enableLighting = true
  if (mode === 'always') {
    globe.lightingFadeOutDistance = 1
    globe.lightingFadeInDistance = 2
    globe.nightFadeOutDistance = 1
    globe.nightFadeInDistance = 2
  } else {
    const r = globe.ellipsoid.minimumRadius
    globe.lightingFadeOutDistance = Math.PI / 2 * r
    globe.lightingFadeInDistance = Math.PI * r
    globe.nightFadeOutDistance = Math.PI / 2 * r
    globe.nightFadeInDistance = 5 * Math.PI / 2 * r
  }
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function formatDateInput(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function formatTime(minuteOfDay: number) {
  return `${pad2(Math.floor(minuteOfDay / 60))}:${pad2(Math.floor(minuteOfDay % 60))}`
}

function createLocalDate(dateValue: string, minuteOfDay: number) {
  const [y, m, d] = dateValue.split('-').map(Number)
  return new Date(y, m - 1, d, Math.floor(minuteOfDay / 60), Math.floor(minuteOfDay % 60))
}

function shiftDateInput(dateValue: string, days: number) {
  const [y, m, d] = dateValue.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + days)
  return formatDateInput(date)
}

export default function SunPanel() {
  const open = useUI((s) => s.sunOpen)
  const toggleSunPanel = useUI((s) => s.toggleSunPanel)

  const [dateValue, setDateValue] = useState(() => formatDateInput(new Date()))
  const [minuteOfDay, setMinuteOfDay] = useState(() => {
    const n = new Date()
    return n.getHours() * 60 + n.getMinutes()
  })
  const [playing, setPlaying] = useState(false)
  const [lightMode, setLightMode] = useState<LightMode>('auto')

  /* time-lapse: 600× — crossing midnight rolls the date forward */
  useEffect(() => {
    if (!playing) return
    const step = (PLAYBACK_RATE * TICK_MS) / 60_000
    const timer = window.setInterval(() => {
      setMinuteOfDay((cur) => {
        const next = cur + step
        if (next < MINUTES_PER_DAY) return next
        setDateValue((d) => shiftDateInput(d, 1))
        return next % MINUTES_PER_DAY
      })
    }, TICK_MS)
    return () => window.clearInterval(timer)
  }, [playing])

  /* state → viewer: sun position follows clock time; shading mode rides along */
  useEffect(() => {
    if (!open) return
    const viewer = getViewer()
    if (!viewer || viewer.isDestroyed()) return
    viewer.clock.currentTime = JulianDate.fromDate(createLocalDate(dateValue, minuteOfDay))
    viewer.clock.shouldAnimate = false
    applyLighting(viewer, lightMode)
  }, [open, dateValue, minuteOfDay, lightMode])

  if (!open) return null

  const rounded = Math.round(minuteOfDay) % MINUTES_PER_DAY

  return (
    <section className="ce-sun-panel" aria-label="Sun & time of day">
      <div className="ce-sun-head">
        <strong>Sun</strong>
        <button
          type="button"
          className={`ce-icon-btn${playing ? ' is-on' : ''}`}
          title={playing ? 'Pause time (600×)' : 'Play time (600×)'}
          aria-pressed={playing}
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          type="button"
          className="ce-icon-btn"
          title="Reset to now"
          onClick={() => {
            const n = new Date()
            setDateValue(formatDateInput(n))
            setMinuteOfDay(n.getHours() * 60 + n.getMinutes())
            setPlaying(false)
          }}
        >
          <ClockIcon />
        </button>
        <button
          type="button"
          className="ce-icon-btn"
          title="Close (Esc)"
          onClick={() => {
            setPlaying(false)
            toggleSunPanel(false)
          }}
        >
          <CloseIcon />
        </button>
      </div>

      <input
        className="ce-sun-date"
        type="date"
        value={dateValue}
        aria-label="Date"
        onChange={(e) => e.target.value && setDateValue(e.target.value)}
      />

      <div className="ce-sun-slider">
        <input
          type="range"
          min={0}
          max={MINUTES_PER_DAY - 1}
          step={1}
          value={rounded}
          aria-label="Time of day"
          onChange={(e) => {
            setPlaying(false)
            setMinuteOfDay(Number(e.target.value))
          }}
        />
        <output>{formatTime(rounded)}</output>
      </div>

      <div className="ce-sun-modes" role="group" aria-label="Day/night shading mode">
        {LIGHT_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`ce-sun-mode${lightMode === m.id ? ' is-on' : ''}`}
            title={m.title}
            aria-label={m.label}
            aria-pressed={lightMode === m.id}
            onClick={() => setLightMode(m.id)}
          >
            <m.Icon size={16} />
          </button>
        ))}
      </div>
    </section>
  )
}
