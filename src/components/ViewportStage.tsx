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
// Gestures: single click = activate ONLY, and ONLY on main-grid panes (never
//   resizes anything; the panes are non-interactive monitors, and map gestures
//   on the main globe stay untouched). Rail thumbs are PURE previews — their
//   single exit is the ⤢ expand button; activating from the rail would fire
//   where the feedback isn't (the appended editor slot lands elsewhere in the
//   grid), so the rail mounts NO click handler at all. 大/小 switching is
//   EXCLUSIVELY the hover buttons (⤡ collapse on slots / ⤢ expand on thumbs)
//   — no double-click anywhere.
// The interactive main globe NEVER remounts: it stays the LAST grid child
// (an overlay ON TOP of the active/editor slot) and only its gridArea style
// moves — Cesium camera, Ion bootstrap and gesture handlers survive every
// layout change, and so does every pane: each slot owns a PERSISTENT
// ShotPane (key = shot.id), muted while the overlay covers it.

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
  Entity,
  ScreenSpaceEventType,
  Viewer,
} from 'cesium'
import { setProgramRefresh, setProgramViewer } from '../cesium/viewerRegistry'
import { bindImagery } from '../cesium/imagerySource'
import { useUI } from '../store/ui'
import { useExport } from '../features/export/exportStore'
import { applyFraming, frameOf, pinOutputExtent, stageFramingOf, type OutputExtentPin } from '../features/route/framing'
import { programShotAt, useRoute } from '../features/route/routeStore'
import { hasPosition } from '../features/route/types'
import { buildShotRouteEntities } from '../features/route/routeEntities'
import { bindTerrain } from '../cesium/terrainSource'
import { registerAssetViewer, unregisterAssetViewer } from '../features/assets/assetScene'
import { applyViewportQuality } from '../cesium/viewportQuality'
import { useT } from '../i18n'
import GlobeViewport from './GlobeViewport'

/* ------------------------------------------------------------------ */
/* ShotPane — one lightweight per-机位 Cesium view (imperative island) */
/* ------------------------------------------------------------------ */

type PaneVariant = 'pane' | 'thumb' | 'program'

/** follow-throttle budgets (ms): a pane/thumb never needs 60fps — capping the
 *  per-frame setView+requestRender work is what makes 8+ live views viable */
