// Multi-viewport stage — the N-机位 split view over the main map area.
// Layout rules (定案):
//   · 等分 (minimizedShotIds empty) → EVERY shot tiles the main grid equally
//     (k ≤ 3 → one row; larger k → near-square grid).
//   · a collapsed shot leaves the grid for the scrollable right rail of
//     thumbs (main area never scrolls). Collapsing one shot never moves any
//     other — 大/小 is a PURE per-shot visual preference.
//   · EDITING is decoupled from size: the main globe (the only interactive
//     map) overlays the ACTIVE shot's slot; if the active shot itself is
//     collapsed, the grid APPENDS one editor slot for it (so collapsing the
//     active shot costs no grid cell — one leaves, one editor appears).
// Gestures: single click = activate ONLY (never resizes anything; the panes
//   are non-interactive monitors, and map gestures on the main globe stay
//   untouched). 大/小 switching is EXCLUSIVELY the hover buttons (⤡ collapse
//   on slots / ⤢ expand on thumbs) — no double-click anywhere.
// The interactive main globe NEVER remounts: it stays the LAST grid child
// (an overlay ON TOP of the active/editor slot) and only its gridArea style
// moves — Cesium camera, Ion bootstrap and gesture handlers survive every
// layout change, and so does every pane: each slot owns a PERSISTENT
// ShotPane (key = shot.id), muted while the overlay covers it.

import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Entity,
  ImageryLayer,
  ScreenSpaceEventType,
  Viewer,
} from 'cesium'
import { getViewer, setProgramRefresh, setProgramViewer } from '../cesium/viewerRegistry'
import { bindImagery, getImageryProvider } from '../cesium/imagerySource'
import { useUI } from '../store/ui'
import { useExport } from '../features/export/exportStore'
import { applyFraming, frameOf } from '../features/route/framing'
import { programShotAt, useRoute } from '../features/route/routeStore'
import { hasPosition } from '../features/route/types'
import { buildShotRouteEntities } from '../features/route/routeEntities'
import GlobeViewport from './GlobeViewport'

/* ------------------------------------------------------------------ */
/* ShotPane — one lightweight per-机位 Cesium view (imperative island) */
/* ------------------------------------------------------------------ */

type PaneVariant = 'pane' | 'thumb' | 'program'

/** follow-throttle budgets (ms): a pane/thumb never needs 60fps — capping the
 *  per-frame setView+requestRender work is what makes 8+ live views viable */
const FOLLOW_MS: Record<PaneVariant, number> = { pane: 50, thumb: 100, program: 50 }

/** quality dial per variant. Set at runtime, NOT at construction: a shot
 *  moving between the main grid and the rail only re-dials its existing
 *  Viewer — rebuilding it would flash and re-fetch tiles on every double
 *  click (主/次 归属切换). */
const QUALITY: Record<PaneVariant, { scale: number; sse: number; cache: number }> = {
  pane: { scale: 0.85, sse: 3, cache: 80 },
  thumb: { scale: 0.55, sse: 5, cache: 40 },
  /* Program Out is what the export will look like — the best of the panes */
  program: { scale: 0.9, sse: 3, cache: 100 },
}

function applyQuality(v: Viewer, variant: PaneVariant): void {
  const q = QUALITY[variant]
  v.resolutionScale = q.scale
  v.scene.globe.maximumScreenSpaceError = q.sse
  v.scene.globe.tileCacheSize = q.cache
}

/** 'program' — a source key that can never collide with a shot id */
const PROGRAM_SOURCE = '\u0000program'

