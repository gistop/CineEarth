import { useState } from 'react'
import { useUI } from '../store/ui'
import { useRoute } from '../features/route/routeStore'
import { timelineDuration, totalDuration } from '../features/route/pathMath'
import type { InsertStrategy } from '../features/route/types'
import { useT } from '../i18n'

/** GES-style fixed fps presets */
const FPS_OPTIONS = [24, 25, 30, 50, 60]

/** timeline unit — seconds or frames (frames convert through the fps) */
type LenUnit = 'sec' | 'frame'

/**
 * Project settings column — the free strip at the right of the expanded
 * timeline's lane grid (level with the track rows): 长度 (秒/帧) · 插入 · 帧率 ·
 * 尺寸 · 关键帧 (read-only waypoint count). Rendered inside .ce-tracks, so it
 * hides with the tracks when collapsed.
 *
 * 长度 (route.timelineLen), 插入 (route.insertStrategy) and 帧率 (route.fps)
 * are wired to the store; 尺寸 (ui.outW/outH) drives the on-screen frame
 * ratio (--ce-out-w/h: monitor letterbox + GES mask) AND the encoded video
 * size — one source of truth for framing and export.
 */
export default function TimelineSettings() {
  const t = useT()
  const route = useRoute((s) => s.route)
  const setFps = useRoute((s) => s.setFps)
  const setTimelineLen = useRoute((s) => s.setTimelineLen)
  const setInsertStrategy = useRoute((s) => s.setInsertStrategy)
  const fitTimeline = useRoute((s) => s.fitTimeline)
  const unit = useUI((s) => s.tlUnit)
  const setTlUnit = useUI((s) => s.setTlUnit)

  /* the length is a DRAFT, committed on Enter / blur: committing per keystroke
     would re-time the keys on every intermediate value (1 → 12 → 120…) */
  const [draft, setDraft] = useState<string | null>(null)
  /* duration-change modifier (GES "将现有关键帧的时长调节到新时长") — a sticky
     flag, safe precisely because the length only commits on Enter / blur */
  const [scale, setScale] = useState(false)
  /* output size — global (not per-route): re-letters every monitor AND
   *  re-targets the export encode in one move */
  const outW = useUI((s) => s.outW)
  const outH = useUI((s) => s.outH)
  const setOutSize = useUI((s) => s.setOutSize)
  /* like the length: DRAFTS committed on Enter / blur — committing per
   *  keystroke would re-letterbox every monitor on each intermediate value */
  const [draftW, setDraftW] = useState<string | null>(null)
  const [draftH, setDraftH] = useState<string | null>(null)

  /* no shot being edited → the project settings column has nothing to edit */
  if (!route) return null

  const fps = route.fps
  const len = timelineDuration(route)
  const content = totalDuration(route)
  /* content runs past the timeline end → keys are KEPT, just out of range */
  const over = content > len + 1e-3

  /** a length in the given unit → seconds (null = empty / invalid input) */
  const parseLen = (text: string, u: LenUnit): number | null => {
    const n = Number(text)
    if (!Number.isFinite(n) || n <= 0) return null
    return u === 'sec' ? n : Math.round(n) / fps
  }
  const fmtLen = (sec: number, u: LenUnit) =>
    u === 'sec' ? sec.toFixed(1) : String(Math.max(1, Math.round(sec * fps)))

  /** Enter / blur: commit the draft; anything invalid just reverts */
  const commitLen = () => {
    if (draft == null) return
    const sec = parseLen(draft, unit)
    if (sec != null) setTimelineLen(sec, scale)
    setDraft(null)
  }

  /** keep the value, only re-express it in the new unit */
  const switchUnit = (u: LenUnit) => {
    if (u === unit) return
    /* an uncommitted draft carries over: commit it while still in the old unit */
    if (draft != null) {
      const sec = parseLen(draft, unit)
      if (sec != null) setTimelineLen(sec, scale)
      setDraft(null)
    }
    setTlUnit(u)
  }

  /** positive int with fallback to the previous value while typing */
  const num = (v: string, prev: number) => {
    const n = Math.round(Number(v))
    return Number.isFinite(n) && n > 0 ? n : prev
  }

  /** Enter / blur: commit the size draft (store clamps to even, sane px) */
  const commitSize = () => {
    if (draftW != null || draftH != null) {
      setOutSize(num(draftW ?? '', outW), num(draftH ?? '', outH))
    }
    setDraftW(null)
    setDraftH(null)
  }

  return (
    <div className="ce-tl-settings">
      <div className="ce-tl-set">
        <span className="ce-tl-set-name">
          {t('tset.length')}
          {over && (
            <button
              type="button"
              className="ce-tl-warn"
              title={t('tset.fit', { dur: content.toFixed(1) })}
              onClick={fitTimeline}
            >
              !
            </button>
          )}
        </span>
        <div className="ce-tl-set-row">
          <input
            className={`ce-tl-num${over ? ' is-over' : ''}`}
            type="text"
            inputMode="decimal"
            aria-label={t('tset.length')}
            title={t('tset.lengthTitle', { unit: unit === 'sec' ? t('tset.sec') : t('tset.frame') })}
            value={draft ?? fmtLen(len, unit)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitLen}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitLen()
              else if (e.key === 'Escape') setDraft(null)
            }}
          />
          <select
            className="ce-tl-sel"
            aria-label={t('tset.unitAria')}
            value={unit}
            onChange={(e) => switchUnit(e.target.value as LenUnit)}
          >
            <option value="sec">{t('tset.sec')}</option>
            <option value="frame">{t('tset.frame')}</option>
          </select>
        </div>
        {/* duration-change modifier. The tooltip carries the full GES wording. */}
        <label className="ce-tl-check" title={t('tset.scaleTitle')}>
          <input type="checkbox" checked={scale} onChange={(e) => setScale(e.target.checked)} />
          <span>{t('tset.scale')}</span>
        </label>
      </div>

      <div className="ce-tl-set">
        <span className="ce-tl-set-name">{t('tset.insert')}</span>
        <div className="ce-tl-set-row">
          <select
            className="ce-tl-sel"
            aria-label={t('tset.strategyAria')}
            title={t('tset.strategyTitle')}
            value={route.insertStrategy}
            onChange={(e) => setInsertStrategy(e.target.value as InsertStrategy)}
          >
            <option value="fixed">{t('tset.stFixed')}</option>
            <option value="even">{t('tset.stEven')}</option>
            <option value="distance">{t('tset.stDist')}</option>
          </select>
        </div>
      </div>

      <div className="ce-tl-set">
        <span className="ce-tl-set-name">{t('tset.fps')}</span>
        <div className="ce-tl-set-row">
          <select
            className="ce-tl-sel"
            aria-label={t('tset.fps')}
            title={t('tset.fpsTitle')}
            value={fps}
            onChange={(e) => setFps(Number(e.target.value))}
          >
            {/* imported routes may carry an fps outside the presets */}
            {!FPS_OPTIONS.includes(fps) && <option value={fps}>{fps}</option>}
            {FPS_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="ce-tl-set">
        <span className="ce-tl-set-name">{t('tset.size')}</span>
        <div className="ce-tl-set-row">
          <input
            className="ce-tl-num"
            type="text"
            inputMode="numeric"
            aria-label={t('tset.widthAria')}
            title={t('tset.sizeTitle', { dim: t('tset.widthAria') })}
            value={draftW ?? String(outW)}
            onChange={(e) => setDraftW(e.target.value)}
            onBlur={commitSize}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitSize()
              else if (e.key === 'Escape') {
                setDraftW(null)
                setDraftH(null)
              }
            }}
          />
          <span className="ce-tl-x">×</span>
          <input
            className="ce-tl-num"
            type="text"
            inputMode="numeric"
            aria-label={t('tset.heightAria')}
            title={t('tset.sizeTitle', { dim: t('tset.heightAria') })}
            value={draftH ?? String(outH)}
            onChange={(e) => setDraftH(e.target.value)}
            onBlur={commitSize}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitSize()
              else if (e.key === 'Escape') {
                setDraftW(null)
                setDraftH(null)
              }
            }}
          />
        </div>
      </div>

      {/* waypoint count — the old bundled Camera track's only real payload,
          now a read-only stat (keys are authored by clicking the map) */}
      <div className="ce-tl-set">
        <span className="ce-tl-set-name">{t('tset.keys')}</span>
        <div className="ce-tl-set-row">
          <span className="ce-tl-stat" title={t('tset.keysTitle')}>
            {route.waypoints.length}
          </span>
        </div>
      </div>
    </div>
  )
}
