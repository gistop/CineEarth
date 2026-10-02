// Ion settings panel — rendered at the bottom of the Layers tab (left drawer).
// Terrain works OUT OF THE BOX on CesiumJS's bundled evaluation token;
// pasting a personal token (verified, localStorage-only) lifts the shared quota.
// A user token never leaves the browser except for direct calls to ion.cesium.com.

import { useEffect, useState } from 'react'
import { useIon } from './ionTokenStore'
import { saveIonToken, clearIonToken, syncTerrain } from './ionTerrain'

const STATUS_LABEL: Record<string, string> = {
  none: 'No token — terrain on the shared default',
  checking: 'Verifying your token…',
  valid: 'Token valid — terrain on your quota',
  invalid: 'Token invalid — still on shared default',
  unknown: 'Could not verify — still on shared default',
}

export default function IonSettingsPanel() {
  const token = useIon((s) => s.token)
  const status = useIon((s) => s.status)
  const terrainEnabled = useIon((s) => s.terrainEnabled)
  const setTerrainEnabled = useIon((s) => s.setTerrainEnabled)

  const [draft, setDraft] = useState(token)
  useEffect(() => setDraft(token), [token])

  const dirty = draft.trim() !== token

  return (
    <section className="ce-ion" aria-label="Cesium ion settings">
      <p className="ce-hint">Cesium ion token — world terrain</p>

      <div className="ce-ion-row">
        <input
          className="ce-ion-input"
          type="password"
          value={draft}
          placeholder="Paste your ion token (optional)"
          spellCheck={false}
          autoComplete="off"
          aria-label="Cesium ion token"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void saveIonToken(draft)
          }}
        />
        <span className={`ce-ion-dot is-${status}`} title={STATUS_LABEL[status]} />
      </div>

      <div className="ce-ion-actions">
        <button
          type="button"
          className="ce-ion-btn"
          disabled={!dirty && status !== 'unknown'}
          onClick={() => void saveIonToken(draft)}
        >
          Save &amp; verify
        </button>
        {token !== '' && (
          <button type="button" className="ce-ion-btn is-ghost" onClick={() => void clearIonToken()}>
            Clear
          </button>
        )}
      </div>

      <p className={`ce-ion-status is-${status}`}>{STATUS_LABEL[status]}</p>

      <label className="ce-ion-terrain">
        <input
          type="checkbox"
          checked={terrainEnabled}
          onChange={(e) => {
            setTerrainEnabled(e.target.checked)
            void syncTerrain()
          }}
        />
        <span className="ce-row-name">World terrain</span>
        <span className="ce-row-val">{terrainEnabled ? 'on' : 'off'}</span>
      </label>

      <p className="ce-ion-note">
        Terrain runs on Cesium&rsquo;s shared evaluation token until you add your own. A personal
        token is stored only in this browser (localStorage) — never sent to any CineEarth server —
        and is used directly with <span className="ce-ion-code">ion.cesium.com</span>. Free token:{' '}
        <a href="https://ion.cesium.com/tokens" target="_blank" rel="noreferrer">
          ion.cesium.com/tokens
        </a>
      </p>
    </section>
  )
}