function ShotPane({
  shotId,
  variant,
  muted = false,
  followProgram = false,
}: {
  /** the FIXED source shot; ignored when followProgram is set */
  shotId?: string
  variant: PaneVariant
  /** covered by the main-globe overlay: the pane keeps its Viewer but stops
   *  following the store and stops queuing GPU frames (an invisible pane that
   *  keeps rendering is pure waste). Unmuting catches up in ONE shot. */
  muted?: boolean
  /** Program Out mode: the source is whatever 主输出 puts on air at the
   *  playhead. Crossing a cut re-targets the camera AND the entities inside
   *  the SAME Viewer — the monitor never rebuilds (that would flash). */
  followProgram?: boolean
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const mutedRef = useRef(muted)
  const variantRef = useRef(variant)
  /** the live Viewer — owned by the mount effect, read by the dial effects */
  const viewerRef = useRef<Viewer | null>(null)
  /** filled by the mount effect — one-shot catch-up on unmute */
  const refreshRef = useRef<() => void>(() => {})

  /** stable identity of this pane's SOURCE for the mount effect: a Program
   *  Out monitor must NOT rebuild when the on-air shot changes (it re-targets
   *  inside its own Viewer); a fixed pane must rebuild for its own shot only */
  const sourceKey = followProgram ? PROGRAM_SOURCE : shotId ?? ''

  /* mute is a render-external flag the store subscription must see live */
  useEffect(() => {
    const was = mutedRef.current
    mutedRef.current = muted
    if (was === muted || muted) return
    /* uncovered — entities, framing and the frame itself in one pass */
    refreshRef.current()
  }, [muted])

  /* variant switch (main grid ↔ rail) = RE-DIAL this very Viewer. Rebuilding
     it would flash and re-fetch tiles on every double click. */
  useEffect(() => {
    variantRef.current = variant
    const v = viewerRef.current
    if (!v || v.isDestroyed()) return
    applyQuality(v, variant)
    v.scene.requestRender()
  }, [variant])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let viewer: Viewer | undefined
    try {
      /* detached credit sink: attributions must exist but never paint */
      const creditHost = document.createElement('div')
      viewer = new Viewer(host, {
        /* the SHARED source — same provider INSTANCE as the main globe (one
           tile pipeline, one HTTP cache). Never captured from "layer 0 of the
           main viewer": that snapshot raced ion's async AERIAL swap and left
           early panes stuck on the OSM placeholder. */
        baseLayer: new ImageryLayer(getImageryProvider()),
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        creditContainer: creditHost,
        requestRenderMode: true,
      })
    } catch (err) {
      console.error('[CineEarth] pane viewer failed to initialise', err)
      return
    }

    /* ---- quality dial: panes/thumbs pay a fraction of the main cost ---- */
    const v = viewer
    const scene = v.scene
    viewerRef.current = v
    /* the exporter renders THIS Viewer — register the Program Out monitor so
       the export can resolve it without touching the React tree */
    if (followProgram) setProgramViewer(v)
    applyQuality(v, variantRef.current)
    scene.msaaSamples = 1
    /* follow the shared imagery source: a swap (ion AERIAL landing, or a new
       token) re-dials this pane too — no creation-order races */
    const unsubImagery = bindImagery(v)
    /* sky & atmosphere stay ON — visual parity with the main globe matters
       more than the tiny saving (one skybox sample + one atmosphere pass);
       the EXPENSIVE things are terrain/imagery, already throttled above. A
       grid where one pane is blue-skyed and the rest black reads as two
       different apps. */
    if (scene.sun) scene.sun.show = false
    if (scene.moon) scene.moon.show = false
    v.shadows = false
    /* camera STRICTLY follows its route — panes are monitors, not editors */
    scene.screenSpaceCameraController.enableInputs = false
    /* kill the default click/double-click entity handlers so DOM gestures on
       the wrapper are the only interaction */
    v.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_CLICK)
    v.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK)

    /* terrain provider SHARED with the main globe — one request storm, one
       decode pipeline; GPU textures stay per-viewer (Cesium constraint) */
    try {
      const main = getViewer()
      if (main && !main.isDestroyed()) v.terrainProvider = main.terrainProvider
    } catch {
      /* main not up yet — ellipsoid terrain is fine for a cold pane */
    }

    /* ---- static per-shot entities: spline + waypoint dots + target halo.
       No CallbackProperty here — N panes × per-frame JS callbacks was the
       main-thread bomb; panes re-read the store only on real changes. ---- */
    let entities: Entity[] = []
    /** the shot this pane renders RIGHT NOW — fixed, or whatever 主输出 has
     *  on air at the playhead (Program Out mode) */
    const readSource = (): string | null => {
      const s = useRoute.getState()
      return followProgram ? programShotAt(s.program, s.progress) : shotId ?? null
    }
    const rebuild = () => {
      entities.forEach((e) => v.entities.remove(e))
      entities = []
      const sid = readSource()
      if (!sid) return
      const shot = useRoute.getState().shots.find((sh) => sh.id === sid)
      if (!shot) return
      entities = buildShotRouteEntities(v, shot)
    }

    const applyFramingNow = () => {
      const s = useRoute.getState()
      const sid = followProgram ? programShotAt(s.program, s.progress) : shotId ?? null
      if (!sid) return
      const shot = s.shots.find((sh) => sh.id === sid)
      if (!shot) return
      /* the ONE framing rule: route pose at the playhead → freeCam memory →
         HOME (never Cesium's raw space view) */
      applyFraming(v, frameOf(shot, s.progress))
    }

    rebuild()
    applyFramingNow()
    if (!mutedRef.current) scene.requestRender()
    refreshRef.current = () => {
      rebuild()
      applyFramingNow()
      scene.requestRender()
    }
    /* the exporter takes the Program Out Viewer over frame-by-frame while
       rendering and hands it back via refreshProgramViewer() */
    if (followProgram) setProgramRefresh(() => refreshRef.current())

    let lastApply = 0
    const unsub = useRoute.subscribe((s, prev) => {
      /* muted pane: the store may move on without us — the unmute effect
         re-syncs everything from scratch */
      if (mutedRef.current) return
      if (followProgram) {
        /* the exporter owns this Viewer frame-by-frame while rendering — skip
           the throttled auto-follow so the two never fight over one camera */
        if (useExport.getState().status === 'rendering') return
        /* Program Out: the SOURCE itself can change between ticks — crossing
           a cut re-targets entities AND camera inside this same Viewer */
        const prevSid = programShotAt(prev.program, prev.progress)
        if (programShotAt(s.program, s.progress) !== prevSid) rebuild()
        const now = performance.now()
        if (now - lastApply < FOLLOW_MS[variantRef.current]) return
        lastApply = now
        applyFramingNow()
        scene.requestRender()
        return
      }
      if (s.progress !== prev.progress) {
        const now = performance.now()
        if (now - lastApply < FOLLOW_MS[variantRef.current]) return
        lastApply = now
        applyFramingNow()
        scene.requestRender()
        return
      }
      const shot = s.shots.find((sh) => sh.id === shotId)
      const prevShot = prev.shots.find((sh) => sh.id === shotId)
      if (shot !== prevShot) {
        rebuild()
        lastApply = performance.now()
        applyFramingNow()
        scene.requestRender()
      }
    })

    return () => {
      unsubImagery()
      unsub()
      viewerRef.current = null
      if (followProgram) {
        setProgramViewer(null)
        setProgramRefresh(null)
      }
      if (!v.isDestroyed()) v.destroy()
    }
    /* variant is intentionally NOT a dependency — the dial effect re-dials the
       SAME viewer; only a different SOURCE needs a different Viewer (for a
       Program Out monitor the source key is constant: it follows the edit) */
  }, [sourceKey])

  return <div ref={hostRef} className="ce-pane-view" />
}

