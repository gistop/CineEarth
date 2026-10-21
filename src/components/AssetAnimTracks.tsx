import { Fragment, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useAssets, type SceneAsset } from '../features/assets/assetStore'
import {
  useAnim,
  evalAnim,
  LIFT_MAX,
  type AnimKey,
  type AnimProp,
  type AssetAnimTrack,
} from '../features/assets/assetAnimStore'
import { applyLineStyle } from '../features/assets/assetScene'
import { useRoute } from '../features/route/routeStore'
import { useT, type I18nKey } from '../i18n'
import { InsertKeyBtn, SoloLabel } from './TimelineWidgets'

/**
 * Asset animation lanes — timeline-bound line assets (created from the assets
 * panel 入口 B), shaped EXACTLY like the 机位 stack so the two read as one
 * system:
 *
 *  • header row mirrors ShotTrack — caret (▸ fold/unfold, the only entry),
 *    name, frame count, × (unbind from the timeline);
 *  • channel rows mirror the camera attribute rows — SoloLabel (click =
 *    detail pane over the lane, click again = clear) + InsertKeyBtn (◇ keys
 *    at the playhead) + a key lane;
 *  • detail pane mirrors the GES curve editor — value-mapped grid/ticks and
 *    freely draggable keys (time ↔ x, value ↔ y).
 *
 * Keys are TIMELINE fractions evaluated AE-style (evalAnim), the same clock
 * the scene Callbacks obey. Gestures are local (pointer capture +
 * stopPropagation) so the container's marquee system never sees them.
 */

type Props = {
  /** TIMELINE length in seconds */
  duration: number
  /** zoom window — px→time conversion for the gestures */
  viewStart: number
  viewSpan: number
  /** the SINGLE detail selection, LIFTED into TimelineTracks next to the
   *  camera solo: .ce-lanes.is-detail (the full-pane curve overlay) keys off
   *  it, and the two editors exclude each other there */
  solo: AnimSolo
  onSoloChange: (s: AnimSolo) => void
}

/** which asset channel owns the detail pane — { assetId, prop } or null */
export type AnimSolo = { assetId: string; prop: AnimProp } | null

/* labels resolve through the dictionary at RENDER time (a plain string here
   would freeze whatever locale was active at module load) */
const PROPS: { id: AnimProp; labelKey: I18nKey; unit: string; max: number; step: number }[] = [
  { id: 'growth', labelKey: 'aam.growth', unit: '%', max: 100, step: 0.5 },
  { id: 'lift', labelKey: 'aam.lift', unit: 'm', max: LIFT_MAX, step: 2 },
]

type Drag = {
  assetId: string
  prop: AnimProp
  keyId: string
  t0: number
  value0: number
  laneW: number
  laneH: number
  laneTop: number
  startX: number
  startY: number
  curve: boolean
}

