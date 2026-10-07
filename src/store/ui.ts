import { create } from 'zustand'

/** expanded-timeline height (px) — default mirrors --ce-tl-expanded in tokens */
export const TL_H_DEFAULT = 232
const TL_H_MIN = 140
/* full-height allowed: the grip sits on the panel's own top edge, so it stays
   grabbable even when the timeline covers the whole viewport */
const clampTlHeight = (h: number) =>
  Math.round(Math.min(Math.max(h, TL_H_MIN), window.innerHeight))

export type DrawerTab = 'layers' | 'shots' | 'properties' | 'assets'

interface UIState {
  /** left overlay drawer */
  drawerOpen: boolean
  drawerTab: DrawerTab
  /** right overlay drawer (route editor) */
  rightDrawerOpen: boolean
  /** bottom timeline: thin bar (false) / multi-track editor (true) */
  timelineExpanded: boolean
  /** user-resized height of the expanded timeline (px) — clamped on write */
  tlHeight: number
  /** crosshair pick mode — the next globe tap sets the camera target */
  targetPickMode: boolean
  /** fullscreen preview — hides all chrome */
  previewMode: boolean
  playing: boolean
  /** user is dragging the timeline playhead — freezes the playback clock */
  scrubbing: boolean
  /** freeze the camera at its current view — the playhead keeps driving growth */
  cameraLocked: boolean
  /** sun & time-of-day panel (globe lighting follows the Cesium clock) */
  sunOpen: boolean
  /** expanded-timeline viewport window in SECONDS (view-only state).
   *  span = Infinity means "fit all" (the default); the component clamps
   *  start/span against the current route duration on read. */
  tlView: { start: number; span: number }
  /** timeline DISPLAY unit for the ruler & length field (view-only state).
   *  'frame' converts through the route fps — a pure label transform, all
   *  underlying times stay in seconds. */
  tlUnit: 'sec' | 'frame'

  toggleDrawer: (open?: boolean) => void
  setDrawerTab: (tab: DrawerTab) => void
  toggleRightDrawer: (open?: boolean) => void
  toggleTimeline: (expanded?: boolean) => void
  setTlHeight: (h: number) => void
  setTargetPickMode: (on: boolean) => void
  setPreviewMode: (on: boolean) => void
  setPlaying: (p: boolean) => void
  setScrubbing: (s: boolean) => void
  setCameraLocked: (on: boolean) => void
  toggleSunPanel: (open?: boolean) => void
  setTlView: (v: { start: number; span: number }) => void
  resetTlView: () => void
  setTlUnit: (u: 'sec' | 'frame') => void
}

export const useUI = create<UIState>((set) => ({
  drawerOpen: false,
  drawerTab: 'layers',
  rightDrawerOpen: false,
  timelineExpanded: false,
  tlHeight: TL_H_DEFAULT,
  targetPickMode: false,
  previewMode: false,
  playing: false,
  scrubbing: false,
  cameraLocked: false,
  sunOpen: false,
  tlView: { start: 0, span: Infinity },
  tlUnit: 'sec',

  toggleDrawer: (open) => set((s) => ({ drawerOpen: open ?? !s.drawerOpen })),
  setDrawerTab: (tab) => set({ drawerTab: tab, drawerOpen: true }),
  toggleRightDrawer: (open) =>
    set((s) => ({ rightDrawerOpen: open ?? !s.rightDrawerOpen })),
  toggleTimeline: (expanded) =>
    set((s) => ({ timelineExpanded: expanded ?? !s.timelineExpanded })),
  setTlHeight: (h) => set({ tlHeight: clampTlHeight(h) }),
  setTargetPickMode: (on) => set({ targetPickMode: on }),
  setPreviewMode: (on) => set({ previewMode: on }),
  setPlaying: (p) => set({ playing: p }),
  setScrubbing: (s) => set({ scrubbing: s }),
  setCameraLocked: (on) => set({ cameraLocked: on }),
  toggleSunPanel: (open) => set((s) => ({ sunOpen: open ?? !s.sunOpen })),
  setTlView: (v) => set({ tlView: v }),
  resetTlView: () => set({ tlView: { start: 0, span: Infinity } }),
  setTlUnit: (u) => set({ tlUnit: u }),
}))
