// Sun & time-of-day panel — the globe is lit by the Cesium clock: setting
// clock.currentTime moves the sun (direction + day/night terminator).
// Pure state → viewer sync, so screenshots / video exports pick it up too.

import { useEffect, useState } from 'react'
import { JulianDate } from 'cesium'
import { getViewer } from '../../cesium/viewerRegistry'
import { useUI } from '../../store/ui'
import { PlayIcon, PauseIcon, CloseIcon, ClockIcon } from '../../components/Icons'

const MINUTES_PER_DAY = 24 * 60
const PLAYBACK_RATE = 600 // simulated × real time
const TICK_MS = 100

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

  /* state → viewer: sun position follows clock time */
  useEffect(() => {
    if (!open) return
    const viewer = getViewer()
    if (!viewer || viewer.isDestroyed()) return
    viewer.clock.currentTime = JulianDate.fromDate(createLocalDate(dateValue, minuteOfDay))
    viewer.clock.shouldAnimate = false
    viewer.scene.globe.enableLighting = true
  }, [open, dateValue, minuteOfDay])

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
    </section>
  )
}
