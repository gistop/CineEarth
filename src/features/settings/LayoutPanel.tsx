// Props tab block — 布局模式: 挤压 / 覆盖. A layout toggle backed by the ui
// store (default: 挤压). Both modes keep the OUTPUT aspect on every monitor;
// the mode only decides whether the chrome floats above the stage (overlay:
// 窗口即画幅) or takes its space out of it (push: 挤压窗口，不挤压画幅 —
// monitors letterbox to the output ratio; the editor window goes GES-style
// with a darkened surround outside the frame).

import { useUI, type LayoutMode } from '../../store/ui'

const MODES: { id: LayoutMode; label: string; hint: string }[] = [
  {
    id: 'push',
    label: '挤压',
    hint: '挤压：面板占用真实空间、压缩地图区域；监视窗保持输出画幅（等比居中），编辑窗为 GES 式 —— 画幅框外暗显超范围（仍可见、仍可交互）',
  },
  {
    id: 'overlay',
    label: '覆盖',
    hint: '覆盖：面板浮在地图上，地图始终铺满窗口 —— 可见区域最大，但面板会遮住画面',
  },
]

export default function LayoutPanel() {
  const layoutMode = useUI((s) => s.layoutMode)
  const setLayoutMode = useUI((s) => s.setLayoutMode)
  const active = MODES.find((m) => m.id === layoutMode)

  return (
    <section className="ce-stack" aria-label="布局模式">
      <p className="ce-hint">布局模式 — 挤压只改变窗口，画幅保持输出比例</p>
      <div className="ce-seg" role="radiogroup" aria-label="布局模式">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={layoutMode === m.id}
            className={`ce-seg-btn${layoutMode === m.id ? ' is-on' : ''}`}
            title={m.hint}
            onClick={() => setLayoutMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {active && <p className="ce-hint">{active.hint}</p>}
    </section>
  )
}