/* ------------------------------------------------------------------ */
/* ViewportStage — layout container                                    */
/* ------------------------------------------------------------------ */

/** grid columns for k equal cells: ≤3 = the user's 左中右 single row, larger
 *  k = near-square (square grids keep cells closest to the output AR) */
function gridCols(k: number): number {
  return k <= 3 ? Math.max(1, k) : Math.ceil(Math.sqrt(k))
}

export default function ViewportStage() {
  const shots = useRoute((s) => s.shots)
  const activeId = useRoute((s) => s.activeShotId)
  const minimized = useRoute((s) => s.minimizedShotIds)
  const previewMode = useUI((s) => s.previewMode)
  const setActiveShot = useRoute((s) => s.setActiveShot)
  const toggleMinimizedShot = useRoute((s) => s.toggleMinimizedShot)

  /* grid = un-collapsed shots; rail = collapsed ones. Shot order canonical.
     大/小 never interacts with editing — see the header note. */
  const mainIds = shots.filter((sh) => !minimized.includes(sh.id)).map((sh) => sh.id)
  const railIds = shots.filter((sh) => minimized.includes(sh.id)).map((sh) => sh.id)

  /* the grid is [Program Out] + un-collapsed shots, PLUS an appended editor
     cell when the ACTIVE shot itself is collapsed (a collapse then costs no
     cell). Program Out holds cell #0 — the monitor owns the anchor position
     (行业习惯: 主监视器在左上，机位窗是素材监视器).
     With ≤1 shot there is nothing to cut BETWEEN, so the monitor is omitted
     and a single 机位 still fills the whole area (zero-regression rule). */
  const showProgram = shots.length > 1
  const programCells = showProgram ? 1 : 0
  /* the editor slot is appended ONLY when there IS an edit target and it is
     collapsed to the rail. No active shot → no editor slot at all (the grid
     is pure monitors) — this is what "collapsing clears the edit" means. */
  const activeInMain = activeId != null && mainIds.includes(activeId)
  const k = programCells + mainIds.length + (activeId != null && !activeInMain ? 1 : 0)
  const cols = gridCols(k)
  const rows = Math.ceil(k / cols)
  const areaOf = (i: number) => `${Math.floor(i / cols) + 1} / ${(i % cols) + 1}`
  /** shot slot area — index within mainIds, offset by the Program cell */
  const slotArea = (i: number) => areaOf(programCells + i)
  const activeArea =
    activeId == null
      ? '1 / 1' // unused — the overlay is not rendered
      : activeInMain
        ? slotArea(mainIds.indexOf(activeId))
        : areaOf(programCells + mainIds.length) // the appended editor cell

  const nameOf = (id: string) => shots.find((sh) => sh.id === id)?.name ?? ''
  const hasWaypoints = (id: string) =>
    shots.find((sh) => sh.id === id)?.route.waypoints.some(hasPosition) ?? false

  /* ---- delegated single-click (capture phase) -----------------------------
     Clicking a pane/thumb does exactly ONE thing: switch the edit target.
     It never resizes anything (the hover buttons own 大/小), and the main
     globe's own clicks are left entirely to the map. The hover buttons skip
     this handler — collapsing must not silently re-activate the shot. */
  const stageClick = (e: ReactMouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('.ce-slot-min, .ce-thumb-max')) return
    const id = target.closest<HTMLElement>('[data-shot-id]')?.dataset.shotId
    if (!id || id === activeId) return
    setActiveShot(id)
  }

  return (
    <div className="ce-stage">
      <div
        className="ce-stage-main"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        }}
        onClickCapture={stageClick}
      >
        {/* one PERSISTENT pane per slot — keyed by shot id, so switching the
            active 机位 moves nothing but the overlay: no ShotPane is ever
            destroyed or re-created by activation */}
        {/* Program Out — cell #0, the first thing the eye lands on. No
            data-shot-id: clicking the monitor is not "activating a shot" */}
        {showProgram && (
          <div className="ce-slot ce-slot-program" style={{ gridArea: areaOf(0) }}>
            <ProgramSlot />
          </div>
        )}
        {mainIds.map((id, i) => (
          <div key={id} className="ce-slot" data-shot-id={id} style={{ gridArea: slotArea(i) }}>
            <ShotPane shotId={id} variant="pane" muted={id === activeId} />
            {/* the active slot's OWN chip comes from the overlay below (this
                one would sit underneath it) */}
            {!previewMode && id !== activeId && (
              <span
                className={`ce-pane-chip${hasWaypoints(id) ? '' : ' is-empty'}`}
                title={hasWaypoints(id) ? undefined : '该机位尚无航点 — 点击主视图绘制航线'}
              >
                {nameOf(id)}
              </span>
            )}
            {!previewMode && (
              <CollapseBtn onToggle={() => toggleMinimizedShot(id)} />
            )}
          </div>
        ))}
        {/* main globe overlay — LAST child (paints above every pane), one
            stable DOM node for the whole app lifetime; only gridArea slides.
            It shows the ACTIVE shot whether that shot lives in the grid
            (covering its pane) or in the rail (an appended editor slot).
            No active shot (edit target cleared) → no overlay, pure monitors. */}
        {activeId != null && (
          <div className="ce-slot ce-slot-main" data-shot-id={activeId} style={{ gridArea: activeArea }}>
            <GlobeViewport />
            {!previewMode && (
              <>
                <span
                  className={`ce-pane-chip${hasWaypoints(activeId) ? '' : ' is-empty'}`}
                  title={hasWaypoints(activeId) ? undefined : '该机位尚无航点 — 点击主视图绘制航线'}
                >
                  {nameOf(activeId)}
                </span>
                <CollapseBtn onToggle={() => toggleMinimizedShot(activeId)} />
              </>
            )}
          </div>
        )}
      </div>

      {!previewMode && railIds.length > 0 && (
        <aside className="ce-stage-rail" onClickCapture={stageClick}>
          {railIds.map((id) => (
            <div
              key={id}
              className={`ce-thumb${id === activeId ? ' is-active' : ''}`}
              data-shot-id={id}
              title="单击 = 编辑该机位"
            >
              <ShotPane shotId={id} variant="thumb" />
              <span className={`ce-thumb-name${hasWaypoints(id) ? '' : ' is-empty'}`}>
                {nameOf(id)}
              </span>
              <ExpandBtn onToggle={() => toggleMinimizedShot(id)} />
            </div>
          ))}
        </aside>
      )}
    </div>
  )
}

