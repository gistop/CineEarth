// Growth-line keyframe track — AE-style "方式 C" for path reveal.
// Pure data + pure evaluation: any instant maps to a deterministic reveal%,
// so scrubbing / paused edits / offline export all share one truth.
// The scene bridge subscribes; nothing here touches Cesium.
//
// Keys are PER-SHOT (每机位各一条生长曲线): routeStore mirrors the active
// shot id into this store (setActiveShot / initShot / dropShot) — reveal never
// imports the route store, so there is no cycle. `keys` stays a DERIVED compat
// field (the active shot's curve): every existing consumer — scene bridge,
// timeline lane, export — keeps reading it and follows the active 机位 for
// free.

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
  /** per-shot keyframe tracks — one growth curve per 机位 */
  byShot: Record<string, RevealKey[]>
  /** MIRRORED active shot id — owned & written by routeStore only */
  activeShotId: string | null
  /** DERIVED compat: the active shot's keys (what consumers subscribe to) */
  keys: RevealKey[]
  selectedKeyId: string | null

  setGrowthLine: (on: boolean) => void
  /** add a key at t — value = current curve value (AE behaviour: no shape change) */
  addKey: (t: number) => void
  moveKey: (id: string, t: number, value: number) => void
  removeKey: (id: string) => void
  selectKey: (id: string | null) => void
  resetKeys: () => void

  /* shot lifecycle — routeStore calls these when shots switch / spawn / die.
     `null` = no shot being edited (the route mirror was cleared) */
  setActiveShot: (id: string | null) => void
  initShot: (id: string) => void
  dropShot: (id: string) => void
}

export const useReveal = create<RevealState>((set) => {
  /** write the ACTIVE shot's entry and keep the derived `keys` in lockstep */
  const patchActive = (keys: RevealKey[]) =>
    set((s) => ({ keys, byShot: { ...s.byShot, [s.activeShotId ?? '']: keys } }))
  return {
    growthLine: false,
    byShot: {},
    activeShotId: null,
    keys: DEFAULT_REVEAL_KEYS,
    selectedKeyId: null,

    setGrowthLine: (growthLine) => set({ growthLine }),
    addKey: (t) =>
      patchActive([...useReveal.getState().keys, { id: nextKeyId(), t: clamp01(t), value: evalReveal(useReveal.getState().keys, t) }]),
    moveKey: (id, t, value) =>
      patchActive(
        useReveal.getState().keys.map((k) =>
          k.id === id ? { ...k, t: clamp01(t), value: clampPct(value) } : k,
        ),
      ),
    removeKey: (id) => {
      const keys = useReveal.getState().keys.filter((k) => k.id !== id)
      patchActive(keys)
      if (useReveal.getState().selectedKeyId === id) useReveal.getState().selectKey(null)
    },
    selectKey: (selectedKeyId) => set({ selectedKeyId }),
    resetKeys: () => {
      patchActive(DEFAULT_REVEAL_KEYS)
      useReveal.getState().selectKey(null)
    },

    /* self-seeding: a shot id never seen before starts from the default curve */
    setActiveShot: (id) =>
      set((s) => {
        if (id == null) {
          /* no shot being edited: drop the mirror and hand back the default
             curve. Do NOT write a `null`/'' key into byShot. */
          return { activeShotId: null, keys: DEFAULT_REVEAL_KEYS, selectedKeyId: null }
        }
        const keys = s.byShot[id] ?? DEFAULT_REVEAL_KEYS
        return { activeShotId: id, keys, byShot: { ...s.byShot, [id]: keys }, selectedKeyId: null }
      }),
    initShot: (id) =>
      set((s) => (s.byShot[id] ? {} : { byShot: { ...s.byShot, [id]: DEFAULT_REVEAL_KEYS } })),
    dropShot: (id) =>
      set((s) => {
        const rest = { ...s.byShot }
        delete rest[id]
        return { byShot: rest }
      }),
  }
})

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
