// Growth-line keyframe track — AE-style "方式 C" for path reveal.
// Pure data + pure evaluation: any instant maps to a deterministic reveal%,
// so scrubbing / paused edits / offline export all share one truth.
// The scene bridge subscribes; nothing here touches Cesium.

import { create } from 'zustand'

export type RevealKey = {
  id: string
  /** playhead position, 0..1 */
  t: number
  /** percent of route length visible at this key, 0..100 */
  value: number
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const clampPct = (v: number) => Math.min(100, Math.max(0, v))

let seq = 0
const nextKeyId = () => `rv-${Date.now().toString(36)}-${(seq += 1)}`

export const DEFAULT_REVEAL_KEYS: RevealKey[] = [
  { id: 'rv-start', t: 0, value: 0 },
  { id: 'rv-end', t: 1, value: 100 },
]

interface RevealState {
  /** thick growth line enabled on the globe */
  growthLine: boolean
  /** keyframe track for the reveal percentage */
  keys: RevealKey[]
  selectedKeyId: string | null

  setGrowthLine: (on: boolean) => void
  /** add a key at t — value = current curve value (AE behaviour: no shape change) */
  addKey: (t: number) => void
  moveKey: (id: string, t: number, value: number) => void
  removeKey: (id: string) => void
  selectKey: (id: string | null) => void
  resetKeys: () => void
}

export const useReveal = create<RevealState>((set) => ({
  growthLine: false,
  keys: DEFAULT_REVEAL_KEYS,
  selectedKeyId: null,

  setGrowthLine: (growthLine) => set({ growthLine }),
  addKey: (t) =>
    set((s) => ({
      keys: [...s.keys, { id: nextKeyId(), t: clamp01(t), value: evalReveal(s.keys, t) }],
    })),
  moveKey: (id, t, value) =>
    set((s) => ({
      keys: s.keys.map((k) =>
        k.id === id ? { ...k, t: clamp01(t), value: clampPct(value) } : k,
      ),
    })),
  removeKey: (id) =>
    set((s) => ({
      keys: s.keys.filter((k) => k.id !== id),
      selectedKeyId: s.selectedKeyId === id ? null : s.selectedKeyId,
    })),
  selectKey: (selectedKeyId) => set({ selectedKeyId }),
  resetKeys: () => set({ keys: DEFAULT_REVEAL_KEYS, selectedKeyId: null }),
}))

/** AE-style evaluation: sort by time, linear interpolation between keys, clamped ends. */
export function evalReveal(keys: RevealKey[], t: number): number {
  if (keys.length === 0) return 100
  const sorted = [...keys].sort((a, b) => a.t - b.t)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (t <= first.t) return first.value
  if (t >= last.t) return last.value
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t
      const local = span > 0 ? (t - a.t) / span : 1
      return a.value + (b.value - a.value) * local
    }
  }
  return last.value
}
