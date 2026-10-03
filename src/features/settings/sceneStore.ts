// Scene render settings — global look switches (Props tab, left drawer).
// Pure state — nothing here imports Cesium (glue lives in sceneSettings.ts).

import { create } from 'zustand'

const KEY = 'cineearth.sceneSettings'

export interface SceneSettings {
  /** terrain writes depth — lines/models get hidden behind mountains */
  depthTest: boolean
  /** haze painted on the globe surface */
  groundAtmosphere: boolean
  /** atmosphere shell around the planet (sky halo) */
  skyAtmosphere: boolean
  /** distance fog — fades far terrain into the horizon */
  fog: boolean
}

const DEFAULTS: SceneSettings = {
  depthTest: true,
  groundAtmosphere: true,
  skyAtmosphere: true,
  fog: true,
}

function readStored(): SceneSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SceneSettings>) }
  } catch {
    return DEFAULTS // private mode / storage disabled / corrupted value
  }
}

function writeStored(s: SceneSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable — keep it in-memory only */
  }
}

interface SceneState extends SceneSettings {
  setFlag: <K extends keyof SceneSettings>(key: K, on: boolean) => void
}

function persist(s: SceneState): void {
  writeStored({
    depthTest: s.depthTest,
    groundAtmosphere: s.groundAtmosphere,
    skyAtmosphere: s.skyAtmosphere,
    fog: s.fog,
  })
}

export const useScene = create<SceneState>((set) => ({
  ...readStored(),

  setFlag: (key, on) => {
    set({ [key]: on } as Partial<SceneState>)
    persist(useScene.getState())
  },
}))
