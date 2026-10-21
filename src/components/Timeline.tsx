import { useEffect, useRef, useState } from 'react'
import { useUI, TL_H_DEFAULT } from '../store/ui'
import { useRoute } from '../features/route/routeStore'
import { timelineDuration } from '../features/route/pathMath'
import { useExport } from '../features/export/exportStore'
import { renderRouteVideo, takeScreenshot } from '../features/export/actions'
import { useT } from '../i18n'
import { useDraw } from '../features/assets/drawStore'
import TimelineTracks, { TimelineRuler, clampView } from './TimelineTracks'
// HIDDEN (parked, not removed): growth-line & lock-camera toolbar entries —
// restore together with their state reads, imports and the G/C hotkeys in App.
// import { useReveal } from '../features/route/revealStore'
import {
  GridIcon,
  // GrowthIcon,
  SunIcon,
  // LockIcon,
  PlayIcon,
  PauseIcon,
  TargetIcon,
  SkipStartIcon,
  SkipEndIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  RulerIcon,
  PointIcon,
  PolylineIcon,
  PolygonIcon,
  ExpandIcon,
  RouteIcon,
  CameraIcon,
  RenderIcon,
  PenIcon,
} from './Icons'

/** Bottom timeline — thin transport bar (default) / multi-track editor (expanded). */
export default function Timeline() {
  const t = useT()
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
  const hasTarget = useRoute((s) => s.route?.target != null)
  const setTarget = useRoute((s) => s.setTarget)
  const playing = useUI((s) => s.playing)
  const setPlaying = useUI((s) => s.setPlaying)
  // const cameraLocked = useUI((s) => s.cameraLocked)
  // const setCameraLocked = useUI((s) => s.setCameraLocked)
  const sunOpen = useUI((s) => s.sunOpen)
  const toggleSunPanel = useUI((s) => s.toggleSunPanel)

  /* growth-line keyframe track (AE-style reveal %) — buttons parked
  const growthLine = useReveal((s) => s.growthLine)
  const setGrowthLine = useReveal((s) => s.setGrowthLine)
  */

  const route = useRoute((s) => s.route)
  const setProgress = useRoute((s) => s.setProgress)

  const exportStatus = useExport((s) => s.status)
  const exportProgress = useExport((s) => s.progress)

  /* the ruler's domain = the timeline length setting (not the content end).
     No active shot → nothing to measure; a zero domain keeps the ruler inert. */
  const DURATION = route ? timelineDuration(route) : 0
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
          aria-label={t('tl.heightAria')}
          title={t('tl.heightTitle')}
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
          {/* PARKED: growth-line & lock-camera — multi-shot review pending
              (per-shot semantics unclear for a session-wide lock). Re-enable
              with the imports, state reads and the G/C hotkeys in App.tsx.
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
          */}
          <ToolSplitButton />
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
            <GridIcon />
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
          <button type="button" className="ce-icon-btn" title={t('tl.screenshot')} onClick={takeScreenshot}>
            <CameraIcon />
          </button>
          <button
            type="button"
            className={`ce-render-btn${rendering ? ' is-rendering' : ''}${exportStatus === 'error' ? ' is-error' : ''}`}
            disabled={!route && !rendering}
            title={
              exportStatus === 'error'
                ? useExport.getState().error ?? t('tl.renderFail')
                : rendering
                  ? t('tl.rendering', { p: Math.round(exportProgress * 100) })
                  : route
                    ? t('tl.render')
                    : t('tl.renderNoRoute')
            }
            onClick={renderRouteVideo}
          >
            {rendering ? (
              <span className="ce-render-label">{Math.round(exportProgress * 100)}%</span>
            ) : (
              <RenderIcon />
            )}
          </button>
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

/* Map-tools button — same icon-button size/shape as its sun/route siblings
   (no split caret). Click opens a menu that grows UP from the bar: level 1
   lists tool GROUPS (draw, measure…) as square tiles; clicking a group fans
   a horizontal row of tool tiles out to the RIGHT (click-to-expand, touch
   safe). While a tool is active the button shows its state and clicking it
   again exits the mode. First tool: draw a ground-clamped line; point/
   polygon & measure are placeholders. */
function ToolSplitButton() {
  const t = useT()
  const drawing = useDraw((s) => s.drawing)
  const [open, setOpen] = useState(false)
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const closeMenu = () => {
    setOpen(false)
    setOpenGroup(null)
  }

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) closeMenu()
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <div className="ce-tools-anchor" ref={rootRef}>
      <button
        type="button"
        className={`ce-icon-btn${drawing ? ' is-on' : ''}`}
        title={drawing ? t('tools.exitDraw') : t('tools.title')}
        aria-pressed={drawing}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (drawing ? useDraw.getState().cancelLine() : setOpen((o) => !o))}
      >
        <PenIcon />
      </button>

      {open && (
        <div className="ce-tools-menu" role="menu" aria-label={t('tools.menuAria')}>
          <div className={`ce-tools-item${openGroup === 'draw' ? ' is-open' : ''}`}>
            <button
              type="button"
              className="ce-tools-tile"
              aria-haspopup="menu"
              aria-expanded={openGroup === 'draw'}
              title={t('tools.group.draw')}
              onClick={() => setOpenGroup((g) => (g === 'draw' ? null : 'draw'))}
            >
              <PenIcon size={17} />
              <span>{t('tools.group.draw')}</span>
            </button>
            {openGroup === 'draw' && (
              <div className="ce-tools-sub" role="menu">
                <button type="button" className="ce-tools-tile" disabled title={t('tools.soon')}>
                  <PointIcon />
                  <span>{t('tools.draw.point')}</span>
                </button>
                <button
                  type="button"
                  className="ce-tools-tile"
                  onClick={() => {
                    closeMenu()
                    useDraw.getState().startLine()
                  }}
                >
                  <PolylineIcon />
                  <span>{t('tools.draw.line')}</span>
                </button>
                <button type="button" className="ce-tools-tile" disabled title={t('tools.soon')}>
                  <PolygonIcon />
                  <span>{t('tools.draw.polygon')}</span>
                </button>
              </div>
            )}
          </div>
          <div className="ce-tools-item">
            <button
              type="button"
              className="ce-tools-tile"
              disabled
              title={t('tools.group.measure')}
            >
              <RulerIcon size={17} />
              <span>{t('tools.group.measure')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
