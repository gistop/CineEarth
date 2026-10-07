import { useEffect, useRef, useState } from 'react'
import { useUI, TL_H_DEFAULT } from '../store/ui'
import { useRoute } from '../features/route/routeStore'
import { timelineDuration } from '../features/route/pathMath'
import { useExport } from '../features/export/exportStore'
import { renderRouteVideo, takeScreenshot } from '../features/export/actions'
import TimelineTracks, { TimelineRuler, clampView } from './TimelineTracks'
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
  const tlHeight = useUI((s) => s.tlHeight)
  const setTlHeight = useUI((s) => s.setTlHeight)
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
  const cameraLocked = useUI((s) => s.cameraLocked)
  const setCameraLocked = useUI((s) => s.setCameraLocked)
  const sunOpen = useUI((s) => s.sunOpen)
  const toggleSunPanel = useUI((s) => s.toggleSunPanel)

  /* growth-line keyframe track (AE-style reveal %) */
  const growthLine = useReveal((s) => s.growthLine)
  const setGrowthLine = useReveal((s) => s.setGrowthLine)

  const route = useRoute((s) => s.route)
  const progress = useRoute((s) => s.progress)
  const setProgress = useRoute((s) => s.setProgress)

  const exportStatus = useExport((s) => s.status)
  const exportProgress = useExport((s) => s.progress)

  /* the ruler's domain = the timeline length setting (not the content end) */
  const DURATION = timelineDuration(route)
  const rendering = exportStatus === 'rendering'

  /* live resize of the expanded panel — the top edge is the grip */
  const [resizing, setResizing] = useState(false)

  /* ONE ruler, always in the transport bar: collapsed = full overview,
     expanded = view-windowed. Its measured edges feed --ce-tl-axis-l/r so the
     tracks grid below aligns its lane column to the ruler pixel-for-pixel. */
  const tlView = useUI((s) => s.tlView)
  const footerRef = useRef<HTMLElement>(null)
  const rulerSlotRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const foot = footerRef.current
    const slot = rulerSlotRef.current
    if (!foot || !slot) return
    const sync = () => {
      const f = foot.getBoundingClientRect()
      const r = slot.getBoundingClientRect()
      foot.style.setProperty('--ce-tl-axis-l', `${r.left - f.left}px`)
      foot.style.setProperty('--ce-tl-axis-r', `${f.right - r.right}px`)
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(slot) // catches sibling width changes (render %, timecode…)
    ro.observe(foot)
    return () => ro.disconnect()
  }, [])

  return (
    <footer ref={footerRef} className={`ce-timeline${resizing ? ' is-resizing' : ''}`} data-expanded={expanded}>
      {/* drag-to-resize handle (expanded only): pointer capture keeps the drag
          alive outside the 5px strip; double-click / Home resets to default */}
      {expanded && (
        <div
          className={`ce-tl-resize${resizing ? ' is-active' : ''}`}
          role="separator"
          aria-orientation="horizontal"
          aria-label="时间轴高度"
          title="拖动调整高度 · 双击复位"
          tabIndex={0}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            setResizing(true)
          }}
          onPointerMove={(e) => {
            if (!(e.buttons & 1)) return
            /* bottom-anchored panel: height = distance from the screen bottom */
            setTlHeight(window.innerHeight - e.clientY)
          }}
          onPointerUp={() => setResizing(false)}
          onPointerCancel={() => setResizing(false)}
          onDoubleClick={() => setTlHeight(TL_H_DEFAULT)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setTlHeight(tlHeight + 16)
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setTlHeight(tlHeight - 16)
            } else if (e.key === 'Home') {
              e.preventDefault()
              setTlHeight(TL_H_DEFAULT)
            }
          }}
        />
      )}
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

        {/* the ONE ruler — this slot is its home in BOTH states (never moves);
            expanded it carries the view window, collapsed the full overview */}
        <div className="ce-tl-ruler-slot" ref={rulerSlotRef}>
          <TimelineRuler view={expanded ? clampView(tlView, DURATION) : undefined} />
        </div>

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

      {/* expanded editor — when collapsed it hides entirely (stays mounted so
          solo / selection survive); the bar's ruler covers scrubbing */}
      <TimelineTracks />
    </footer>
  )
}