const FOLLOW_MS: Record<PaneVariant, number> = { pane: 50, thumb: 100, program: 50 }


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
  /** GES extent pin — owned by the mount effect, nudged by the variant effect */
  const pinRef = useRef<OutputExtentPin | null>(null)
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
    applyViewportQuality(v, variant)
    /* pane ↔ thumb flips the pin ON/OFF (ratio() checks the variant) */
    pinRef.current?.refresh()
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
        /* ALWAYS born bare (the ink sphere) — bindImagery applies whatever
           the shared source holds, resolved or not, as a crossfade. A base
           layer here would race the source's resolution timing (StrictMode
           double mount made it real) and skip the ink-sphere opening. */
        baseLayer: false,
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

    /* ---- quality dial: monitors match the editor, rail thumbs pay less ---- */
    const v = viewer
    const scene = v.scene
    viewerRef.current = v
    /* the exporter renders THIS Viewer — register the Program Out monitor so
       the export can resolve it without touching the React tree */
    if (followProgram) setProgramViewer(v)
    /* every pane watches the ASSET layer too (growth line above all) — the
       monitor picture must match the editor's, and the exporter renders the
       Program Out pane: without this the recorded video had no assets */
    registerAssetViewer(v)
    applyViewportQuality(v, variantRef.current)
    /* GES extent pin (framing.ts): a monitor pane keeps its OUTPUT-frame
       ground extent invariant while the layout reshapes its canvas (timeline
       expand/collapse, drawers, window resize). Monitor panes only — Program
       Out letterboxes by design and rail thumbs are letterboxes too. */
    const pin = pinOutputExtent(v, () => {
      if (variantRef.current !== 'pane') return null
      const ui = useUI.getState()
      if (ui.layoutMode !== 'push' || ui.previewMode) return null
      if (useExport.getState().status === 'rendering') return null
      return ui.outW / ui.outH
    })
    pinRef.current = pin
    const unsubPinUi = useUI.subscribe((s, prev) => {
      if (
        s.outW !== prev.outW ||
        s.outH !== prev.outH ||
        s.layoutMode !== prev.layoutMode ||
        s.previewMode !== prev.previewMode
      ) {
        pin.refresh()
      }
    })
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
    const unsubTerrain = bindTerrain(v)

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

    /** the playhead is PARKED when neither playback nor scrubbing drives it —
     *  a parked monitor shows the shot's saved edit view, not the route pose */
    const isParked = () => {
      const ui = useUI.getState()
      return !ui.playing && !ui.scrubbing
    }

    const applyFramingNow = (parked: boolean) => {
      const s = useRoute.getState()
      const sid = followProgram ? programShotAt(s.program, s.progress) : shotId ?? null
      if (!sid) return
      const shot = s.shots.find((sh) => sh.id === sid)
      if (!shot) return
      /* the editor window and a monitor must AGREE on how a shot looks:
         parked → the shot's saved edit view (freeCam), the very framing the
         editor restores when it takes the slot over; playing/scrubbing → the
         route pose at the playhead. 主输出 always follows the route — it IS
         the finished frame. HOME is the floor either way (never Cesium's raw
         space view). */
      const f = followProgram
        ? frameOf(shot, s.progress)
        : stageFramingOf(shot, s.progress, parked)
      applyFraming(v, f)
    }

    rebuild()
    applyFramingNow(isParked())
    if (!mutedRef.current) scene.requestRender()
    refreshRef.current = () => {
      rebuild()
      applyFramingNow(isParked())
      scene.requestRender()
    }
    /* the exporter takes the Program Out Viewer over frame-by-frame while
       rendering and hands it back via refreshProgramViewer() */
    if (followProgram) setProgramRefresh(() => refreshRef.current())

    let lastApply = 0
    /** pending trailing apply. The throttle must never DROP the last move: a
     *  scrub/playback that stops inside the budget window used to leave this
     *  camera on a stale frame — which is exactly how 主输出 and a 机位 pane
     *  end up showing DIFFERENT moments of the same shot at the same playhead
     *  (their lastApply clocks are independent). */
    let trailing: number | null = null
    const applyNow = (parked: boolean) => {
      if (trailing != null) {
        clearTimeout(trailing)
        trailing = null
      }
      lastApply = performance.now()
      applyFramingNow(parked)
      scene.requestRender()
    }
    /** throttled apply with a trailing catch-up; force skips the budget.
     *  `parked` rides through: a playhead-driven apply FOLLOWS the route,
     *  an init/source-swap apply shows the shot's saved edit view */
    const applyThrottled = (force = false, parked = isParked()) => {
      const now = performance.now()
      const budget = FOLLOW_MS[variantRef.current]
      if (!force && now - lastApply < budget) {
        if (trailing == null) {
          trailing = window.setTimeout(() => {
            trailing = null
            applyNow(parked)
          }, budget - (now - lastApply))
        }
        return
      }
      applyNow(parked)
    }

    const unsub = useRoute.subscribe((s, prev) => {
      /* muted pane: the store may move on without us — the unmute effect
         re-syncs everything from scratch */
      if (mutedRef.current) return
      if (followProgram) {
        /* the exporter owns this Viewer frame-by-frame while rendering — skip
           the throttled auto-follow so the two never fight over one camera */
        if (useExport.getState().status === 'rendering') return
        /* Program Out: the SOURCE itself can change between ticks — crossing a
           cut re-targets entities AND camera inside this same Viewer. Both must
           move TOGETHER (never the new source through the old camera), so a cut
           BYPASSES the throttle. */
        if (programShotAt(s.program, s.progress) !== programShotAt(prev.program, prev.progress)) {
          rebuild()
          applyThrottled(true)
          return
        }
        /* any other change (playhead tick, a route edit…) re-frames too */
        applyThrottled()
        return
      }
      if (s.progress !== prev.progress) {
        /* the playhead drives the picture (tick, scrub or seek) — follow it */
        applyThrottled(false, false)
        return
      }
      const shot = s.shots.find((sh) => sh.id === shotId)
      const prevShot = prev.shots.find((sh) => sh.id === shotId)
      if (shot !== prevShot) {
        rebuild()
        applyThrottled(true)
      }
    })

    return () => {
      unsubImagery()
      unsubTerrain()
      pin.off()
      pinRef.current = null
      unsubPinUi()
      unsub()
      if (trailing != null) clearTimeout(trailing)
      viewerRef.current = null
      if (followProgram) {
        setProgramViewer(null)
        setProgramRefresh(null)
      }
      /* hand the shared assets back BEFORE destroy() — destroying this
         Viewer would otherwise destroy the data sources every other view
         still shows */
      unregisterAssetViewer(v)
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
  const t = useT()
  const shots = useRoute((s) => s.shots)
  const activeId = useRoute((s) => s.activeShotId)
  const minimized = useRoute((s) => s.minimizedShotIds)
  const previewMode = useUI((s) => s.previewMode)
  const layoutMode = useUI((s) => s.layoutMode)
  const drawerOpen = useUI((s) => s.drawerOpen)
  const rightDrawerOpen = useUI((s) => s.rightDrawerOpen)
  const rendering = useExport((s) => s.status === 'rendering')
  const outW = useUI((s) => s.outW)
  const outH = useUI((s) => s.outH)
  const setActiveShot = useRoute((s) => s.setActiveShot)
  const toggleMinimizedShot = useRoute((s) => s.toggleMinimizedShot)
  const stageOrder = useRoute((s) => s.stageOrder)
  const setStageOrder = useRoute((s) => s.setStageOrder)

  /* grid = un-collapsed shots; rail = collapsed ones. BASE is the canonical
     shot order; stageOrder (the drag handles) overrides the RELATIVE order of
     the shots it lists — unlisted shots keep their canonical position after
     the ranked ones. View layout and timeline headers stay decoupled.
     大/小 never interacts with editing — see the header note. */
  const rank = new Map(stageOrder.map((id, i) => [id, i]))
  const stageSorted = [...shots].sort(
    (a, b) => (rank.get(a.id) ?? shots.length) - (rank.get(b.id) ?? shots.length),
  ).map((sh) => sh.id)
  const mainIds = stageSorted.filter((id) => !minimized.includes(id))
  const railIds = stageSorted.filter((id) => minimized.includes(id))

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
     Clicking a main-grid pane does exactly ONE thing: switch the edit target.
     It never resizes anything (the hover buttons own 大/小), and the main
     globe's own clicks are left entirely to the map. The hover buttons skip
     this handler — collapsing must not silently re-activate the shot. (Rail
     thumbs deliberately mount none of this: their one exit is ⤢ expand.) */
  const stageClick = (e: ReactMouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('.ce-slot-min, .ce-drag-handle')) return
    const id = target.closest<HTMLElement>('[data-shot-id]')?.dataset.shotId
    if (!id || id === activeId) return
    setActiveShot(id)
  }

  /* ---- stage drag-reorder (pointer capture) -------------------------------
     One handle per slot/thumb, LEFT of the ⤡/⤢ buttons. Grab → 4px arming
     threshold → RELEASE-time SWAP, identical in BOTH zones: the grabbed view
     lifts as a GHOST glued to the pointer (inline transform, direct DOM — no
     per-frame React churn), its vacated cell wears a dashed placeholder, and
     the cell under the pointer wears an accent ring. On release the ghost
     and the ringed cell TRADE PLACES — nothing else moves; dropping on the
     vacated cell is a no-op. Strictly within one zone (grid↔grid, rail↔rail
     — crossing zones is exactly what ⤡/⤢ own). Program Out and the appended
     editor slot never participate. Cells never change geometry mid-drag
     (equipartitioned grid, fixed-height rail rows), so the rects snapshotted
     at arm time stay valid for the whole drag. */
  const [stageDrag, setStageDrag] = useState<{ id: string; zone: 'main' | 'rail' } | null>(null)
  /* dashed vacancy rect — the ghost's vacated cell, i.e. where the swap
     partner will land. Set once at arm, cleared on release. */
  const [ghostPh, setGhostPh] = useState<{
    top: number
    left: number
    width: number
    height: number
  } | null>(null)
  const stageMainRef = useRef<HTMLDivElement>(null)
  const railRef = useRef<HTMLElement>(null)
  const dragRef = useRef<{
    x0: number
    y0: number
    zone: 'main' | 'rail'
    id: string
    rects: DOMRect[]
    els?: HTMLElement[]
    el?: HTMLElement | null
    hit?: number
  } | null>(null)

  /* interleave a zone's final sequence back into the full stage order */
  const writeZoneOrder = (newZone: string[]) => {
    const zoneSet = new Set(newZone)
    let k = 0
    setStageOrder(stageSorted.map((x) => (zoneSet.has(x) ? newZone[k++]! : x)))
  }

  const handleDown = (e: ReactPointerEvent, zone: 'main' | 'rail', id: string) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { x0: e.clientX, y0: e.clientY, zone, id, rects: [] }
  }
  const handleMove = (e: ReactPointerEvent) => {
    const d = dragRef.current
    if (!d) return
    if (!d.rects.length) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return
      const root = d.zone === 'main' ? stageMainRef.current : railRef.current
      if (!root) return
      const els = Array.from(
        root.querySelectorAll<HTMLElement>(
          d.zone === 'main' ? '.ce-slot[data-shot-id]:not(.ce-slot-main)' : '.ce-thumb',
        ),
      )
      d.rects = els.map((el) => el.getBoundingClientRect())
      if (!d.rects.length) return
      /* ghost + vacancy + ring — shared by BOTH zones. DOM order == map
         order, so els[i] ↔ ids[i]. Special case: when the ACTIVE shot's
         EDITOR overlay is grabbed, the overlay is the visible body — ghost
         IT (the pane it covers never moves and stays invisible below). */
      d.els = els
      const ids = d.zone === 'main' ? mainIds : railIds
      const from = ids.indexOf(d.id)
      d.el =
        (d.zone === 'main' &&
          root.querySelector<HTMLElement>(`.ce-slot-main[data-shot-id="${d.id}"]`)) ||
        els[from] ||
        null
      /* dashed vacancy in the ghost's old cell — the OTHER half of the swap
         promise (ring = where the ghost goes, this = where the partner
         lands). Rects are viewport coords; the rail may be scrolled, so
         convert to the zone root's content origin. */
      const r = d.rects[from]
      if (r) {
        setGhostPh({
          top: r.top - root.getBoundingClientRect().top + root.scrollTop,
          left: r.left - root.getBoundingClientRect().left + root.scrollLeft,
          width: r.width,
          height: r.height,
        })
      }
      setStageDrag({ id: d.id, zone: d.zone })
    }
    if (d.el) {
      /* pure translation — NO scale: an oversized ghost overlaps neighbouring
         cells and muddles the read ("the vacancy has a map in it"). Lift is
         expressed by shadow + accent ring alone. */
      d.el.style.transform = `translate(${e.clientX - d.x0}px, ${e.clientY - d.y0}px)`
    }
    const hit = d.rects.findIndex(
      (r) =>
        e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom,
    )
    /* drop-target ring follows the pointer frame by frame; ids[hit] !== id
       covers both the overlay case (its cell's pane is in els, the overlay
       is not) and the plain "hovering your own cell" case */
    if (d.els) {
      const ids = d.zone === 'main' ? mainIds : railIds
      for (const n of d.els) n.classList.remove('is-drop-hit')
      if (hit !== -1 && d.els[hit] && ids[hit] !== d.id) d.els[hit].classList.add('is-drop-hit')
    }
    /* NO live reorder — the ring is the promise; the swap lands on release */
    if (hit !== -1) d.hit = hit
  }
  const handleUp = () => {
    const d = dragRef.current
    if (d?.el) d.el.style.transform = ''
    d?.els?.forEach((n) => n.classList.remove('is-drop-hit'))
    /* release = SWAP (both zones): the ghost trades cells with the ringed
       cell and NOTHING else moves; dropping on the vacated cell is a no-op */
    if (d && d.hit !== undefined) {
      const ids = d.zone === 'main' ? mainIds : railIds
      const from = ids.indexOf(d.id)
      const hit = d.hit
      if (from !== -1 && hit >= 0 && hit < ids.length && hit !== from) {
        const newZone = [...ids]
        ;[newZone[from], newZone[hit]] = [newZone[hit], newZone[from]]
        writeZoneOrder(newZone)
      }
    }
    dragRef.current = null
    setStageDrag(null)
    setGhostPh(null)
  }

  /* push layout: the chrome takes its space OUT of the stage. Preview mode
     hides all chrome, so it always stays full-bleed (the window IS the
     picture there). The per-monitor output framing is pure CSS — see
     .ce-frame in ui.css. */
  const push = layoutMode === 'push' && !previewMode

  /* GES scope framing — shared by the EDITOR overlay and every monitor pane:
     in push (and not exporting) those canvases stay FULL-BLEED with a darkened
     surround outside the output frame (.ce-frame-mask in ui.css), so the whole
     grid reads as ONE family — only 主输出 keeps letterbox, the honest,
     uncluttered picture of the finished frame. While rendering everything
     letterboxes like a monitor, so any recorded canvas is exactly the
     picture. */
  const gesScope = push && !rendering

  return (
    <div
      className="ce-stage"
      data-layout={push ? 'push' : 'overlay'}
      style={
        push
          ? ({
              '--ce-push-l': drawerOpen ? 'var(--ce-drawer-w)' : '0px',
              '--ce-push-r': rightDrawerOpen ? 'var(--ce-drawer-w)' : '0px',
              '--ce-push-b': 'var(--ce-tl-h)',
              /* the live output frame ratio — the 尺寸 setting drives this
                 (tokens.css keeps only a first-paint fallback). Same source
                 as the recorder's encode size, so screen and file agree */
              '--ce-out-w': String(outW),
              '--ce-out-h': String(outH),
            } as CSSProperties)
          : undefined
      }
    >
      <div
        className="ce-stage-main"
        ref={stageMainRef}
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
            <div className="ce-frame">
              <ProgramSlot />
            </div>
          </div>
        )}
        {/* dashed vacancy while a slot from THIS grid is the drag ghost */}
        {ghostPh && stageDrag?.zone === 'main' && <div className="ce-drag-ph" style={ghostPh} aria-hidden="true" />}
        {mainIds.map((id, i) => (
          <div
            key={id}
            className={`ce-slot${id === activeId ? ' is-covered' : stageDrag?.zone === 'main' && stageDrag.id === id ? ' is-ghost' : ''}`}
            data-shot-id={id}
            style={{ gridArea: slotArea(i) }}
          >
            {/* monitors share the editor's GES framing: the whole grid reads
                as one family; only 主输出 keeps letterbox (the honest,
                uncluttered picture of the finished frame) */}
            <div className={`ce-frame${gesScope ? ' is-scope' : ''}`}>
              <ShotPane shotId={id} variant="pane" muted={id === activeId} />
              {gesScope && <span className="ce-frame-mask" aria-hidden="true" />}
            </div>
            {/* the active slot's OWN chip comes from the overlay below (this
                one would sit underneath it) */}
            {!previewMode && id !== activeId && (
              <span
                className={`ce-pane-chip${hasWaypoints(id) ? '' : ' is-empty'}`}
                title={hasWaypoints(id) ? t('stage.editThis') : t('stage.noWaypoints')}
              >
                {nameOf(id)}
              </span>
            )}
            {!previewMode && (
              <>
                <StageDragHandle
                  title={t('stage.dragHandle')}
                  onPointerDown={(e) => handleDown(e, 'main', id)}
                  onPointerMove={handleMove}
                  onPointerUp={handleUp}
                  onPointerCancel={handleUp}
                />
                <CollapseBtn onToggle={() => toggleMinimizedShot(id)} />
              </>
            )}
          </div>
        ))}
        {/* main globe overlay — LAST child (paints above every pane), one
            stable DOM node for the whole app lifetime; only gridArea slides.
            It shows the ACTIVE shot whether that shot lives in the grid
            (covering its pane) or in the rail (an appended editor slot).
            No active shot (edit target cleared) → no overlay, pure monitors. */}
        {activeId != null && (
          <div
            className={`ce-slot ce-slot-main${stageDrag?.zone === 'main' && stageDrag.id === activeId ? ' is-ghost' : ''}`}
            data-shot-id={activeId}
            style={{ gridArea: activeArea }}
          >
            <div className={`ce-frame${gesScope ? ' is-scope' : ''}`}>
              <GlobeViewport />
              {gesScope && <span className="ce-frame-mask" aria-hidden="true" />}
            </div>
            {!previewMode && (
              <>
                <span
                  className={`ce-pane-chip is-active${hasWaypoints(activeId) ? '' : ' is-empty'}`}
                  title={hasWaypoints(activeId) ? t('stage.editActive') : t('stage.editActiveEmpty')}
                >
                  {nameOf(activeId)}
                </span>
                {/* the overlay is glued to the ACTIVE shot's pane, so while
                    that shot lives in the grid its handle lives HERE (the
                    overlay covers the pane's own). Dragging it reorders the
                    underlying pane — same zone, same id, zero new logic.
                    The appended editor slot (active shot collapsed to the
                    rail) stays handle-less: it is not a grid member; reorder
                    it on the rail instead. */}
                {activeInMain && (
                  <StageDragHandle
                    title={t('stage.dragHandle')}
                    onPointerDown={(e) => handleDown(e, 'main', activeId)}
                    onPointerMove={handleMove}
                    onPointerUp={handleUp}
                    onPointerCancel={handleUp}
                  />
                )}
                <CollapseBtn onToggle={() => toggleMinimizedShot(activeId)} />
              </>
            )}
          </div>
        )}
      </div>

      {!previewMode && railIds.length > 0 && (
        <aside className="ce-stage-rail" ref={railRef}>
          {ghostPh && stageDrag?.zone === 'rail' && <div className="ce-drag-ph" style={ghostPh} aria-hidden="true" />}
          {railIds.map((id) => (
            <div
              key={id}
              className={`ce-thumb${id === activeId ? ' is-active' : ''}${stageDrag?.zone === 'rail' && stageDrag.id === id ? ' is-ghost' : ''}`}
              title={id === activeId ? t('stage.thumbHintActive') : t('stage.thumbHint')}
            >
              <ShotPane shotId={id} variant="thumb" />
              <span
                className={`ce-thumb-name${hasWaypoints(id) ? '' : ' is-empty'}`}
                title={hasWaypoints(id) ? undefined : t('stage.noWaypoints')}
              >
                {nameOf(id)}
              </span>
              <StageDragHandle
                title={t('stage.dragHandle')}
                onPointerDown={(e) => handleDown(e, 'rail', id)}
                onPointerMove={handleMove}
                onPointerUp={handleUp}
                onPointerCancel={handleUp}
              />
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
  const t = useT()
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
          <span>{t('stage.programEmpty')}</span>
          <span>{t('stage.programEmptyHint')}</span>
        </div>
      )}
      {!previewMode && (
        <span className="ce-pane-chip is-program" title={t('stage.programChip')}>
          {t('stage.program')}{name ? ` · ${name}` : ''}
        </span>
      )}
    </>
  )
}

/* ---- drag-reorder handle — sits LEFT of the ⤡/⤢ buttons. Pointer-capture
   drag reorders within its zone (grid or rail, never across); a plain click
   does nothing (the container's delegated activation skips it as well). */
function StageDragHandle(props: {
  title: string
  onPointerDown: (e: ReactPointerEvent) => void
  onPointerMove: (e: ReactPointerEvent) => void
  onPointerUp: (e: ReactPointerEvent) => void
  onPointerCancel: (e: ReactPointerEvent) => void
}) {
  return (
    <button
      type="button"
      className="ce-drag-handle"
      title={props.title}
      aria-label={props.title}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerCancel}
      onClick={(e) => e.stopPropagation()}
    >
      <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor" aria-hidden="true">
        <circle cx="2.5" cy="2" r="1.3" />
        <circle cx="7.5" cy="2" r="1.3" />
        <circle cx="2.5" cy="6" r="1.3" />
        <circle cx="7.5" cy="6" r="1.3" />
        <circle cx="2.5" cy="10" r="1.3" />
        <circle cx="7.5" cy="10" r="1.3" />
      </svg>
    </button>
  )
}

/* ---- 大/小 hover affordances — the ONLY way a shot changes size ------------ */

/** collapse a main-grid slot (or the editor slot) down to the rail */
function CollapseBtn({ onToggle }: { onToggle: () => void }) {
  const t = useT()
  return (
    <button
      type="button"
      className="ce-slot-min"
      title={t('stage.collapse')}
      aria-label={t('stage.collapseAria')}
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
  const t = useT()
  return (
    <button
      type="button"
      className="ce-thumb-max"
      title={t('stage.expand')}
      aria-label={t('stage.expandAria')}
      onClick={onToggle}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5" />
      </svg>
    </button>
  )
}