/** Program Out — the FIRST cell of the main grid: the picture the 主输出 edit
 *  puts on air at the playhead (and the very view the exporter will render).
 *  Its own component so the per-frame playhead subscription re-renders THIS
 *  cell, not the whole stage. */
function ProgramSlot() {
  const program = useRoute((s) => s.program)
  const progress = useRoute((s) => s.progress)
  const shots = useRoute((s) => s.shots)
  const previewMode = useUI((s) => s.previewMode)
  const onAir = programShotAt(program, progress)
  const name = onAir ? shots.find((sh) => sh.id === onAir)?.name ?? '' : ''

  return (
    <>
      {onAir ? (
        /* the source re-targets at every cut inside this same Viewer */
        <ShotPane variant="program" followProgram />
      ) : (
        <div className="ce-program-empty">
          <span>主输出未编排</span>
          <span>把播放头放到某处，点击一个机位</span>
        </div>
      )}
      {!previewMode && (
        <span className="ce-pane-chip is-program" title="成片画面 — 主输出轨当前在播的机位">
          主输出{name ? ` · ${name}` : ''}
        </span>
      )}
    </>
  )
}

/* ---- 大/小 hover affordances — the ONLY way a shot changes size ------------ */

/** collapse a main-grid slot (or the editor slot) down to the rail */
function CollapseBtn({ onToggle }: { onToggle: () => void }) {
  return (
    <button
      type="button"
      className="ce-slot-min"
      title="收起到缩略条"
      aria-label="收起该机位"
      onClick={onToggle}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
        <path d="M5 12h14" />
      </svg>
    </button>
  )
}

/** expand a rail thumb back into the main grid */
function ExpandBtn({ onToggle }: { onToggle: () => void }) {
  return (
    <button
      type="button"
      className="ce-thumb-max"
      title="展开到主视图"
      aria-label="展开该机位"
      onClick={onToggle}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5" />
      </svg>
    </button>
  )
}
