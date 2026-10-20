// Asset animation tracks — GES-style property keyframes for drawn lines.
// Growth = % of arc length visible, Lift = metres above ground; keys are
// TIMELINE fractions evaluated AE-style (shared evalReveal from the route
// growth system — same curve semantics, different host). A prop with no keys
// is "not animated": the static LineStyle value wins. Pure data only — the
// scene side (assetScene.ts) reads it from CallbackProperties each frame.

import { create } from 'zustand'
import { evalReveal } from '../route/revealStore'

export type AnimProp = 'growth' | 'lift'

export type AnimKey = {
  id: string
  /** timeline fraction 0..1 */
  t: number
  /** growth: 0..100 %, lift: metres */
  value: number
}

export interface AssetAnimTrack {
  growth: AnimKey[]
  lift: AnimKey[]
}

/** matches the Lift slider's range in LineStylePanel */
export const LIFT_MAX = 300

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

let seq = 0
const nextKeyId = () => `ak-${Date.now().toString(36)}-${seq += 1}`

/** fresh copies per track — default keys must stay independently editable */
const defaultGrowth = (): AnimKey[] => [
  { id: nextKeyId(), t: 0, value: 0 },
  { id: nextKeyId(), t: 1, value: 100 },
]

interface AssetAnimState {
  /** per line-asset tracks — created from the assets panel (入口 B) */
  tracks: Record<string, AssetAnimTrack>
  selectedKeyId: string | null

  addTrack: (assetId: string) => void
  removeTrack: (assetId: string) => void
  addKey: (assetId: string, prop: AnimProp, t: number) => void
  moveKey: (assetId: string, prop: AnimProp, id: string, t: number, value: number) => void
  removeKey: (assetId: string, prop: AnimProp, id: string) => void
  selectKey: (id: string | null) => void
}

const valueRange = (prop: AnimProp) => (prop === 'growth' ? 100 : LIFT_MAX)

export const useAnim = create<AssetAnimState>((set) => {
  const patchTrack = (assetId: string, prop: AnimProp, keys: AnimKey[]) =>
    set((s) => {
      const track = s.tracks[assetId]
      if (!track) return s
      return { tracks: { ...s.tracks, [assetId]: { ...track, [prop]: keys } } }
    })

  return {
    tracks: {},
    selectedKeyId: null,

    addTrack: (assetId) =>
      set((s) =>
        s.tracks[assetId]
          ? s
          : { tracks: { ...s.tracks, [assetId]: { growth: defaultGrowth(), lift: [] } } },
      ),

    removeTrack: (assetId) =>
      set((s) => {
        const { [assetId]: _drop, ...rest } = s.tracks
        return {
          tracks: rest,
          selectedKeyId: s.selectedKeyId?.startsWith('ak') && _drop
            ? (_drop.growth.some((k) => k.id === s.selectedKeyId) ||
               _drop.lift.some((k) => k.id === s.selectedKeyId))
              ? null
              : s.selectedKeyId
            : s.selectedKeyId,
        }
      }),

    /* AE behaviour: a new key takes the curve's current value — no shape change */
    addKey: (assetId, prop, t) => {
      const track = useAnim.getState().tracks[assetId]
      if (!track) return
      const keys = track[prop]
      const value = keys.length ? evalReveal(keys, clamp01(t)) : prop === 'growth' ? 100 : 0
      patchTrack(assetId, prop, [...keys, { id: nextKeyId(), t: clamp01(t), value }])
    },

    moveKey: (assetId, prop, id, t, value) => {
      const track = useAnim.getState().tracks[assetId]
      if (!track) return
      const max = valueRange(prop)
      patchTrack(
        assetId,
        prop,
        track[prop].map((k) =>
          k.id === id ? { ...k, t: clamp01(t), value: Math.min(max, Math.max(0, value)) } : k,
        ),
      )
    },

    removeKey: (assetId, prop, id) => {
      const track = useAnim.getState().tracks[assetId]
      if (!track) return
      patchTrack(
        assetId,
        prop,
        track[prop].filter((k) => k.id !== id),
      )
      if (useAnim.getState().selectedKeyId === id) useAnim.getState().selectKey(null)
    },

    selectKey: (selectedKeyId) => set({ selectedKeyId }),
  }
})

/** evaluated prop at timeline fraction t; null → prop has no keys → the
 *  static LineStyle value wins (lift) / fully shown (growth) */
export function evalAnim(
  track: AssetAnimTrack | undefined,
  prop: AnimProp,
  t: number,
): number | null {
  const keys = track?.[prop]
  if (!keys || keys.length === 0) return null
  return evalReveal(keys, t)
}
