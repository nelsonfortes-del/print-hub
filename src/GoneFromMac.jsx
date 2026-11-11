import { useMemo, useState } from 'react'
import { thumbUrl } from './store'

// The other direction of Mac cleanup: files deleted on the Mac. The Mac sends
// its list of 3D files (name and size) with one Terminal command; hub files
// with no match are listed here to review and delete from the hub.

const fmtDate = (t) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function GoneFromMac({ files, macCheck, projectName, onDelete }) {
  const [copied, setCopied] = useState(false)
  const [skip, setSkip] = useState(() => new Set()) // files to keep
  const cmd = `bash <(curl -fsSL ${window.location.origin}/api/mac-inventory-script)`
  const gone = useMemo(() => {
    const ids = new Set(macCheck?.gone || [])
    return files.filter((f) => ids.has(f.id)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  }, [files, macCheck])
  const picked = gone.filter((f) => !skip.has(f.id))
  const toggle = (id) => setSkip((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const suspicious = macCheck && (macCheck.count === 0 || gone.length > files.length * 0.8)

  const remove = () => {
    if (!picked.length) return
    if (!window.confirm(`Delete ${picked.length} file${picked.length === 1 ? '' : 's'} from Print Hub? They're already gone from your Mac, so nothing on the Mac changes.`)) return
    onDelete(picked.map((f) => f.id))
    setSkip(new Set())
  }

  return (
    <section className="ph-gone" aria-labelledby="gone-h">
      <h2 className="ph-h2" id="gone-h">Gone from your Mac</h2>
      <div className="ph-sub">Deleted files on your Mac? Find them here and delete them from the hub too.</div>
      <ol className="ph-steps">
        <li>
          Open <strong>Terminal</strong>, paste this, and press Return. It sends the names and sizes of your Mac's 3D files, nothing else.
          <div className="ph-cmd-row">
            <code className="ph-code ph-cmd">{cmd}</code>
            <button className="ph-btn-primary" onClick={() => navigator.clipboard?.writeText(cmd).then(() => setCopied(true)).catch(() => {})}>
              {copied ? 'Copied' : 'Copy command'}
            </button>
          </div>
        </li>
        <li>When it says Done: <button className="ph-btn-outline" onClick={() => window.location.reload()}>Show results</button></li>
      </ol>

      {!macCheck ? (
        <div className="ph-muted13">Not checked yet.</div>
      ) : (
        <>
          <div className="ph-gone-summary">
            Checked {fmtDate(macCheck.at)}: {macCheck.count} 3D file{macCheck.count === 1 ? '' : 's'} on your Mac.{' '}
            {gone.length === 0 ? 'Every hub file is still on your Mac.' : `${gone.length} hub file${gone.length === 1 ? ' isn\'t' : 's aren\'t'} on your Mac anymore.`}
          </div>
          {suspicious && (
            <div className="ph-banner">
              {macCheck.count === 0
                ? 'Your Mac sent an empty list. Terminal probably isn\'t allowed into your folders: System Settings → Privacy & Security → Full Disk Access → turn on Terminal, then run the command again.'
                : 'Most of the hub looks missing from your Mac. If your files live on an external drive or somewhere outside your home folder and iCloud Drive, the check couldn\'t see them. Look carefully before deleting.'}
            </div>
          )}
          {gone.length > 0 && (
            <>
              <div className="ph-gone-bar">
                <span>{picked.length} of {gone.length} picked. Untick any you want to keep.</span>
                <button className="ph-btn-sm" onClick={() => setSkip(new Set())}>Pick all</button>
                <button className="ph-btn-sm" onClick={() => setSkip(new Set(gone.map((f) => f.id)))}>Pick none</button>
                <div style={{ flex: 1 }} />
                <button className="ph-btn-sm ph-danger" disabled={!picked.length} onClick={remove}>Delete {picked.length} from the hub</button>
              </div>
              <ul className="ph-gone-list">
                {gone.map((f) => (
                  <li key={f.id}>
                    <label className={'ph-gone-row' + (skip.has(f.id) ? ' is-kept' : '')}>
                      <input type="checkbox" checked={!skip.has(f.id)} onChange={() => toggle(f.id)} aria-label={`Delete ${f.name} from the hub`} />
                      <span className="ph-gone-thumb">{f.thumbV ? <img src={thumbUrl(f.id, f.thumbV)} alt="" loading="lazy" /> : f.ext.toUpperCase()}</span>
                      <span className="ph-gone-name">{f.title || f.name}<small>{f.name}.{f.ext}</small></span>
                      <span className="ph-gone-where">{projectName(f.projectId) || 'Unsorted'}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  )
}
