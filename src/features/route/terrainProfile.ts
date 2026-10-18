import { useEffect, useState } from 'react'
import { Cartographic, sampleTerrainMostDetailed, type TerrainProvider } from 'cesium'
import { getTerrainProvider, onTerrainProvider } from '../../cesium/terrainSource'
import { samplePath } from './pathMath'
import type { Route } from './types'

/** sample density shared with the side view so terrain and camera curves align */
export const PROFILE_STEPS = 140

/** geometry fingerprint — only re-sample when the ground track actually moves (~1 m) */
function routeProfileKey(route: Route): string {
  return route.waypoints
    .filter((w) => w.lat != null && w.lon != null)
    .map((w) => `${(w.lon as number).toFixed(5)},${(w.lat as number).toFixed(5)}`)
    .join('|')
}

/* module-level single-slot cache: same geometry + same provider = same profile */
let cache: { key: string; provider: TerrainProvider | null; heights: number[] | null } | null = null

/**
 * Terrain heights along the route, aligned 1:1 with `samplePath(route, PROFILE_STEPS)`.
 * Returns `null` while sampling or when the provider has no terrain
 * (flat ellipsoid) — callers fall back to the plain baseline.
 */
export function useTerrainProfile(route: Route): number[] | null {
  const key = routeProfileKey(route)
  const [heights, setHeights] = useState<number[] | null>(
    cache && cache.key === key ? cache.heights : null,
  )
  const [providerVersion, setProviderVersion] = useState(0)

  /* provider swaps (ion ↔ ArcGIS ↔ flat) must invalidate the cached profile */
  useEffect(() => onTerrainProvider(() => setProviderVersion((v) => v + 1)), [])

  useEffect(() => {
    let canceled = false
    const provider = getTerrainProvider()
    if (!provider.availability) {
      cache = { key, provider, heights: null }
      setHeights(null)
      return
    }
    if (cache && cache.key === key && cache.provider === provider) {
      setHeights(cache.heights)
      return
    }
    const poses = samplePath(route, PROFILE_STEPS)
    const cartos = poses.map((p) => Cartographic.fromDegrees(p.lon, p.lat))
    void sampleTerrainMostDetailed(provider, cartos).then(() => {
      if (canceled) return
      const sampled: number[] = cartos.map((c) => (Number.isFinite(c.height) ? c.height : 0))
      cache = { key, provider, heights: sampled }
      setHeights(sampled)
    })
    return () => {
      canceled = true
    }
  }, [key, providerVersion, route])

  return heights
}
