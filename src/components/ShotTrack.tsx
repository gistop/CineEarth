// 机位 (shot) accordion header rows for the timeline's lane stack.
// One header per shot; the ACTIVE shot's channel rows (7 attributes + Growth)
// render right below it in TimelineTracks when it is EXPANDED.
//
// Two entries, two intents: the CARET (a real button with a wide hit strip)
// alone folds/unfolds the detail rows — pure view; the header BODY activates
// the shot (setActiveShot, semantics unchanged from before the split).
//
// "Active" (editing semantics — the shot the whole app follows) and
// "expanded" (visual only) are DECOUPLED: the active shot can be collapsed
// (all headers = a pure storyboard view).
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
   *  while still being the one every consumer edits: 点三角 = 展开/收拢 */
  expanded: boolean
  /** the longest shot's duration — blocks are sized relative to it */
  maxDur: number
  /** caret click — fold/unfold the detail rows (pure view, the ONLY entry) */
  onToggleExpand: () => void
  /** header-body click — activate the shot (setActiveShot, semantics unchanged) */
  onActivate: () => void
}

export default function ShotTrack({ shot, active, expanded, maxDur, onToggleExpand, onActivate }: ShotTrackProps) {
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
      title={`时长 ${dur.toFixed(1)}s · 双击名字重命名 · 点击切换编辑该机位（三角 = 展开或收起详细轨道）· 拖到主输出轨道 = 在落点添加该机位的镜头段`}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onActivate()
      }}
      /* drag the 机位 header ONTO the 主输出 lane = create a segment at the
         (snapped) drop point. HTML5 DnD coexists with the click activation —
         a drag never fires click. Disabled while renaming (text selection). */
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-ce-shot', shot.id)
        e.dataTransfer.effectAllowed = 'copy'
      }}
    >
      <div className="ce-shot-side">
        <button
          type="button"
          className={`ce-shot-caret${expanded ? ' is-open' : ''}`}
          title={expanded ? '收起详细轨道' : '展开详细轨道'}
          aria-label={`${expanded ? '收起' : '展开'} ${shot.name} 的详细轨道`}
          aria-expanded={expanded}
          onClick={(e) => {
            e.stopPropagation()
            onToggleExpand()
          }}
          /* Enter on the focused caret must fold, not fall through to the
             row's onKeyDown (which activates) via bubbling */
          onKeyDown={(e) => e.stopPropagation()}
        >▸</button>
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
