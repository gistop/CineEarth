// 机位 (shot) accordion header rows for the timeline's lane stack.
// One header per shot; the ACTIVE shot's channel rows (7 attributes + Growth)
// render right below it in TimelineTracks when it is EXPANDED.
//
// "Active" (editing semantics — the shot the whole app follows) and
// "expanded" (visual only) are DECOUPLED: the active shot can be collapsed
// (all headers = a pure storyboard view); clicking the active header toggles
// it, clicking another header switches & expands.
//
// ALIGNMENT: the row mirrors .ce-track's geometry (same --ce-row-grid columns,
// gap and key-room padding), so it is just another row in the same stack —
// the ruler alignment holds without any new measurement.
//
// The lane cell carries a dim duration block sized against the LONGEST shot:
// a length comparison between 机位, not a storyboard (shot sequencing on a
// global timeline is a later feature — this block is where it will live).

import { useState } from 'react'
import { useRoute, type Shot } from '../features/route/routeStore'
import { timelineDuration } from '../features/route/pathMath'

type ShotTrackProps = {
  shot: Shot
  /** editing semantics — highlights the header of the shot the app follows */
  active: boolean
  /** visual only — the active shot can be COLLAPSED (its channel rows hidden)
   *  while still being the one every consumer edits: 点头行 = toggle 展开 */
  expanded: boolean
  /** the longest shot's duration — blocks are sized relative to it */
  maxDur: number
  /** click the row: active → toggle expand/collapse, else → switch & expand */
  onToggle: () => void
}

export default function ShotTrack({ shot, active, expanded, maxDur, onToggle }: ShotTrackProps) {
  const removeShot = useRoute((s) => s.removeShot)
  const renameShot = useRoute((s) => s.renameShot)
  const deletable = useRoute((s) => s.shots.length > 1)

  /* inline rename — dblclick the name, Enter/blur commits, Esc cancels */
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const dur = timelineDuration(shot.route)
  /* 4% floor so an empty shot still shows a visible stub */
  const spanPct = Math.max(4, (dur / maxDur) * 100)

  return (
    <div
      className={`ce-shot${active ? ' is-active' : ''}`}
      role="button"
      tabIndex={0}
      title={`时长 ${dur.toFixed(1)}s · 双击名字重命名${
        active ? (expanded ? ' · 点击收起' : ' · 点击展开') : ' · 点击切换编辑'
      }`}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onToggle()
      }}
    >
      <div className="ce-shot-side">
        <span
          className={`ce-shot-caret${expanded ? ' is-open' : ''}`}
          aria-hidden="true"
        >▸</span>
        {editing ? (
          <input
            className="ce-shot-rename"
            value={draft}
            autoFocus
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={() => {
              renameShot(shot.id, draft.trim() || shot.name)
              setEditing(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              else if (e.key === 'Escape') setEditing(false)
            }}
          />
        ) : (
          <span
            className="ce-shot-name"
            onDoubleClick={(e) => {
              e.stopPropagation()
              setDraft(shot.name)
              setEditing(true)
            }}
          >
            {shot.name}
          </span>
        )}
        <span className="ce-shot-dur">{dur.toFixed(1)}s</span>
        {deletable && (
          <button
            type="button"
            className="ce-shot-del"
            title="删除机位"
            aria-label={`删除 ${shot.name}`}
            onClick={(e) => {
              e.stopPropagation()
              removeShot(shot.id)
            }}
          >
            ×
          </button>
        )}
      </div>
      <div className="ce-shot-lane">
        <span className="ce-shot-span" style={{ width: `${spanPct}%` }} />
      </div>
    </div>
  )
}

/** the "＋ 新建机位" row — same grid so it indents with the stack.
 *  Controlled: the parent force-expands the new shot (leaving the collapsed
 *  storyboard view would look like "nothing happened"). */
export function ShotAddRow({ onAdd }: { onAdd: () => void }) {
  return (
    <div
      className="ce-shot ce-shot-add"
      role="button"
      tabIndex={0}
      title="新建机位"
      onClick={onAdd}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onAdd()
      }}
    >
      <div className="ce-shot-side">
        <span className="ce-shot-caret" aria-hidden="true">＋</span>
        <span className="ce-shot-name">新建机位</span>
      </div>
      <div className="ce-shot-lane" />
    </div>
  )
}