export default function AssetAnimTracks({ duration, viewStart, viewSpan, solo, onSoloChange }: Props) {
  const t = useT()
  const tracks = useAnim((s) => s.tracks)
  const assets = useAssets((s) => s.assets)
  const selectedKeyId = useAnim((s) => s.selectedKeyId)
  const progress = useRoute((s) => s.progress)
  const dragRef = useRef<Drag | null>(null)
  /* 机位 semantics: expansion is VISUAL ONLY (a collapse set — everything is
     open by default); solo arrives from the parent (see Props.solo) */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const list = Object.entries(tracks)
    .map(([id, track]) => ({ id, track, asset: assets.find((a) => a.id === id) }))
    .filter((x): x is { id: string; track: AssetAnimTrack; asset: SceneAsset } => Boolean(x.asset?.line))

  /** timeline fraction → lane percent through the zoom window */
  const pct = (t: number) => ((t * duration - viewStart) / viewSpan) * 100

  /* Delete/Backspace removes the selected asset key (skipped while typing) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const el = e.target as HTMLElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable) return
      const selected = useAnim.getState().selectedKeyId
      if (!selected) return
      const anim = useAnim.getState()
      for (const [assetId, track] of Object.entries(anim.tracks)) {
        for (const prop of PROPS) {
          if (track[prop.id].some((k) => k.id === selected)) {
            anim.removeKey(assetId, prop.id, selected)
            return
          }
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (list.length === 0 || duration <= 0) return null

  const insertAtPlayhead = (assetId: string, prop: AnimProp) => {
    const keys = useAnim.getState().tracks[assetId]?.[prop] ?? []
    /* a key already sits at the playhead → nothing to add */
    if (keys.some((k) => Math.abs(k.t - progress) < 0.005)) return
    useAnim.getState().addKey(assetId, prop, progress)
  }

  const addKeyAtEvent = (
    e: React.MouseEvent<HTMLDivElement>,
    assetId: string,
    prop: AnimProp,
  ) => {
    const lane = e.currentTarget
    const ratio = Math.min(1, Math.max(0, (e.clientX - lane.getBoundingClientRect().left) / lane.offsetWidth))
    const t = Math.min(1, Math.max(0, (viewStart + ratio * viewSpan) / duration))
    useAnim.getState().addKey(assetId, prop, t)
  }

  const onKeyPointerDown = (
    e: ReactPointerEvent<HTMLSpanElement>,
    assetId: string,
    prop: AnimProp,
    k: AnimKey,
    curve: boolean,
  ) => {
    /* this drag is ours alone — never let the container's marquee see it */
    e.stopPropagation()
    useAnim.getState().selectKey(k.id)
    const lane = e.currentTarget.closest('.ce-track-lane')?.getBoundingClientRect()
    if (!lane) return
    dragRef.current = {
      assetId,
      prop,
      keyId: k.id,
      t0: k.t,
      value0: k.value,
      laneW: lane.width,
      laneH: lane.height,
      laneTop: lane.top,
      startX: e.clientX,
      startY: e.clientY,
      curve,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onKeyPointerMove = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const d = dragRef.current
    if (!d) return
    const meta = PROPS.find((p) => p.id === d.prop)
    if (!meta) return
    const dt = ((e.clientX - d.startX) / d.laneW) * (viewSpan / duration)
    /* detail pane: the pointer IS the value (lane y maps 0..max bottom-up);
       plain lane: vertical drag is an incremental value nudge */
    const value = d.curve
      ? Math.min(meta.max, Math.max(0, (1 - (e.clientY - d.laneTop) / d.laneH) * meta.max))
      : Math.min(meta.max, Math.max(0, d.value0 - (e.clientY - d.startY) * meta.step))
    useAnim.getState().moveKey(d.assetId, d.prop, d.keyId, d.t0 + dt, value)
  }

  const onKeyPointerUp = () => {
    dragRef.current = null
  }

  const removeKeyAt = (assetId: string, prop: AnimProp, keyId: string) => {
    useAnim.getState().removeKey(assetId, prop, keyId)
  }

  return (
    <>
      {list.map(({ id, track, asset }) => {
        const open = !collapsed.has(id)
        return (
          /* rows are laid down FLAT (Fragment), exactly like the 机位 stack:
             .ce-lanes is a flex column whose direct children are the rows —
             a wrapping div here would swallow the row gap, the label-column
             grid alignment and the fixed row heights (the 图1 scramble) */
          <Fragment key={id}>
            {/* header — mirrors a 机位 row: caret / name / frame count / × */}
            <div
              className="ce-shot ce-anim-shot"
              title={t('aam.header', { name: asset.name })}
            >
              <div className="ce-shot-side">
                <button
                  type="button"
                  className={`ce-shot-caret${open ? ' is-open' : ''}`}
                  title={open ? t('aam.fold') : t('aam.unfold')}
                  aria-label={open ? t('aam.ariaFold', { name: asset.name }) : t('aam.ariaUnfold', { name: asset.name })}
                  aria-expanded={open}
                  onClick={() => {
                    /* collapsing the group that owns the detail pane must
                       leave it — the rows unmount and the pane would dangle */
                    if (open && solo?.assetId === id) onSoloChange(null)
                    setCollapsed((cur) => {
                      const next = new Set(cur)
                      if (next.has(id)) next.delete(id)
                      else next.add(id)
                      return next
                    })
                  }}
                >
                  ▸
                </button>
                <span className="ce-shot-name">{asset.name}</span>
                <span className="ce-shot-dur">{t('aam.frames', { n: track.growth.length + track.lift.length })}</span>
                <button
                  type="button"
                  className="ce-shot-del"
                  title={t('aam.remove')}
                  aria-label={t('aam.removeAria', { name: asset.name })}
                  onClick={() => {
                    useAnim.getState().removeTrack(id)
                    if (solo?.assetId === id) onSoloChange(null)
                    applyLineStyle(id)
                  }}
                >
                  ×
                </button>
              </div>
              <div className="ce-shot-lane">
                <span className="ce-anim-badge">{t('aam.badge')}</span>
              </div>
            </div>

            {open &&
              PROPS.map((p) => {
                /* render in TIME order — the store array keeps INSERTION
                   order, so after a drag re-times a key the unsorted polyline
                   zig-zags and reads as broken (the 图3 gap). evalReveal sorts
                   internally when evaluating; the render must sort too. */
                const keys = [...track[p.id]].sort((a, b) => a.t - b.t)
                const isSolo = solo?.assetId === id && solo.prop === p.id
                const label = t(p.labelKey)
                const cur = evalAnim(track, p.id, progress)
                const yPct = (v: number) => 100 - (v / p.max) * 100
                return (
                  <div className={`ce-track${isSolo ? ' is-selected' : ''}`} key={p.id}>
                    <div className="ce-track-side">
                      <SoloLabel
                        id={p.id}
                        label={label}
                        value={cur != null ? `${Math.round(cur)}${p.unit}` : undefined}
                        solo={isSolo ? p.id : null}
                        onToggle={() => onSoloChange(isSolo ? null : { assetId: id, prop: p.id })}
                      />
                      <InsertKeyBtn label={label} onInsert={() => insertAtPlayhead(id, p.id)} />
                    </div>
                    <div
                      className={`ce-track-lane${isSolo ? ' is-curve ce-anim-curve' : ' ce-reveal-lane'}`}
                      title={isSolo ? t('aam.laneOpen', { label }) : t('aam.laneFold', { label })}
                      onDoubleClick={(e) => {
                        if ((e.target as HTMLElement).closest('.ce-key')) return
                        addKeyAtEvent(e, id, p.id)
                      }}
                    >
                      {isSolo ? (
                        <>
                          {/* GES-style value-mapped detail pane (机位同款) */}
                          <div className="ce-curve-grid" aria-hidden="true">
                            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                              <span
                                key={`g${f}`}
                                className="ce-curve-gridline"
                                style={{ top: `${f * 100}%` }}
                              />
                            ))}
                            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                              <i key={`t${f}`} className="ce-curve-tick" style={{ top: `${f * 100}%` }}>
                                {Math.round(p.max * (1 - f))}
                                {p.unit}
                              </i>
                            ))}
                          </div>
                          <svg className="ce-curve-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                            <polyline
                              className="ce-curve-line"
                              points={keys.map((k) => `${pct(k.t)},${yPct(k.value)}`).join(' ')}
                              vectorEffect="non-scaling-stroke"
                            />
                          </svg>
                          {keys.map((k) => (
                            <Fragment key={k.id}>
                              <span
                                className={`ce-key is-curve-key${selectedKeyId === k.id ? ' is-selected' : ''}`}
                                style={{ left: `${pct(k.t)}%`, top: `${yPct(k.value)}%` }}
                                title={t('aam.keyTitle', { label: Math.round(k.value), unit: p.unit, t: (k.t * duration).toFixed(1) })}
                                onPointerDown={(e) => onKeyPointerDown(e, id, p.id, k, true)}
                                onPointerMove={onKeyPointerMove}
                                onPointerUp={onKeyPointerUp}
                                onPointerCancel={onKeyPointerUp}
                                onDoubleClick={(e) => {
                                  e.stopPropagation()
                                  removeKeyAt(id, p.id, k.id)
                                }}
                              />
                              <span
                                className="ce-key-val is-curve"
                                style={{ left: `${pct(k.t)}%`, top: `calc(${yPct(k.value)}% + 7px)` }}
                              >
                                {Math.round(k.value)}
                                {p.unit}
                              </span>
                            </Fragment>
                          ))}
                        </>
                      ) : (
                        <>
                          {keys.length > 1 && (
                            <svg className="ce-reveal-curve" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                              <polyline
                                points={keys.map((k) => `${pct(k.t)},${yPct(k.value)}`).join(' ')}
                                vectorEffect="non-scaling-stroke"
                              />
                            </svg>
                          )}
                          {keys.map((k) => (
                            <span
                              key={k.id}
                              className={`ce-key ce-reveal-key${selectedKeyId === k.id ? ' is-selected' : ''}`}
                              style={{ left: `${pct(k.t)}%` }}
                              title={t('aam.keyTitle', { label: Math.round(k.value), unit: p.unit, t: (k.t * duration).toFixed(1) })}
                              onPointerDown={(e) => onKeyPointerDown(e, id, p.id, k, false)}
                              onPointerMove={onKeyPointerMove}
                              onPointerUp={onKeyPointerUp}
                              onPointerCancel={onKeyPointerUp}
                              onDoubleClick={(e) => {
                                e.stopPropagation()
                                removeKeyAt(id, p.id, k.id)
                              }}
                            />
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
          </Fragment>
        )
      })}
    </>
  )
}
