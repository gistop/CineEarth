// Attitude gauge — heading / pitch / roll / fov for ONE keyframe (or the
// playhead pose, read-only). Pure presentational + interaction; the data
// binding (which waypoint, commit to the store) lives in the container.
//
// Drag zones by pointer radius (single-pointer, mouse & touch alike):
//   outer ring  → heading (rotate)
//   centre      → pitch   (drag up/down)
//   inner ring  → roll    (rotate the little ring)
//   wedge band  → fov     (open/close the wedge)
// Zones rely on visible geometry, not hover hints — tablet friendly.

import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useT } from '../../i18n'

export type AttitudeValue = { heading: number; pitch: number; roll: number; fov: number }

type Props = {
  value: AttitudeValue
  onChange?: (patch: Partial<AttitudeValue>) => void
  readOnly?: boolean
  /** small tag next to the readout, e.g. "WP 3" / "playhead" */
  badge?: string
}

const VB = 160
const C = VB / 2
const R_RING_OUT = 74 // heading ring outer edge
const R_FOV_OUT = 58 // fov wedge outer arc
const R_FOV_IN = 42 // fov wedge inner arc
const R_HORIZON = 40 // attitude ball clip radius
const R_ROLL = 16 // roll ring visual radius
/* hit zones (svg units): roll ≤ 26 < pitch < 46 ≤ fov ≤ 60 < heading */
const HIT_ROLL = 26
const HIT_FOV = 46
const HIT_HEAD = 60
const PITCH_PX_PER_DEG = 1 // attitude-ball travel

type Mode = 'heading' | 'pitch' | 'roll' | 'fov'
type Drag0 = { mode: Mode; theta0: number; y0: number; v0: AttitudeValue }

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
/** shortest signed angular difference a−b in degrees (−180…180] */
const angleDelta = (a: number, b: number) => ((a - b + 540) % 360) - 180
const normHeading = (deg: number) => ((deg % 360) + 360) % 360
const normRoll = (deg: number) => {
  const d = ((deg + 180) % 360 + 360) % 360 - 180
  return d === -180 ? 180 : d
}
/** pointer → compass bearing (0 = up/north, clockwise) in svg coords */
const bearingAt = (x: number, y: number) => (Math.atan2(x - C, C - y) * 180) / Math.PI

const fmtDeg = (v: number) => `${Math.round(v)}°`

