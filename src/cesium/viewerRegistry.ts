// Viewer registry — decouples feature modules from React tree.
// The globe is an imperative island; features (export, route bridge)
// resolve the live Viewer through this tiny registry instead of prop drilling.

import type { Viewer } from 'cesium'

let viewer: Viewer | null = null
let programViewer: Viewer | null = null
let programRefresh: (() => void) | null = null

export function setViewer(next: Viewer | null): void {
  viewer = next
}

export function getViewer(): Viewer | null {
  return viewer
}

/** the Program Out monitor's Viewer (main-grid cell #0). The exporter renders
 *  THIS Viewer — the very picture 主输出 puts on air. `null` while the monitor
 *  is unmounted (≤1 shot there is no monitor). */
export function setProgramViewer(next: Viewer | null): void {
  programViewer = next
}

export function getProgramViewer(): Viewer | null {
  return programViewer
}

/** the Program Out monitor registers its "resync entities + framing now"
 *  callback here so the exporter can hand the Viewer back cleanly after it
 *  takes over frame-by-frame. `null` while the monitor is unmounted. */
export function setProgramRefresh(fn: (() => void) | null): void {
  programRefresh = fn
}

export function refreshProgramViewer(): void {
  programRefresh?.()
}
