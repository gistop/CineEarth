import { useState } from 'react'
import { useUI } from '../store/ui'
import { useRoute } from '../features/route/routeStore'
import { timelineDuration, totalDuration } from '../features/route/pathMath'

/** GES-style fixed fps presets */
const FPS_OPTIONS = [24, 25, 30, 50, 60]

/** timeline unit — seconds or frames (frames convert through the fps) */
type LenUnit = 'sec' | 'frame'

/**
 * Project settings column — the free strip at the right of the expanded
 * timeline's lane grid (level with the track rows): 长度 (秒/帧) · 帧率 · 尺寸.
 * Rendered inside .ce-tracks, so it hides with the tracks when collapsed.
 *
 * 长度 (route.timelineLen) and 帧率 (route.fps) are wired to the store; 尺寸 is
 * still a UI mock until the export pipeline grows its own settings.
 */
export default function TimelineSettings() {
  const route = useRoute((s) => s.route)
  const setFps = useRoute((s) => s.setFps)
  const setTimelineLen = useRoute((s) => s.setTimelineLen)
  const fitTimeline = useRoute((s) => s.fitTimeline)
  const unit = useUI((s) => s.tlUnit)
  const setTlUnit = useUI((s) => s.setTlUnit)

  /* the length is a DRAFT, committed on Enter / blur: committing per keystroke
     would re-time the keys on every intermediate value (1 → 12 → 120…) */
  const [draft, setDraft] = useState<string | null>(null)
  /* duration-change modifier (GES "将现有关键帧的时长调节到新时长") — a sticky
     flag, safe precisely because the length only commits on Enter / blur */
  const [scale, setScale] = useState(false)
  /* output size — UI only for now */
  const [w, setW] = useState(1920)
  const [h, setH] = useState(1080)

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

  return (
    <div className="ce-tl-settings">
      <div className="ce-tl-set">
        <span className="ce-tl-set-name">
          长度
          {over && (
            <button
              type="button"
              className="ce-tl-warn"
              title={`内容总长 ${content.toFixed(1)}s — 有关键帧在时长之外（数据已保留）· 点击适配内容总长`}
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
            aria-label="长度"
            title={`时间轴长度（${unit === 'sec' ? '秒' : '帧'}）— 回车确认`}
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
            aria-label="长度单位"
            value={unit}
            onChange={(e) => switchUnit(e.target.value as LenUnit)}
          >
            <option value="sec">秒</option>
            <option value="frame">帧</option>
          </select>
        </div>
        {/* duration-change modifier. Label is 2 chars so it fits the narrow
            strip — the tooltip carries the full GES wording. */}
        <label className="ce-tl-check" title="改变时长时，等比缩放现有关键帧的时长">
          <input type="checkbox" checked={scale} onChange={(e) => setScale(e.target.checked)} />
          <span>缩放</span>
        </label>
      </div>

      <div className="ce-tl-set">
        <span className="ce-tl-set-name">帧率</span>
        <div className="ce-tl-set-row">
          <select
            className="ce-tl-sel"
            aria-label="帧率"
            title="帧率 (fps)"
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
        <span className="ce-tl-set-name">尺寸</span>
        <div className="ce-tl-set-row">
          <input
            className="ce-tl-num"
            type="text"
            inputMode="numeric"
            aria-label="宽度"
            title="输出宽度 (px)"
            value={w}
            onChange={(e) => setW(num(e.target.value, w))}
          />
          <span className="ce-tl-x">×</span>
          <input
            className="ce-tl-num"
            type="text"
            inputMode="numeric"
            aria-label="高度"
            title="输出高度 (px)"
            value={h}
            onChange={(e) => setH(num(e.target.value, h))}
          />
        </div>
      </div>
    </div>
  )
}