export default function AttitudeGauge({ value, onChange, readOnly, badge }: Props) {
  const t = useT()
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<Drag0 | null>(null)

  const toSvg = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const ctm = svgRef.current?.getScreenCTM()
    if (!ctm) return null
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
    return { x: p.x, y: p.y }
  }

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (readOnly || !onChange || e.button !== 0) return
    const p = toSvg(e.clientX, e.clientY)
    if (!p) return
    const r = Math.hypot(p.x - C, p.y - C)
    let mode: Mode
    if (r <= HIT_ROLL) mode = 'roll'
    else if (r < HIT_FOV) mode = 'pitch'
    else if (r <= HIT_HEAD) mode = 'fov'
    else if (r <= R_RING_OUT + 8) mode = 'heading'
    else return
    e.preventDefault()
    svgRef.current?.setPointerCapture(e.pointerId)
    dragRef.current = { mode, theta0: bearingAt(p.x, p.y), y0: p.y, v0: value }
  }

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag || !onChange) return
    const p = toSvg(e.clientX, e.clientY)
    if (!p) return
    const theta = bearingAt(p.x, p.y)
    switch (drag.mode) {
      case 'heading':
        onChange({ heading: normHeading(drag.v0.heading + angleDelta(theta, drag.theta0)) })
        break
      case 'roll':
        onChange({ roll: clamp(normRoll(drag.v0.roll + angleDelta(theta, drag.theta0)), -180, 180) })
        break
      case 'pitch':
        onChange({
          pitch: clamp(drag.v0.pitch + (drag.y0 - p.y) * PITCH_PX_PER_DEG, -89.9, 89.9),
        })
        break
      case 'fov':
        onChange({ fov: clamp(drag.v0.fov + 2 * angleDelta(theta, drag.theta0), 5, 120) })
        break
    }
  }

  const endDrag = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    svgRef.current?.releasePointerCapture?.(e.pointerId)
  }

  const { heading, pitch, roll, fov } = value

  /* compass ticks every 30° (fixed, N up) + cardinal letters */
  const ticks: { deg: number; major: boolean }[] = []
  for (let deg = 0; deg < 360; deg += 30) ticks.push({ deg, major: deg % 90 === 0 })
  const cardinal = (deg: number) =>
    ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' })[deg as 0 | 90 | 180 | 270] ?? ''

  /* fov wedge drawn pointing UP, the whole group rotated to the heading */
  const half = fov / 2
  const fovPath = [
    `M${arcPoint(R_FOV_IN, -half)}`,
    `L${arcPoint(R_FOV_OUT, -half)}`,
    `A${R_FOV_OUT} ${R_FOV_OUT} 0 0 1 ${arcPoint(R_FOV_OUT, half)}`,
    `L${arcPoint(R_FOV_IN, half)}`,
    `A${R_FOV_IN} ${R_FOV_IN} 0 0 0 ${arcPoint(R_FOV_IN, -half)}`,
    'Z',
  ].join(' ')

  /* attitude ball: horizon group tilted by roll, shifted by pitch */
  const horizonShift = pitch * PITCH_PX_PER_DEG

  return (
    <figure className="ce-minimap">
      <figcaption>
        <span>{t('route.attitude.caption')}</span>
        {badge && <span className="ce-attitude-badge">{badge}</span>}
      </figcaption>
      <svg
        ref={svgRef}
        className={`ce-attitude${dragRef.current ? ' is-dragging' : ''}`}
        viewBox={`0 0 ${VB} ${VB}`}
        role="img"
        aria-label={t('route.attitude.aria')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <title>{t('route.attitude.aria')}</title>

        {/* heading ring — fixed compass, rotating pointer */}
        {ticks.map(({ deg, major }) => (
          <line
            key={deg}
            className="ce-attitude-tick"
            x1={tickX1(deg, major)}
            y1={tickY1(deg, major)}
            x2={tickX2(deg)}
            y2={tickY2(deg)}
          />
        ))}
        {ticks
          .filter(({ major }) => major)
          .map(({ deg }) => (
            <text
              key={deg}
              className="ce-attitude-cardinal"
              x={cardinalX(deg)}
              y={cardinalY(deg)}
            >
              {cardinal(deg)}
            </text>
          ))}

        {/* fov wedge + nose pointer, rotated to heading (SVG rotate is CW) */}
        <g transform={`rotate(${heading} ${C} ${C})`}>
          <path className="ce-attitude-fov" d={fovPath} />
          <line className="ce-attitude-needle" x1={C} y1={C - R_HORIZON} x2={C} y2={C - R_FOV_OUT} />
        </g>

        {/* attitude ball — sky/ground split, tilted by roll, shifted by pitch */}
        <clipPath id="ce-attitude-ball">
          <circle cx={C} cy={C} r={R_HORIZON} />
        </clipPath>
        <g clipPath="url(#ce-attitude-ball)">
          <g transform={`rotate(${roll} ${C} ${C}) translate(0 ${horizonShift})`}>
            <rect
              className="ce-attitude-ground-fill"
              x={C - 2 * R_HORIZON}
              y={C}
              width={4 * R_HORIZON}
              height={2 * R_HORIZON}
            />
            <line
              className="ce-attitude-horizon"
              x1={C - 2 * R_HORIZON}
              y1={C}
              x2={C + 2 * R_HORIZON}
              y2={C}
            />
            {[-30, -20, -10, 10, 20, 30].map((deg) => (
              <line
                key={deg}
                className="ce-attitude-pitchline"
                x1={C - (Math.abs(deg) === 10 ? 12 : 8)}
                y1={C - deg * PITCH_PX_PER_DEG}
                x2={C + (Math.abs(deg) === 10 ? 12 : 8)}
                y2={C - deg * PITCH_PX_PER_DEG}
              />
            ))}
          </g>
        </g>

        {/* fixed aircraft symbol at dead centre */}
        <circle className="ce-attitude-craft" cx={C} cy={C} r={2.4} />
        <line className="ce-attitude-craft" x1={C - 9} y1={C} x2={C - 4} y2={C} />
        <line className="ce-attitude-craft" x1={C + 4} y1={C} x2={C + 9} y2={C} />

        {/* roll ring — small ring around the centre, marker shows bank */}
        <circle className="ce-attitude-ring" cx={C} cy={C} r={R_ROLL} />
        <g transform={`rotate(${roll} ${C} ${C})`}>
          <polygon
            className="ce-attitude-rollmark"
            points={`${C},${C - R_ROLL - 3} ${C - 3},${C - R_ROLL + 3} ${C + 3},${C - R_ROLL + 3}`}
          />
        </g>
      </svg>
      <div className="ce-attitude-readout">
        <span>H {fmtDeg(heading)}</span>
        <span>P {fmtDeg(pitch)}</span>
        <span>R {fmtDeg(roll)}</span>
        <span>F {fmtDeg(fov)}</span>
      </div>
    </figure>
  )
}

/* ---- svg geometry helpers (angles are "up = 0, clockwise") ---- */

function arcPoint(r: number, deg: number): string {
  const rad = ((deg - 90) * Math.PI) / 180
  return `${(C + r * Math.cos(rad)).toFixed(2)} ${(C + r * Math.sin(rad)).toFixed(2)}`
}
function polar(r: number, deg: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180
  return { x: C + r * Math.cos(rad), y: C + r * Math.sin(rad) }
}
const tickInner = (deg: number, major: boolean) => polar(R_RING_OUT - (major ? 8 : 4), deg)
const tickOuter = (deg: number) => polar(R_RING_OUT, deg)
const tickX1 = (deg: number, major: boolean) => tickInner(deg, major).x
const tickY1 = (deg: number, major: boolean) => tickInner(deg, major).y
const tickX2 = (deg: number) => tickOuter(deg).x
const tickY2 = (deg: number) => tickOuter(deg).y
const cardinalX = (deg: number) => polar(R_RING_OUT - 15, deg).x
const cardinalY = (deg: number) => polar(R_RING_OUT - 15, deg).y + 2.5
