import { useRef } from 'react'
import { useUI } from '../store/ui'
import { useRoute } from '../features/route/routeStore'
import { totalDuration, waypointFractions } from '../features/route/pathMath'
import { useExport } from '../features/export/exportStore'
import { renderRouteVideo, takeScreenshot } from '../features/export/actions'
import { useReveal } from '../features/route/revealStore'
import {
  SlidersIcon,
  GrowthIcon,
  SunIcon,
  LockIcon,
  PlayIcon,
  PauseIcon,
  TargetIcon,
  SkipStartIcon,
  SkipEndIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ExpandIcon,
  RouteIcon,
  CameraIcon,
  RenderIcon,
} from './Icons'

/** Bottom timeline — thin transport bar (default) / multi-track editor (expanded). */
export default function Timeline() {
  const expanded = useUI((s) => s.timelineExpanded)
  const toggleTimeline = useUI((s) => s.toggleTimeline)
  const setPreviewMode = useUI((s) => s.setPreviewMode)
  const toggleRightDrawer = useUI((s) => s.toggleRightDrawer)
  const rightDrawerOpen = useUI((s) => s.rightDrawerOpen)
  const drawerOpen = useUI((s) => s.drawerOpen)
  const toggleDrawer = useUI((s) => s.toggleDrawer)
  const targetPickMode = useUI((s) => s.targetPickMode)
  const setTargetPickMode = useUI((s) => s.setTargetPickMode)
  const hasTarget = useRoute((s) => s.route.target != null)
  const setTarget = useRoute((s) => s.setTarget)
  const playing = useUI((s) => s.playing)
  const setPlaying = useUI((s) => s.setPlaying)
  const setScrubbing = useUI((s) => s.setScrubbing)
  const cameraLocked = useUI((s) => s.cameraLocked)
  const setCameraLocked = useUI((s) => s.setCameraLocked)
  const sunOpen = useUI((s) => s.sunOpen)
  const toggleSunPanel = useUI((s) => s.toggleSunPanel)

  /* growth-line keyframe track (AE-style reveal %) */
  const growthLine = useReveal((s) => s.growthLine)
  const setGrowthLine = useReveal((s) => s.setGrowthLine)
  const revealKeys = useReveal((s) => s.keys)
  const revealSelected = useReveal((s) => s.selectedKeyId)
  const addRevealKey = useReveal((s) => s.addKey)
  const moveRevealKey = useReveal((s) => s.moveKey)
  const removeRevealKey = useReveal((s) => s.removeKey)
  const selectRevealKey = useReveal((s) => s.selectKey)

  const route = useRoute((s) => s.route)
  const progress = useRoute((s) => s.progress)
  const setProgress = useRoute((s) => s.setProgress)

  const exportStatus = useExport((s) => s.status)
  const exportProgress = useExport((s) => s.progress)

  const DURATION = Math.max(0.1, totalDuration(route))
  const scrubRef = useRef<HTMLDivElement>(null)

  /* pointer scrubbing */
  const scrubTo = (clientX: number) => {
    const el = scrubRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setProgress((clientX - r.left) / r.width)
  }

  /* reveal-track helpers: lane x → playhead fraction & key dragging */
  const revealLaneRef = useRef<HTMLDivElement>(null)
  const revealDragRef = useRef<{ id: string; x: number; y: number; t: number; v: number } | null>(null)

  const revealLaneT = (clientX: number) => {
    const el = revealLaneRef.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width))
  }

  const sortedRevealKeys = [...revealKeys].sort((a, b) => a.t - b.t)

  const cameraKeys = waypointFractions(route).map((f) => f * 100)
  const ticks = buildTicks(DURATION)
  const rendering = exportStatus === 'rendering'

  return (
    <footer className="ce-timeline" data-expanded={expanded}>
      <div className="ce-tl-bar">
        <div className="ce-transport">
          <button
            type="button"
            className={`ce-icon-btn${growthLine ? ' is-on' : ''}`}
            title="Growth line — keyframed path reveal (G)"
            aria-pressed={growthLine}
            onClick={() => setGrowthLine(!growthLine)}
          >
            <GrowthIcon />
          </button>
          <button
            type="button"
            className={`ce-icon-btn${cameraLocked ? ' is-on' : ''}`}
            title="Lock camera — freeze the viewpoint; growth keeps playing (C)"
            aria-pressed={cameraLocked}
            onClick={() => setCameraLocked(!cameraLocked)}
          >
            <LockIcon />
          </button>
          <button
            type="button"
            className={`ce-icon-btn${sunOpen ? ' is-on' : ''}`}
            title="Sun & time of day (S)"
            aria-pressed={sunOpen}
            onClick={() => toggleSunPanel()}
          >
            <SunIcon />
          </button>
          <button
            type="button"
            className={`ce-icon-btn${drawerOpen ? ' is-on' : ''}`}
            title="Tools (T)"
            aria-pressed={drawerOpen}
            onClick={() => toggleDrawer()}
          >
            <SlidersIcon />
          </button>
          <button type="button" className="ce-icon-btn" title="Go to start"
            onClick={() => { setProgress(0); setPlaying(false) }}>
            <SkipStartIcon />
          </button>
          <button
            type="button"
            className={`ce-play${playing ? ' is-playing' : ''}`}
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
            onClick={() => setPlaying(!playing)}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button type="button" className="ce-icon-btn" title="Go to end"
            onClick={() => { setProgress(1); setPlaying(false) }}>
            <SkipEndIcon />
          </button>
        </div>

        <div
          ref={scrubRef}
          className="ce-scrub"
          role="slider"
          aria-label="Playhead"
          aria-valuemin={0}
          aria-valuemax={DURATION}
          aria-valuenow={Math.round(progress * DURATION * 10) / 10}
          tabIndex={0}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            setScrubbing(true)
            scrubTo(e.clientX)
          }}
          onPointerMove={(e) => {
            if (e.buttons === 1) scrubTo(e.clientX)
          }}
          onPointerUp={() => setScrubbing(false)}
          onPointerCancel={() => setScrubbing(false)}
        >
          <div className="ce-scrub-track" />
          <div className="ce-scrub-fill" style={{ width: `${progress * 100}%` }} />
          {cameraKeys.map((k, i) => (
            <span key={i} className="ce-scrub-key" style={{ left: `${k}%` }} />
          ))}
          <div className="ce-scrub-knob" style={{ left: `${progress * 100}%` }} />
        </div>

        <span className="ce-timecode">
          {fmt(progress * DURATION)} / {fmt(DURATION)}
        </span>

        <div className="ce-tl-actions">
          <button
            type="button"
            className={`ce-icon-btn${targetPickMode || hasTarget ? ' is-on' : ''}`}
            title={
              targetPickMode
                ? 'Camera target — click the globe to place it (Esc to cancel)'
                : hasTarget
                  ? 'Camera target active — click to remove'
                  : 'Set camera target (camera keeps aiming at it)'
            }
            onClick={() => {
              if (targetPickMode) setTargetPickMode(false)
              else if (hasTarget) setTarget(null)
              else setTargetPickMode(true)
            }}
          >
            <TargetIcon />
          </button>
          <button
            type="button"
            className={`ce-icon-btn${rightDrawerOpen ? ' is-on' : ''}`}
            title="Route editor (R)"
            aria-pressed={rightDrawerOpen}
            onClick={() => toggleRightDrawer()}
          >
            <RouteIcon />
          </button>
          <button type="button" className="ce-icon-btn" title="Screenshot" onClick={takeScreenshot}>
            <CameraIcon />
          </button>
          <button
            type="button"
            className={`ce-render-btn${rendering ? ' is-rendering' : ''}${exportStatus === 'error' ? ' is-error' : ''}`}
            title={
              exportStatus === 'error'
                ? useExport.getState().error ?? 'Render failed'
                : rendering
                  ? `Rendering ${Math.round(exportProgress * 100)}% — click to cancel`
                  : 'Render video (MP4)'
            }
            onClick={renderRouteVideo}
          >
            {rendering ? (
              <span className="ce-render-label">{Math.round(exportProgress * 100)}%</span>
            ) : (
              <RenderIcon />
            )}
          </button>
          <span className="ce-tl-sep" />
          <button type="button" className="ce-icon-btn" title={expanded ? 'Collapse timeline' : 'Expand timeline'}
            onClick={() => toggleTimeline()}>
            {expanded ? <ChevronDownIcon /> : <ChevronUpIcon />}
          </button>
          <button type="button" className="ce-icon-btn" title="Fullscreen preview"
            onClick={() => setPreviewMode(true)}>
            <ExpandIcon />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="ce-tracks" style={{ '--ph': progress } as React.CSSProperties}>
          <div className="ce-ruler">
            <span className="ce-ruler-spacer" />
            <div className="ce-ruler-lane">
              {ticks.map((s) => (
                <span key={s} className="ce-ruler-tick" style={{ left: `${(s / DURATION) * 100}%` }}>
                  {s}s
                </span>
              ))}
            </div>
          </div>

          <div className="ce-track">
            <span className="ce-track-label">Camera</span>
            <div className="ce-track-lane">
              {cameraKeys.map((k, i) => (
                <span key={i} className="ce-key" style={{ left: `${k}%` }} title={`Waypoint ${i + 1}`} />
              ))}
            </div>
          </div>

          {/* growth line — keyframed reveal %: dbl-click lane adds a key,
              drag a key to move in time (x) / change % (y, up = more),
              dbl-click a key removes it */}
          <div className="ce-track">
            <span className="ce-track-label">Growth</span>
            <div
              ref={revealLaneRef}
              className="ce-track-lane ce-reveal-lane"
              title="Growth % · dbl-click: add key · drag: time / % · dbl-click key: delete"
              onDoubleClick={(e) => {
                if ((e.target as HTMLElement).closest('.ce-reveal-key')) return
                addRevealKey(revealLaneT(e.clientX))
              }}
            >
              <svg className="ce-reveal-curve" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <polyline
                  points={sortedRevealKeys.map((k) => `${k.t * 100},${100 - k.value}`).join(' ')}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              {sortedRevealKeys.map((k) => (
                <span
                  key={k.id}
                  className={`ce-key ce-reveal-key${k.id === revealSelected ? ' is-selected' : ''}`}
                  style={{ left: `${k.t * 100}%` }}
                  title={`${Math.round(k.value)}% @ ${(k.t * DURATION).toFixed(1)}s`}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    e.currentTarget.setPointerCapture(e.pointerId)
                    revealDragRef.current = { id: k.id, x: e.clientX, y: e.clientY, t: k.t, v: k.value }
                    selectRevealKey(k.id)
                  }}
                  onPointerMove={(e) => {
                    const d = revealDragRef.current
                    if (!d || e.buttons !== 1) return
                    const r = revealLaneRef.current?.getBoundingClientRect()
                    if (!r) return
                    const nextT = Math.min(1, Math.max(0, d.t + (e.clientX - d.x) / r.width))
                    const nextV = Math.min(100, Math.max(0, d.v - (e.clientY - d.y) * 0.5))
                    moveRevealKey(d.id, nextT, nextV)
                  }}
                  onPointerUp={() => {
                    revealDragRef.current = null
                  }}
                  onPointerCancel={() => {
                    revealDragRef.current = null
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    removeRevealKey(k.id)
                  }}
                />
              ))}
            </div>
          </div>

          <div className="ce-track">
            <span className="ce-track-label">Heading</span>
            <div className="ce-track-lane" />
          </div>
          <div className="ce-track">
            <span className="ce-track-label">FOV</span>
            <div className="ce-track-lane" />
          </div>

          <div className="ce-playhead" />
        </div>
      )}
    </footer>
  )
}

function buildTicks(duration: number): number[] {
  const step = duration > 40 ? 10 : 5
  const ticks: number[] = []
  for (let s = 0; s < duration - 0.01; s += step) ticks.push(Math.round(s))
  return ticks
}

const fmt = (sec: number) => {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const d = Math.floor((sec % 1) * 10)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`
}
