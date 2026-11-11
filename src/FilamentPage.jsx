import { useState } from 'react'

// Filament inventory: one row per spool. Changes save a moment after you
// stop typing (the same way Printers and Materials do).

export const LOW_GRAMS = 150
// Cost per gram of a spool, or null when its cost isn't filled in.
// The Shop's cost calculator reads this.
export const costPerGram = (s) => (Number(s.cost) > 0 && s.spoolGrams > 0 ? Number(s.cost) / s.spoolGrams : null)

const money = (n) => `$${n.toFixed(2)}`
const kg = (g) => (g >= 1000 ? `${(g / 1000).toFixed(1)} kg` : `${g} g`)

export default function FilamentPage({ spools, materials, onEdit, onAdd, onRemove }) {
  const total = spools.reduce((a, s) => a + (s.gramsLeft || 0), 0)
  const low = spools.filter((s) => s.gramsLeft < LOW_GRAMS).length
  const matNames = [...new Set(['PLA', 'PETG', 'TPU', 'ABS', 'ASA', ...materials.map((m) => m.name).filter(Boolean), ...spools.map((s) => s.material)])]
  const sorted = [...spools].sort((a, b) => a.material.localeCompare(b.material) || a.colorName.localeCompare(b.colorName))

  return (
    <>
      <div className="ph-head-row" style={{ marginBottom: 6 }}>
        <h1 className="ph-h1">Filament</h1>
        <button className="ph-btn-primary" onClick={onAdd}>Add spool</button>
      </div>
      <div className="ph-sub">
        {spools.length
          ? <>{spools.length} spool{spools.length === 1 ? '' : 's'} · {kg(total)} on hand{low > 0 && <> · <span className="ph-low-text">{low} low</span></>}</>
          : 'What you have on the shelf. Changes save automatically.'}
      </div>

      {spools.length === 0 ? (
        <div className="ph-empty">
          <div className="ph-empty-title">No spools yet</div>
          <div>Add each spool once: brand, material, color, grams left and what it cost.</div>
        </div>
      ) : (
        <div className="ph-spools">
          {sorted.map((s) => <SpoolRow key={s.id} s={s} matNames={matNames} onEdit={onEdit} onRemove={onRemove} />)}
        </div>
      )}
    </>
  )
}

function SpoolRow({ s, matNames, onEdit, onRemove }) {
  const [used, setUsed] = useState('')
  const set = (key) => (e) => onEdit('spools', s.id, key, e.target.value)
  const setNum = (key) => (e) => onEdit('spools', s.id, key, e.target.value === '' ? '' : Math.max(0, Math.round(Number(e.target.value) || 0)))
  const pct = Math.max(0, Math.min(100, (s.gramsLeft / (s.spoolGrams || 1000)) * 100))
  const cpg = costPerGram(s)
  const isLow = s.gramsLeft < LOW_GRAMS
  const applyUsed = () => {
    const g = Math.round(Number(used))
    if (g > 0) onEdit('spools', s.id, 'gramsLeft', Math.max(0, (s.gramsLeft || 0) - g))
    setUsed('')
  }

  return (
    <div className={'ph-spool' + (isLow ? ' is-low' : '')}>
      <label className="ph-swatch" style={{ background: s.colorHex }} title="Pick the color">
        <input type="color" value={s.colorHex} onChange={set('colorHex')} aria-label="Spool color" />
      </label>
      <div className="ph-spool-main">
        <div className="ph-spool-line">
          <input className="ph-input ph-spool-color" value={s.colorName} placeholder="Color, e.g. Matte black" onChange={set('colorName')} aria-label="Color name" />
          <select className="ph-input ph-spool-mat" value={s.material} onChange={set('material')} aria-label="Material">
            {matNames.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <input className="ph-input ph-spool-brand" value={s.brand} placeholder="Brand" onChange={set('brand')} aria-label="Brand" />
        </div>
        <div className="ph-spool-line">
          <div className="ph-spool-bar" aria-hidden="true"><span style={{ width: `${pct}%`, background: s.colorHex }} /></div>
          <label className="ph-spool-num">
            <input className="ph-input ph-mono" inputMode="numeric" value={s.gramsLeft} onChange={setNum('gramsLeft')} aria-label="Grams left" />
            <span>of</span>
            <input className="ph-input ph-mono" inputMode="numeric" value={s.spoolGrams} onChange={setNum('spoolGrams')} aria-label="Full spool grams" />
            <span>g</span>
          </label>
          {isLow && <span className="ph-low-tag">Low</span>}
        </div>
        <div className="ph-spool-line">
          <label className="ph-spool-num">
            <span>Used</span>
            <input className="ph-input ph-mono" inputMode="numeric" value={used} placeholder="0" onChange={(e) => setUsed(e.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && applyUsed()} aria-label="Grams used" />
            <span>g</span>
            <button className="ph-btn-sm" disabled={!used} onClick={applyUsed}>Subtract</button>
          </label>
          <label className="ph-spool-num">
            <span>$</span>
            <input className="ph-input ph-mono" inputMode="decimal" value={s.cost} placeholder="0.00" onChange={set('cost')} aria-label="Cost per spool" />
            <span>per spool</span>
          </label>
          <span className="ph-mono ph-spool-cpg">{cpg != null ? `${money(cpg * 1000)}/kg · ${(cpg * 100).toFixed(1)}¢/g` : 'add a cost'}</span>
        </div>
        <input className="ph-input ph-spool-notes" value={s.notes} placeholder="Notes (dry box, temps that worked…)" onChange={set('notes')} aria-label="Notes" />
      </div>
      <button className="ph-x ph-spool-x" aria-label="Remove spool" title="Remove spool"
        onClick={() => window.confirm(`Remove the ${s.colorName || 'unnamed'} ${s.material} spool?`) && onRemove('spools', s.id)}>×</button>
    </div>
  )
}
