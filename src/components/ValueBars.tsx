// Waveform-style value bars — the DATA layer of a track lane. Bars rise
// from the lane floor; their height is the channel's value at that moment,
// so rise/fall (and easing shape, and HOLD plateaus) read at a glance the
// way an NLE audio waveform reads. Structure stays structure: the accent
// link, the diamonds and the value tags paint ON TOP (DOM order), and the
// canvas is pointer-transparent, so every lane gesture — marquee, key drag,
// dbl-click insert, playhead hit — is untouched.
//
// Canvas, not SVG: ~200 rects per lane redrawn on zoom / key edits would be
// thousands of DOM nodes here. Colors are read from the --ce-data token at
// draw time (canvas can't watch CSS vars), which is also why `theme` sits in
// the draw deps.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useUI } from '../store/ui'
import { laneValueAt, type LaneKey } from './laneValue'
import type { ChannelId } from '../features/route/cameraChannels'
import type { Route } from '../features/route/types'

type Props = {
  keys: LaneKey[]
  ch: ChannelId
  route: Route
  /** visible window (seconds, already clamped) — bars follow the zoom */
  viewStart: number
  viewSpan: number
  duration: number
}

/** slot pitch in CSS px: 2px ink + 1px gap. A display constant, not a data
 *  bin — each slot samples the value at its own centre. */
const SLOT = 3
const INK_W = 2
/** bar tops stay clear of the value tags' baseline */
const TOP_KEEP = 0.82
const ALPHA = 0.32

export default function ValueBars({ keys, ch, route, viewStart, viewSpan, duration }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  /* palette under [data-theme] — only to trigger a redraw */
  const theme = useUI((s) => s.theme)

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) =>
      setSize({ w: e.contentRect.width, h: e.contentRect.height }),
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /* keys arrive as a FRESH array every render (the grid re-renders on every
     progress tick); redraw only when the shape actually changed */
  const rev = useMemo(
    () =>
      keys
        .map((k) => `${k.tSec.toFixed(4)}@${+k.value.toFixed(6)}#${JSON.stringify(k.ease ?? 0)}`)
        .join('|'),
    [keys],
  )

  useLayoutEffect(() => {
    const cvs = canvasRef.current
    if (!cvs || size.w < 8 || size.h < 8) return
    const ctx = cvs.getContext('2d')
    if (!ctx) return
    /* device pixels for crisp 1px bars; CSS units for all the math */
    const dpr = window.devicePixelRatio || 1
    const pxW = Math.round(size.w * dpr)
    const pxH = Math.round(size.h * dpr)
    if (cvs.width !== pxW || cvs.height !== pxH) {
      cvs.width = pxW
      cvs.height = pxH
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)

    const slots = Math.max(1, Math.floor((size.w - 1) / SLOT))
    const vals: (number | null)[] = new Array<number | null>(slots).fill(null)
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < slots; i += 1) {
      const tSec = viewStart + ((i * SLOT + 1) / size.w) * viewSpan
      const v = laneValueAt(keys, ch, route, tSec, duration)
      if (v == null || !Number.isFinite(v)) continue
      vals[i] = v
      if (v < min) min = v
      if (v > max) max = v
    }
    if (!Number.isFinite(min)) return

    /* per-lane auto-fit with the curve pane's 12% padding rule: direction is
       always true and in-lane magnitudes comparable; ABSOLUTE amplitude is
       deliberately not encoded — the value tags carry the numbers */
    const pad = (max - min) * 0.12
    const span = Math.max(max - min + 2 * pad, 1e-9)
    const usable = size.h * TOP_KEEP
    /* degenerate lane (all keys equal) → norm 0 → the 2px floor below keeps
       a constant hairline of bars, honestly reading "flat" */

    ctx.fillStyle = getComputedStyle(cvs).getPropertyValue('--ce-data').trim() || '#f2a65a'
    ctx.globalAlpha = ALPHA
    for (let i = 0; i < slots; i += 1) {
      const v = vals[i]
      if (v == null) continue
      const norm = (v - (min - pad)) / span
      const bh = Math.max(2, Math.round(norm * usable))
      ctx.fillRect(i * SLOT + 1, Math.round(size.h - bh), INK_W, bh)
    }
  }, [size.w, size.h, rev, viewStart, viewSpan, ch, route, duration, theme])

  return <canvas ref={canvasRef} className="ce-value-bars" aria-hidden="true" />
}
