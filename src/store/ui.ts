import { create } from 'zustand'
import { loadTheme, type ThemeId } from '../features/settings/theme'

/** expanded-timeline height (px) — default mirrors --ce-tl-expanded in tokens */
export const TL_H_DEFAULT = 232
const TL_H_MIN = 140
/* full-height allowed: the grip sits on the panel's own top edge, so it stays
 *  grabbable even when the timeline covers the whole viewport */
const clampTlHeight = (h: number) =>
  Math.round(Math.min(Math.max(h, TL_H_MIN), window.innerHeight))

/** even, clamped pixel size — H.264 needs even dimensions anyway */
const clampOut = (n: number) => 2 * Math.round(Math.min(Math.max(n, 16), 7680) / 2)

export type DrawerTab = 'layers' | 'shots' | 'properties' | 'assets'

/** how the chrome relates to the stage — see UIState.layoutMode */
export type LayoutMode = 'overlay' | 'push'

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

  /** keyframe value tags at each key's bottom-right — per channel, default off */
  tlKeyValues: Record<string, boolean>

  /** waveform-style value bars in track lanes (Props toggle, default on) —
   *  bar height = channel value at that moment; pure display, sampling and
   *  interaction are untouched */
  laneBars: boolean

  /** layout mode (Props switch, default 'push'). 'overlay' = the chrome
   *  floats above a full-bleed canvas (the window IS the picture); 'push' =
   *  the chrome takes its space OUT of the stage and every monitor keeps the
   *  OUTPUT aspect — letterbox bars on monitors, GES-style darkened surround
   *  on the editor (挤压窗口，不挤压画幅). */
  layoutMode: LayoutMode

  /** output picture size (px) — ONE source of truth for BOTH the on-screen
   *  frame ratio (fed onto .ce-stage as --ce-out-w/h: monitor letterbox +
   *  editor GES mask) and the encoded video size (recorder outputSize).
   *  Defaults mirror the GES 1080p preset; the project 设置 column edits it. */
  outW: number
  outH: number

  /** 切镜联动 (the 🔗 toggle on the 主输出 track header). true (default) =
   *  activating a shot also cuts the program at the playhead (导播式：切换
   *  即剪辑); false = activation is PURE edit-target switching — the program
   *  timeline is left untouched (browse/edit without polluting the cut).
   *  routeStore.setActiveShot is the single reader, so every activation
   *  entry (track row, monitor pane, rail thumb) obeys it at once. */
  cutLink: boolean

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
  toggleTlKeyValues: (id: string) => void
  setLaneBars: (on: boolean) => void
  setLayoutMode: (m: LayoutMode) => void
  setOutSize: (w: number, h: number) => void
  toggleCutLink: (on?: boolean) => void

  /** interface theme (Props tab) — style-only, applied via [data-theme] */
  theme: ThemeId
  setTheme: (t: ThemeId) => void
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
  tlKeyValues: {},
  laneBars: true,
  layoutMode: 'push',
  outW: 1920,
  outH: 1080,
  cutLink: true,

  theme: loadTheme(),
  setTheme: (t) => set({ theme: t }),

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
  toggleTlKeyValues: (id) =>
    set((s) => ({ tlKeyValues: { ...s.tlKeyValues, [id]: !s.tlKeyValues[id] } })),
  setLaneBars: (on) => set({ laneBars: on }),
  setLayoutMode: (m) => set({ layoutMode: m }),
  setOutSize: (w, h) => set({ outW: clampOut(w), outH: clampOut(h) }),
  toggleCutLink: (on) => set((s) => ({ cutLink: on ?? !s.cutLink })),
}))
