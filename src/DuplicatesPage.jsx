import { useState } from 'react'
import { fetchStoredFile, thumbUrl } from './store'

// Finds exact copies: files with the same type and size are downloaded and
// compared byte for byte (SHA-256). Only files whose 3D file is stored can
// be checked. In each group one copy is kept (the one already in a project,
// with print logs, marked Sellable/Favorite, else the oldest) and the rest
// are ticked for deletion; tap a card to change which one stays.

const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

const score = (f) => [!!f.projectId, f.prints.length, !!f.sellable, !!f.fav, !!f.thumbV, -f.added]
const better = (a, b) => {
  const sa = score(a), sb = score(b)
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] > sb[i] ? a : b
  return a
}

async function hashOf(id) {
  const buf = await (await fetchStoredFile(id)).arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export default function DuplicatesPage({ files, projectName, onDelete }) {
  const [scan, setScan] = useState({ state: 'idle' }) // idle | running | done
  const [groups, setGroups] = useState([]) // [{ ids, keep }]
  const byId = new Map(files.map((f) => [f.id, f]))

  const run = async () => {
    const stored = files.filter((f) => f.hasFile)
    const bySize = new Map()
    for (const f of stored) {
      const k = `${f.ext}|${f.size}`
      bySize.set(k, [...(bySize.get(k) || []), f])
    }
    const candidates = [...bySize.values()].filter((g) => g.length > 1).flat()
    setScan({ state: 'running', done: 0, total: candidates.length, failed: 0 })
    const byHash = new Map()
    let failed = 0
    for (let i = 0; i < candidates.length; i++) {
      const f = candidates[i]
      try {
        const k = `${f.ext}|${f.size}|${await hashOf(f.id)}`
        byHash.set(k, [...(byHash.get(k) || []), f])
      } catch { failed++ }
      setScan({ state: 'running', done: i + 1, total: candidates.length, failed })
    }
    setGroups([...byHash.values()].filter((g) => g.length > 1)
      .map((g) => ({ ids: g.map((f) => f.id), keep: g.reduce(better).id })))
    setScan({ state: 'done', checked: candidates.length, skipped: files.length - stored.length, failed })
  }

  // drop files that were deleted elsewhere; a group needs 2+ files left
  const live = groups.map((g) => ({ ...g, ids: g.ids.filter((id) => byId.has(id)) }))
    .filter((g) => g.ids.length > 1)
    .map((g) => (byId.has(g.keep) ? g : { ...g, keep: g.ids[0] }))
  const extra = live.flatMap((g) => g.ids.filter((id) => id !== g.keep))
  const setKeep = (id) => setGroups((gs) => gs.map((g) => (g.ids.includes(id) ? { ...g, keep: id } : g)))

  const removeAll = () => {
    if (!window.confirm(`Delete ${extra.length} duplicate cop${extra.length === 1 ? 'y' : 'ies'} from Print Hub? One copy of each stays. Your Mac files are not touched.`)) return
    onDelete(extra)
  }

  return (
    <>
      <div className="ph-head-row" style={{ marginBottom: 6 }}>
        <h1 className="ph-h1">Duplicates</h1>
        {scan.state === 'done' && extra.length > 0 && (
          <button className="ph-btn-sm ph-danger" onClick={removeAll}>Delete {extra.length} duplicate{extra.length === 1 ? '' : 's'}</button>
        )}
      </div>
      <div className="ph-sub">Finds files that are exact copies of each other, even with different names. One copy of each is kept. Your Mac files are not touched.</div>

      {scan.state !== 'running' && (
        <div style={{ marginBottom: 20 }}>
          <button className="ph-btn-primary" onClick={run}>{scan.state === 'done' ? 'Scan again' : 'Scan for duplicates'}</button>
        </div>
      )}
      {scan.state === 'running' && (
        <div className="ph-dup-progress">
          <div className="ph-mono">Comparing {scan.done} of {scan.total} files…</div>
          <div className="ph-dup-bar"><span style={{ width: `${scan.total ? (scan.done / scan.total) * 100 : 100}%` }} /></div>
        </div>
      )}

      {scan.state === 'done' && (
        <div className="ph-muted13" style={{ marginBottom: 16 }}>
          {live.length ? `${live.length} group${live.length === 1 ? '' : 's'} of copies.` : 'No duplicates found.'}
          {scan.skipped > 0 && ` ${scan.skipped} file${scan.skipped === 1 ? ' has' : 's have'} no stored file and couldn't be checked.`}
          {scan.failed > 0 && ` ${scan.failed} couldn't be downloaded to compare.`}
          {live.length > 0 && ' Tap a card to keep that one instead.'}
        </div>
      )}

      <div className="ph-dup-groups">
        {live.map((g) => (
          <section key={g.ids.join()} className="ph-dup-group">
            <div className="ph-label">{g.ids.length} copies · {byId.get(g.ids[0]).ext.toUpperCase()}</div>
            <div className="ph-grid">
              {g.ids.map((id) => {
                const f = byId.get(id)
                const keep = id === g.keep
                return (
                  <button key={id} className={'ph-card ph-dup-card' + (keep ? ' is-keep' : ' is-gone')} onClick={() => setKeep(id)}
                    aria-label={`${f.name}: ${keep ? 'keeping' : 'will be deleted'}`}>
                    <div className={'ph-thumb' + (f.thumbV ? ' has-img' : '')}>
                      {f.thumbV ? <img className="ph-thumb-img" src={thumbUrl(f.id, f.thumbV)} alt="" loading="lazy" /> : <span className="ph-badge">{f.ext.toUpperCase()}</span>}
                      <span className={'ph-dup-tag' + (keep ? ' keep' : '')}>{keep ? 'Keep' : 'Delete'}</span>
                    </div>
                    <div className="ph-card-body">
                      <div className="ph-card-name">{f.name}</div>
                      <div className="ph-card-date ph-mono">{fmtDate(f.modified || f.added)}</div>
                      <div className="ph-card-meta"><span className="ph-ellipsis">{projectName(f.projectId) || 'Unsorted'}</span>{f.prints.length > 0 && <span>{f.prints.length} print{f.prints.length === 1 ? '' : 's'}</span>}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  )
}
