// Ion token store — the visitor's OWN Cesium ion access key.
// Privacy contract:
//  · the token lives in this browser's localStorage only;
//  · it is never sent to any CineEarth server (the app is fully static);
//  · the browser uses it to talk to ion.cesium.com directly, like any ion app.
// Pure state — nothing here imports Cesium (glue lives in ionTerrain.ts).

import { create } from 'zustand'

const TOKEN_KEY = 'cineearth.ionToken'
const TERRAIN_KEY = 'cineearth.terrainEnabled'

export type IonTokenStatus = 'none' | 'checking' | 'valid' | 'invalid' | 'unknown'

interface IonState {
  token: string
  status: IonTokenStatus
  terrainEnabled: boolean

  setToken: (token: string) => void
  setStatus: (status: IonTokenStatus) => void
  setTerrainEnabled: (on: boolean) => void
  resetToken: () => void
}

function readStored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback // private mode / storage disabled
  }
}

function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* storage unavailable — keep it in-memory only */
  }
}

export const useIon = create<IonState>((set) => ({
  token: readStored(TOKEN_KEY, ''),
  status: 'none',
  terrainEnabled: readStored(TERRAIN_KEY, '1') !== '0',

  setToken: (token) => {
    writeStored(TOKEN_KEY, token)
    set({ token, status: token ? 'checking' : 'none' })
  },
  setStatus: (status) => set({ status }),
  setTerrainEnabled: (on) => {
    writeStored(TERRAIN_KEY, on ? '1' : '0')
    set({ terrainEnabled: on })
  },
  resetToken: () => {
    writeStored(TOKEN_KEY, null)
    set({ token: '', status: 'none' })
  },
}))
