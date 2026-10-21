// Draw-mode state — bridges the timeline split button / hint pill (React)
// to the imperative Cesium drawing engine. Only one drawing can be active.

import { create } from 'zustand'
import { startLineDraw, type DrawHandle } from './lineDraw'
import { createLineAsset } from './assetScene'

interface DrawState {
  drawing: boolean
  pointCount: number
  startLine: () => void
  finishLine: () => void
  cancelLine: () => void
}

let handle: DrawHandle | null = null

export const useDraw = create<DrawState>((set) => ({
  drawing: false,
  pointCount: 0,

  startLine: () => {
    if (handle) return
    handle = startLineDraw({
      onPoints: (count) => set({ pointCount: count }),
      onEnd: (positions) => {
        handle = null
        set({ drawing: false, pointCount: 0 })
        if (positions && positions.length >= 2) return createLineAsset(positions)
      },
    })
    if (handle) set({ drawing: true, pointCount: 0 })
  },

  finishLine: () => handle?.finish(),
  cancelLine: () => handle?.cancel(),
}))
