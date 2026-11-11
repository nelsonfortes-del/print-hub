import { linkAppUrl } from './store'

// Trash (deleted files stay 30 days) and the Mac link page (setup + status).

const TRASH_DAYS = 30
const DAY = 86400000
const fmtSize = (b) => (b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB')
const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`
  return `${Math.round(h / 24)} days ago`
}

// ok: checked in within 5 minutes; warn: Mac asleep/off or a problem; off: never set up
export function linkHealth(link) {
  if (!link) return { tone: 'off', text: 'Not set up yet' }
  if (link.status === 'denied') return { tone: 'bad', text: "Your Mac blocked access to the inbox folder" }
  if (link.status === 'missing') return { tone: 'bad', text: "The inbox folder wasn't found on your Mac" }
  if (Date.now() - link.seen > 5 * 60000) return { tone: 'warn', text: `Last seen ${ago(link.seen)}. Your Mac is probably asleep or off.` }
  return { tone: 'ok', text: `Connected · last check ${ago(link.seen)}` }
}

export function TrashPage({ trash, onRestore, onDelete, onEmpty }) {
  return (
    <>
      <div className="ph-head-row" style={{ marginBottom: 6 }}>
        <h1 className="ph-h1">Trash</h1>
        {trash.length > 0 && <button className="ph-btn-sm ph-danger" onClick={onEmpty}>Empty trash</button>}
      </div>
      <div className="ph-sub">Deleted files wait here for {TRASH_DAYS} days, then go for good. Files from your Mac inbox sit in its _trash folder until then.</div>
      {trash.length === 0 ? (
        <div className="ph-empty">
          <div className="ph-empty-title">Trash is empty</div>
          <div>Deleted files show up here.</div>
        </div>
      ) : (
        <div className="ph-trash-list">
          {trash.map((f) => {
            const left = Math.max(0, Math.ceil((f.trashedAt + TRASH_DAYS * DAY - Date.now()) / DAY))
            return (
              <div key={f.id} className="ph-trash-row">
                <div className="ph-trash-main">
                  <div className="ph-trash-name">{f.name}<span className="ph-trash-ext">.{f.ext}</span></div>
                  <div className="ph-mono ph-meta">
                    {fmtSize(f.size)} · deleted {ago(f.trashedAt)} · {left} day{left === 1 ? '' : 's'} left{f.inboxPath ? ' · on Mac' : ''}
                  </div>
                </div>
                <button className="ph-btn-outline" onClick={() => onRestore([f.id])}>Restore</button>
                <button className="ph-x" aria-label={`Delete ${f.name} for good`} title="Delete for good" onClick={() => onDelete([f.id])}>×</button>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

export function MacLinkPage({ link, onSync }) {
  const health = linkHealth(link)
  return (
    <>
      <div className="ph-head-row" style={{ marginBottom: 6 }}>
        <h1 className="ph-h1">Mac link</h1>
        {link && <button className="ph-btn-primary" onClick={onSync} disabled={link.scanPending}>{link.scanPending ? 'Syncing…' : 'Sync now'}</button>}
      </div>
      <div className="ph-sub">A small app on your Mac connects your iCloud 3D inbox to Print Hub. It checks every minute while the Mac is on.</div>

      <div className={'ph-link-status is-' + health.tone}>
        <span className={'ph-link-dot is-' + health.tone} />
        <div>
          <div className="ph-link-status-title">{health.text}</div>
          {link?.inbox && <div className="ph-mono ph-meta">Inbox folder: {link.inbox}</div>}
        </div>
      </div>

      <div className="ph-link-grid">
        <div className="ph-link-card">
          <div className="ph-section-title">What it does</div>
          <ul className="ph-link-list">
            <li>New <strong>STL, 3MF, OBJ</strong> files in the inbox show up here. Other files are left alone.</li>
            <li>Files already in Print Hub (same name and size) are skipped.</li>
            <li>Delete here → the Mac file moves into the inbox's <strong>_trash</strong> folder.</li>
            <li>Restore here → it moves back.</li>
            <li>Empty trash (or after 30 days) → it goes to your Mac's Trash.</li>
          </ul>
        </div>

        <div className="ph-link-card">
          <div className="ph-section-title">{link ? 'Set up again or turn off' : 'Set it up (once, about 2 minutes)'}</div>
          <ol className="ph-link-list ph-link-steps">
            <li><a className="ph-btn-primary ph-btn-link" href={linkAppUrl} download>Download Print Hub Link</a></li>
            <li>Open <strong>Print Hub Link Setup</strong> from Downloads. Your Mac will say it can't check it.</li>
            <li>Go to <strong>System Settings → Privacy &amp; Security</strong>, scroll down, click <strong>Open Anyway</strong>.</li>
            <li>Pick your 3D inbox folder in iCloud Drive.</li>
            <li>If your Mac asks to let Print Hub Link see iCloud Drive, click <strong>Allow</strong>.</li>
          </ol>
          {link && <div className="ph-muted13">Open the setup again any time to pick another folder or turn the link off.</div>}
        </div>
      </div>
    </>
  )
}
