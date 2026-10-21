// Shared per-channel widgets for the timeline's lane stack, usable by BOTH
// the camera shot rows (TimelineTracks) and the asset animation rows
// (AssetAnimTracks) — the two stacks must read as one system, so label /
// insert-keyframe visuals and semantics live here once.

import type { InsertGroup } from '../features/route/types'
import { useT } from '../i18n'

/** channel-row label. Plain text when it has no toggle (read-only rows /
 *  rows without a detail view); a BUTTON when soloable: ONE click selects
 *  the row into the detail pane (value-mapped curve over the lane), click
 *  again = clear. The label column itself never changes — no row is ever
 *  hidden. Generic over the id type so asset rows ('growth' | 'lift') reuse
 *  it without importing the camera TrackId union. */
export function SoloLabel<T extends string>({
  id,
  label,
  value,
  solo,
  onToggle,
}: {
  id: T
  label: string
  value?: string
  /** the row selection (only needed when the label is a toggle) */
  solo?: T | null
  onToggle?: (id: T) => void
}) {
  const t = useT()
  if (!onToggle) {
    return (
      <div className="ce-track-label" title={label}>
        <span className="ce-track-name">{label}</span>
        {value != null && <span className="ce-track-value">{value}</span>}
      </div>
    )
  }
  return (
    <button
      type="button"
      className={`ce-track-label${solo === id ? ' is-solo' : ''}`}
      onClick={() => onToggle(id)}
      title={t('w.soloTitle', { label })}
    >
      <span className="ce-track-name">{label}</span>
      {value != null && <span className="ce-track-value">{value}</span>}
    </button>
  )
}

/** insert-keyframe button (GES-style attribute row). Renders as a hollow
 *  keyframe diamond that fills on hover. Rows without a key action may
 *  still omit onInsert (renders DISABLED). `group` tags the button with its
 *  insert-group: lon/lat/height share 'position', and CSS (:has) lights the
 *  WHOLE group on hover — one click keys all three, so the hover must read
 *  as one group action. */
export function InsertKeyBtn({
  label,
  title,
  onInsert,
  group,
}: {
  label: string
  title?: string
  onInsert?: () => void
  group?: InsertGroup
}) {
  const t = useT()
  return (
    <button
      type="button"
      className="ce-kf-add"
      data-group={group}
      title={title ?? t('w.insertTitle', { label })}
      aria-label={t('w.insertAria', { label })}
      disabled={!onInsert}
      onClick={onInsert}
    >
      <span className="ce-kf-dot" aria-hidden="true" />
    </button>
  )
}
