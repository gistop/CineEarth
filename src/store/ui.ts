import { create } from 'zustand'

export type DrawerTab = 'layers' | 'shots' | 'properties' | 'assets'

interface UIState {
  /** left overlay drawer */
  drawerOpen: boolean
  drawerTab: DrawerTab
  /** right overlay drawer (route editor) */
  rightDrawerOpen: boolean
  /** bottom timeline: thin bar (false) / multi-track editor (true) */
  timelineExpanded: boolean
  /** crosshair pick mode — the next globe tap sets the camera target */
  targetPickMode: boolean
  /** fullscreen preview — hides all chrome */
  previewMode: boolean
  playing: boolean
  /** user is dragging the timeline playhead — freezes the playback clock */
  scrubbing: boolean

  toggleDrawer: (open?: boolean) => void
  setDrawerTab: (tab: DrawerTab) => void
  toggleRightDrawer: (open?: boolean) => void
  toggleTimeline: (expanded?: boolean) => void
  setTargetPickMode: (on: boolean) => void
  setPreviewMode: (on: boolean) => void
  setPlaying: (p: boolean) => void
  setScrubbing: (s: boolean) => void
}

export const useUI = create<UIState>((set) => ({
  drawerOpen: false,
  drawerTab: 'layers',
  rightDrawerOpen: false,
  timelineExpanded: false,
  targetPickMode: false,
  previewMode: false,
  playing: false,
  scrubbing: false,

  toggleDrawer: (open) => set((s) => ({ drawerOpen: open ?? !s.drawerOpen })),
  setDrawerTab: (tab) => set({ drawerTab: tab, drawerOpen: true }),
  toggleRightDrawer: (open) =>
    set((s) => ({ rightDrawerOpen: open ?? !s.rightDrawerOpen })),
  toggleTimeline: (expanded) =>
    set((s) => ({ timelineExpanded: expanded ?? !s.timelineExpanded })),
  setTargetPickMode: (on) => set({ targetPickMode: on }),
  setPreviewMode: (on) => set({ previewMode: on }),
  setPlaying: (p) => set({ playing: p }),
  setScrubbing: (s) => set({ scrubbing: s }),
}))
