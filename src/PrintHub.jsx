import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './printhub.css'
import { matchProject, normalize } from './autosort'
import { grabDropped, fromPicker, expand } from './collect'
import {
  loadAll, saveFile, deleteFile, saveProfile, deleteProfile, uploadFile, downloadUrl,
} from './store'

// Print Hub: a catalog of 3D-print files with a print log per file, plus
// reusable printer and material profiles. Everything is saved to the
// database; the 3D files themselves go to online file storage, so every
// device sees the same library.

const CATS = ['Work', 'Personal']
const STATUSES = ['Idea', 'In design', 'Ready to print', 'In progress', 'Works', 'Done', 'Stalled']
const STATUS_COLOR = {
  Idea: '#5b7194', 'In design': '#9aadc9', 'Ready to print': '#5b9bff', 'In progress': '#f0b44c',
  Works: '#4cc38a', Done: '#4cc38a', Stalled: '#ff8370',
}
const EXTS = ['stl', '3mf', 'obj', 'step', 'stp', 'gcode', 'gco']
const SUPPORTS = ['None', 'Buildplate only', 'Everywhere']
const BLUE = 'var(--accent-text)'
const OK = '#4cc38a'
const FAIL = '#ff8370'
const GREY = '#5b7194'
const DRAFT_KEY = 'printhub.lastDraft'

const fmtSize = (b) => (b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB')
const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const segStyle = (active, kind) => {
  if (!active) return undefined
  const c = kind === 'fail' ? '#c4432c' : kind === 'ok' ? '#23804f' : 'var(--accent)'
  return { background: c, borderColor: c, color: '#fff' }
}
const status = (f) => {
  const last = f.prints[0]
  if (!last) return { label: 'Not printed', dot: GREY }
  return last.result === 'Success' ? { label: 'Printed', dot: OK } : { label: 'Failed', dot: FAIL }
}
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
const fetchLibrary = () => loadAll()
const readDraft = () => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null') } catch { return null } }

export default function PrintHub() {
  const [load, setLoad] = useState({ state: 'loading', error: '' }) // loading | ready | error
  const [storage, setStorage] = useState('none')
  const [files, setFiles] = useState([])
  const [printers, setPrinters] = useState([])
  const [materials, setMaterials] = useState([])
  const [projects, setProjects] = useState([])
  const [draft, setDraft] = useState(() => ({ printer: '', material: 'PLA', nozzle: 215, bed: 60, supports: 'None', result: 'Success', ...(readDraft() || {}) }))
  const [uploading, setUploading] = useState({}) // file id -> percent

  const [view, setView] = useState('catalog')
  const [cat, setCat] = useState('All')
  const [tag, setTag] = useState(null)
  const [project, setProject] = useState(null) // project id filter
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [toast, setToast] = useState(null)

  const fileRef = useRef(null)
  const folderRef = useRef(null)
  const toastTimer = useRef(null)
  const filesRef = useRef(files)
  useEffect(() => { filesRef.current = files }, [files])

  const showToast = useCallback((msg) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2600)
  }, [])
  const saveFailed = useCallback((e) => showToast(e?.message ? `Couldn't save: ${e.message}` : "Couldn't save. Check your connection."), [showToast])

  const apply = useCallback((data) => {
    setStorage(data.storage)
    setFiles(data.files)
    setPrinters(data.printers)
    setMaterials(data.materials)
    setProjects(data.projects || [])
    setDraft((d) => (data.printers.some((p) => p.name === d.printer) ? d : { ...d, printer: data.printers[0]?.name || '' }))
    setLoad({ state: 'ready', error: '' })
  }, [])
  const fail = useCallback((e) => setLoad({ state: 'error', error: e.message || 'Could not reach the database' }), [])
  useEffect(() => { fetchLibrary().then(apply, fail) }, [apply, fail])
  const retry = () => { setLoad({ state: 'loading', error: '' }); fetchLibrary().then(apply, fail) }

  // Remember the last printer/material/temps on this device
  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ printer: draft.printer, material: draft.material, nozzle: draft.nozzle, bed: draft.bed })) } catch { /* private mode */ }
  }, [draft.printer, draft.material, draft.nozzle, draft.bed])

  // Where new files go: into the project being viewed, if any. Otherwise
  // each file is auto-sorted by its name (see autosort.js); files that match
  // no project land in Unsorted, under the category being viewed (or Personal).
  const activeProject = projects.find((p) => p.id === project) || null
  const dropProject = view === 'catalog' ? activeProject : null
  const fallbackCat = CATS.includes(cat) && view === 'catalog' ? cat : 'Personal'
  const dropLabel = dropProject ? `Drop to add to ${dropProject.name}` : 'Drop to sort into projects'

  // found: [{ file, path }] from a drop or the pickers. Folders and .zip
  // files are opened up; every 3D file inside is added.
  const addFound = async (found) => {
    if (load.state !== 'ready') return
    const many = found.length > 1 || found.some((x) => x.path.includes('/') || /\.zip$/i.test(x.file.name))
    if (many) showToast('Opening…')
    const { items, badZips } = await expand(found)
    if (badZips.length) showToast(`Couldn't open ${badZips.join(', ')}`)
    return addItems(items)
  }

  const addItems = async (items) => {
    const supported = items.filter(({ file }) => EXTS.includes(file.name.split('.').pop().toLowerCase()))
    const skipped = items.length - supported.length
    if (!supported.length) return showToast('No 3D files found. Use STL, 3MF, OBJ, STEP or G-code (folders and .zip files are fine).')
    // same name and size as a file already in the library = a duplicate
    const key = (name, ext, size) => `${name.toLowerCase()}.${ext}|${size}`
    const have = new Set(filesRef.current.map((f) => key(f.name, f.ext, f.size)))
    const ok = supported.filter(({ file }) => {
      const parts = file.name.split('.'); const ext = parts.pop().toLowerCase()
      const k = key(parts.join('.'), ext === 'stp' ? 'step' : ext === 'gco' ? 'gcode' : ext, file.size)
      if (have.has(k)) return false
      have.add(k)
      return true
    })
    const dupes = supported.length - ok.length
    if (!ok.length) return showToast(`Already in your library: ${dupes} file${dupes === 1 ? '' : 's'}`)
    const added = ok.map(({ file: f, folder }) => {
      const parts = f.name.split('.')
      const ext = parts.pop().toLowerCase()
      // file name first; if it says nothing, the folder names can
      const pr = dropProject || (matchProject(parts.join('.'), projects) || matchProject(folder, projects))?.project || null
      // the top folder's name becomes a tag, e.g. "labels"
      const folderTag = normalize(folder.split('/')[0]).replace(/ /g, '-').slice(0, 40)
      return {
        entry: {
          id: uid('f'), name: parts.join('.'),
          ext: ext === 'stp' ? 'step' : ext === 'gco' ? 'gcode' : ext,
          size: f.size, category: pr ? pr.category : fallbackCat, projectId: pr?.id || null, tags: folderTag ? [folderTag] : [], fav: false, prints: [], added: Date.now(), hasFile: false,
        },
        file: f,
      }
    })
    setFiles((prev) => [...added.map((a) => a.entry), ...prev])
    setView('catalog')
    if (added.length === 1) setSel(added[0].entry.id)
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
    const sortedIds = new Set(added.map((a) => a.entry.projectId).filter(Boolean))
    const unsorted = added.filter((a) => !a.entry.projectId).length
    const summary = dropProject
      ? `Added ${plural(added.length, 'file')} to ${dropProject.name}`
      : sortedIds.size
        ? `Sorted ${plural(added.length - unsorted, 'file')} into ${plural(sortedIds.size, 'project')}` + (unsorted ? ` · ${unsorted} unsorted` : '')
        : `Added ${plural(added.length, 'file')} to Unsorted`
    const skippedNote = (dupes ? ` · ${dupes} already here` : '') + (skipped ? ` · skipped ${skipped} non-3D` : '')
    showToast(summary + skippedNote)

    let failed = 0
    for (const { entry, file } of added) {
      try {
        await saveFile(entry)
        setUploading((u) => ({ ...u, [entry.id]: 0 }))
        await uploadFile(storage, entry.id, file, (pct) => setUploading((u) => ({ ...u, [entry.id]: Math.round(pct) })))
        setFiles((fs) => fs.map((f) => (f.id === entry.id ? { ...f, hasFile: true } : f)))
      } catch (e) {
        failed++
        console.error('Print Hub upload failed', e)
      } finally {
        setUploading((u) => { const n = { ...u }; delete n[entry.id]; return n })
      }
    }
    showToast(failed
      ? `${failed} of ${added.length} file${added.length > 1 ? 's' : ''} didn't upload. The details are saved; try again later.`
      : summary + skippedNote)
  }
  const addFilesRef = useRef(addFound)
  useEffect(() => { addFilesRef.current = addFound })

  // Window-wide drag & drop
  useEffect(() => {
    let depth = 0
    const hasFiles = (e) => e.dataTransfer?.types?.includes('Files')
    const onEnter = (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; setDragging(true) }
    const onOver = (e) => { if (hasFiles(e)) e.preventDefault() }
    const onLeave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragging(false) }
    const onDrop = (e) => {
      if (!hasFiles(e)) return
      e.preventDefault(); depth = 0; setDragging(false)
      const grab = grabDropped(e.dataTransfer) // must run before the handler returns
      grab().then((found) => addFilesRef.current(found)).catch(() => showToast("Couldn't read what was dropped. Try Add files."))
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  // Escape closes the drawer
  useEffect(() => {
    if (!sel) return
    const onKey = (e) => { if (e.key === 'Escape') setSel(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel])

  const updateFile = (id, fn) => {
    const cur = filesRef.current.find((f) => f.id === id)
    if (!cur) return
    const next = fn(cur)
    filesRef.current = filesRef.current.map((f) => (f.id === id ? next : f))
    setFiles(filesRef.current)
    saveFile(next).catch(saveFailed)
  }

  // Printer/material/project rows save a moment after you stop typing
  const profileTimers = useRef({})
  const profiles = { printers: [printers, setPrinters], materials: [materials, setMaterials], projects: [projects, setProjects] }
  const editProfile = (kind, id, key, val) => {
    const [rows, setRows] = profiles[kind]
    const next = rows.map((r) => (r.id === id ? { ...r, [key]: val } : r))
    setRows(next)
    const row = next.find((r) => r.id === id)
    clearTimeout(profileTimers.current[id])
    profileTimers.current[id] = setTimeout(() => saveProfile(kind, row).catch(saveFailed), 500)
  }
  const addProfile = (kind, row) => {
    const [rows, setRows] = profiles[kind]
    setRows([...rows, row])
    saveProfile(kind, row).catch(saveFailed)
  }
  const removeProfile = (kind, id) => {
    const [rows, setRows] = profiles[kind]
    clearTimeout(profileTimers.current[id])
    setRows(rows.filter((r) => r.id !== id))
    deleteProfile(kind, id).catch(saveFailed)
    if (kind === 'projects') {
      setFiles((fs) => fs.map((f) => (f.projectId === id ? { ...f, projectId: null } : f)))
      if (project === id) setProject(null)
    }
  }
  const openProject = (id) => { setProject(id); setCat('All'); setTag(null); setView('catalog') }
  const projectName = (id) => projects.find((p) => p.id === id)?.name
  const toggleFav = (id) => updateFile(id, (f) => ({ ...f, fav: !f.fav }))

  const ql = q.trim().toLowerCase()
  const shown = useMemo(() => files.filter((f) =>
    (cat === 'All' || (cat === 'Favorites' ? f.fav : cat === 'Unsorted' ? !f.projectId : f.category === cat)) &&
    (!project || f.projectId === project) &&
    (!tag || f.tags.includes(tag)) &&
    (!ql || f.name.toLowerCase().includes(ql) || f.tags.some((t) => t.includes(ql)))
  ), [files, cat, project, tag, ql])
  const allTags = useMemo(() => [...new Set(files.flatMap((f) => f.tags))].sort(), [files])

  const navCount = (label) =>
    label === 'All' ? files.length : label === 'Favorites' ? files.filter((f) => f.fav).length
      : label === 'Unsorted' ? files.filter((f) => !f.projectId).length : files.filter((f) => f.category === label).length
  const catTitle = activeProject ? activeProject.name : cat === 'All' ? 'All files' : cat
  const heading = tag ? `${catTitle} · #${tag}` : catTitle
  const selected = files.find((f) => f.id === sel)

  return (
    <div className="ph">
      <header className="ph-header">
        <div className="ph-brand">
          <div className="ph-title"><span className="ph-title-blue">Print</span> Hub</div>
          <div className="ph-mono ph-count">{files.length} file{files.length === 1 ? '' : 's'}</div>
        </div>
        <div className="ph-search-wrap">
          <input
            className="ph-search" value={q} placeholder="Search files and tags"
            onChange={(e) => { setQ(e.target.value); setView('catalog') }}
          />
        </div>
        <div style={{ flex: 1 }} />
        <input
          ref={fileRef} type="file" multiple accept=".stl,.3mf,.obj,.step,.stp,.gcode,.gco,.zip" style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files?.length) addFound(fromPicker(e.target.files)); e.target.value = '' }}
        />
        <input
          ref={folderRef} type="file" webkitdirectory="" style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files?.length) addFound(fromPicker(e.target.files)); e.target.value = '' }}
        />
        <button className="ph-btn-outline ph-hide-phone" onClick={() => folderRef.current?.click()}>Add folder</button>
        <button className="ph-btn-primary" onClick={() => fileRef.current?.click()}>Add files</button>
      </header>

      <div className="ph-body-row">
        <aside className="ph-side">
          <nav className="ph-nav">
            <div className="ph-label">Library</div>
            {['All', 'Favorites', ...CATS, 'Unsorted'].map((label) => (
              <NavItem key={label} label={label} count={navCount(label)} active={view === 'catalog' && !project && cat === label}
                onClick={() => { setCat(label); setProject(null); setView('catalog') }} />
            ))}
          </nav>
          <nav className="ph-nav">
            <div className="ph-label">Projects</div>
            <NavItem label="All projects" count={projects.length} active={view === 'projects'} onClick={() => setView('projects')} />
            {activeProject && view === 'catalog' && (
              <NavItem label={activeProject.name} count={files.filter((f) => f.projectId === project).length} active onClick={() => {}} />
            )}
          </nav>
          <nav className="ph-nav">
            <div className="ph-label">Settings</div>
            <NavItem label="Printers" count={printers.length} active={view === 'printers'} onClick={() => setView('printers')} />
            <NavItem label="Materials" count={materials.length} active={view === 'materials'} onClick={() => setView('materials')} />
          </nav>
          {view === 'catalog' && allTags.length > 0 && (
            <div className="ph-tags-block">
              <div className="ph-label" style={{ paddingBottom: 0 }}>Tags</div>
              <div className="ph-tag-pills">
                {allTags.map((t) => (
                  <button key={t} className="ph-pill" style={segStyle(tag === t)}
                    onClick={() => { setTag(tag === t ? null : t); setView('catalog') }}>{t}</button>
                ))}
              </div>
            </div>
          )}
        </aside>

        <main className="ph-main">
          {load.state === 'loading' && <div className="ph-empty"><div>Loading your library…</div></div>}
          {load.state === 'error' && (
            <div className="ph-empty">
              <div className="ph-empty-title">Couldn't reach the database</div>
              <div>{load.error}</div>
              <button className="ph-btn-outline" onClick={retry}>Try again</button>
            </div>
          )}
          {load.state === 'ready' && storage === 'none' && (
            <div className="ph-banner">File storage isn't turned on, so only file details are saved, not the files themselves. Turn on Vercel Blob for this project to fix it.</div>
          )}
          {load.state === 'ready' && view === 'catalog' && (
            <>
              <div className="ph-head-row" style={{ marginBottom: 20 }}>
                <div className="ph-title-row">
                  <h1 className="ph-h1">{heading}</h1>
                  {activeProject && (
                    <>
                      <StatusPill status={activeProject.status} />
                      <button className="ph-btn-sm" onClick={() => setProject(null)}>Show all files</button>
                    </>
                  )}
                </div>
                <div className="ph-hint">Drop 3D files, folders or .zip files anywhere</div>
              </div>
              {activeProject?.notes && <div className="ph-project-notes">{activeProject.notes}</div>}
              {cat === 'Unsorted' && !activeProject && shown.length > 0 && (
                <div className="ph-project-notes">These files didn't match any project's keywords. Open one to pick a project, or add keywords on the Projects page.</div>
              )}
              {shown.length > 0 ? (
                <div className="ph-grid">
                  {shown.map((f) => {
                    const st = status(f)
                    return (
                      <div key={f.id} className="ph-card" role="button" tabIndex={0}
                        onClick={() => setSel(f.id)} onKeyDown={(e) => e.key === 'Enter' && setSel(f.id)}>
                        <div className="ph-thumb">
                          <span className="ph-badge">{f.ext.toUpperCase()}</span>
                          <button className="ph-fav" style={{ color: f.fav ? BLUE : 'var(--muted)' }}
                            aria-label={f.fav ? 'Remove favorite' : 'Add favorite'}
                            onClick={(e) => { e.stopPropagation(); toggleFav(f.id) }}>{f.fav ? '★' : '☆'}</button>
                        </div>
                        <div className="ph-card-body">
                          <div className="ph-card-name">{f.name}</div>
                          <div className="ph-card-meta">
                            <span className="ph-ellipsis">{projectName(f.projectId) || f.category}</span>
                            {uploading[f.id] != null
                              ? <span className="ph-status ph-mono">{uploading[f.id]}%</span>
                              : <span className="ph-status"><span className="ph-dot6" style={{ background: st.dot }} />{st.label}</span>}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="ph-empty">
                  <div className="ph-empty-title">{ql || tag ? 'Nothing matches' : 'No files here yet'}</div>
                  <div>Drag files here or use Add files.</div>
                </div>
              )}
            </>
          )}

          {load.state === 'ready' && view === 'projects' && (
            <ProjectsPage
              projects={projects} files={files}
              onEdit={(id, key, val) => editProfile('projects', id, key, val)}
              onRemove={(id) => {
                const pr = projects.find((p) => p.id === id)
                if (window.confirm(`Delete the project "${pr?.name || 'Untitled'}"? Its files stay in the library.`)) removeProfile('projects', id)
              }}
              onAdd={(category) => addProfile('projects', { id: uid('pr'), name: '', category, status: 'Idea', notes: '', keywords: '' })}
              onOpen={openProject}
            />
          )}

          {load.state === 'ready' && view === 'printers' && (
            <ProfileTable
              title="Printers" addLabel="Add printer"
              sub="Printers listed here appear when logging a print. Changes save automatically."
              minWidth={640} cols="1.4fr 0.7fr 1fr 1.6fr 32px"
              headers={['Name', 'Nozzle mm', 'Build volume', 'Notes']}
              kind="printers" rows={printers} onEdit={editProfile} onRemove={removeProfile}
              fields={[
                { key: 'name', placeholder: 'Printer name', strong: true },
                { key: 'nozzle', placeholder: '0.4', mono: true },
                { key: 'volume', placeholder: '250×210×220', mono: true },
                { key: 'notes', placeholder: 'Notes' },
              ]}
              onAdd={() => addProfile('printers', { id: uid('p'), name: '', nozzle: '0.4', volume: '', notes: '' })}
            />
          )}

          {load.state === 'ready' && view === 'materials' && (
            <ProfileTable
              title="Materials" addLabel="Add material"
              sub="Selecting a material when logging a print fills in its temperatures. Changes save automatically."
              minWidth={680} cols="1fr 0.7fr 0.7fr 0.6fr 1.8fr 32px"
              headers={['Material', 'Nozzle °C', 'Bed °C', 'Fan %', 'Notes']}
              kind="materials" rows={materials} onEdit={editProfile} onRemove={removeProfile}
              fields={[
                { key: 'name', placeholder: 'Material', strong: true },
                { key: 'nozzle', mono: true, number: true },
                { key: 'bed', mono: true, number: true },
                { key: 'fan', mono: true, number: true },
                { key: 'notes', placeholder: 'Notes' },
              ]}
              onAdd={() => addProfile('materials', { id: uid('m'), name: '', nozzle: 210, bed: 60, fan: 100, notes: '' })}
            />
          )}
        </main>
      </div>

      {dragging && (
        <div className="ph-drop">
          <div className="ph-drop-title">{dropLabel}</div>
          <div className="ph-mono" style={{ fontSize: 14, color: 'var(--muted)' }}>STL · 3MF · OBJ · STEP · G-CODE · FOLDERS · ZIP</div>
        </div>
      )}

      {toast && <div className="ph-toast">{toast}</div>}

      {selected && (
        <Drawer
          key={selected.id}
          file={selected}
          uploadPct={uploading[selected.id]}
          printers={printers} materials={materials} projects={projects}
          draft={draft} setDraft={setDraft}
          onClose={() => setSel(null)}
          onFav={() => toggleFav(selected.id)}
          onDelete={() => {
            if (!window.confirm(`Delete "${selected.name}"? This can't be undone.`)) return
            const id = selected.id
            setFiles((fs) => fs.filter((f) => f.id !== id))
            setSel(null)
            deleteFile(id).then(() => showToast('File deleted')).catch(saveFailed)
          }}
          update={(fn) => updateFile(selected.id, fn)}
          showToast={showToast}
        />
      )}
    </div>
  )
}

function NavItem({ label, count, active, onClick }) {
  return (
    <button className={'ph-nav-item' + (active ? ' is-active' : '')} onClick={onClick}>
      <span>{label}</span>
      <span className="ph-mono ph-nav-count">{count}</span>
    </button>
  )
}

function ProfileTable({ title, addLabel, sub, minWidth, cols, headers, kind, rows, onEdit, onRemove, fields, onAdd }) {
  return (
    <>
      <div className="ph-head-row" style={{ marginBottom: 6 }}>
        <h1 className="ph-h1">{title}</h1>
        <button className="ph-btn-outline" onClick={onAdd}>{addLabel}</button>
      </div>
      <div className="ph-sub">{sub}</div>
      <div className="ph-table">
        <div style={{ minWidth }}>
          <div className="ph-tr ph-th ph-mono" style={{ gridTemplateColumns: cols }}>
            {headers.map((h) => <span key={h}>{h}</span>)}<span />
          </div>
          {rows.map((r) => (
            <div key={r.id} className="ph-tr" style={{ gridTemplateColumns: cols }}>
              {fields.map((f) => (
                <input
                  key={f.key}
                  type={f.number ? 'number' : 'text'}
                  className={'ph-cell' + (f.strong ? ' is-strong' : '') + (f.mono ? ' ph-mono' : '')}
                  value={r[f.key] ?? ''}
                  placeholder={f.placeholder}
                  onChange={(e) => onEdit(kind, r.id, f.key, f.number ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
                />
              ))}
              <button className="ph-x" aria-label="Remove"
                onClick={() => onRemove(kind, r.id)}>×</button>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

function Drawer({ file, uploadPct, printers, materials, projects, draft, setDraft, onClose, onFav, onDelete, update, showToast }) {
  const [tagInput, setTagInput] = useState('')
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }))
  const printerOpts = [...new Set([...printers.map((p) => p.name).filter(Boolean), draft.printer].filter(Boolean))]
  const materialOpts = [...new Set([...materials.map((m) => m.name).filter(Boolean), draft.material].filter(Boolean))]

  const savePrint = () => {
    const p = {
      date: Date.now(), printer: draft.printer, material: draft.material,
      nozzle: +draft.nozzle || 0, bed: +draft.bed || 0, supports: draft.supports, result: draft.result,
    }
    update((f) => ({ ...f, prints: [p, ...f.prints] }))
    setDraft((d) => ({ ...d, result: 'Success' }))
    showToast('Print saved')
  }

  return (
    <>
      <div className="ph-backdrop" onClick={onClose} />
      <div className="ph-drawer" role="dialog" aria-label={file.name}>
        <div className="ph-drawer-bar">
          <button className="ph-btn-sm" onClick={onClose}>Close</button>
          <div style={{ flex: 1 }} />
          {uploadPct != null && <span className="ph-mono ph-meta">Uploading {uploadPct}%</span>}
          {file.hasFile && uploadPct == null && <a className="ph-btn-sm ph-btn-link" href={downloadUrl(file.id)} download>Download</a>}
          <button className="ph-btn-sm" style={{ color: file.fav ? BLUE : 'var(--ink)' }} onClick={onFav}>
            {file.fav ? '★ Favorite' : '☆ Favorite'}
          </button>
          <button className="ph-btn-sm ph-danger" onClick={onDelete}>Delete</button>
        </div>

        <div className="ph-drawer-body">
          <div className="ph-preview">
            <span className="ph-badge ph-badge-lg">3D preview · {file.ext.toUpperCase()}</span>
          </div>

          <div className="ph-col4">
            <div className="ph-drawer-title">{file.name}</div>
            <div className="ph-mono ph-meta">
              {file.ext.toUpperCase()} · {fmtSize(file.size)} · added {fmtDate(file.added)}
            </div>
          </div>

          <div className="ph-col8">
            <div className="ph-field-label">Category</div>
            <div className="ph-seg-row">
              {CATS.map((c) => (
                <button key={c} className="ph-seg" style={segStyle(file.category === c)}
                  onClick={() => update((f) => ({
                    ...f, category: c,
                    projectId: projects.find((p) => p.id === f.projectId)?.category === c ? f.projectId : null,
                  }))}>{c}</button>
              ))}
            </div>
          </div>

          <label className="ph-lbl">Project
            <select className="ph-input" value={file.projectId || ''}
              onChange={(e) => {
                const pr = projects.find((p) => p.id === e.target.value)
                update((f) => ({ ...f, projectId: pr?.id || null, category: pr ? pr.category : f.category }))
              }}>
              <option value="">No project</option>
              {CATS.map((c) => (
                <optgroup key={c} label={c}>
                  {projects.filter((p) => p.category === c).map((p) => <option key={p.id} value={p.id}>{p.name || 'Untitled'}</option>)}
                </optgroup>
              ))}
            </select>
          </label>

          <div className="ph-col8">
            <div className="ph-field-label">Tags</div>
            <div className="ph-seg-row" style={{ alignItems: 'center' }}>
              {file.tags.map((t) => (
                <span key={t} className="ph-chip">
                  {t}
                  <button aria-label={`Remove ${t}`} onClick={() => update((f) => ({ ...f, tags: f.tags.filter((y) => y !== t) }))}>×</button>
                </span>
              ))}
              <input
                className="ph-tag-input" value={tagInput} placeholder="Add tag + Enter"
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  const t = tagInput.trim().toLowerCase().replace(/^#+/, '')
                  if (t && !file.tags.includes(t)) update((f) => ({ ...f, tags: [...f.tags, t] }))
                  setTagInput('')
                }}
              />
            </div>
          </div>

          <div className="ph-log">
            <div className="ph-section-title">Log a print</div>
            <div className="ph-log-grid">
              <label className="ph-lbl">Printer
                <select className="ph-input" value={draft.printer} onChange={set('printer')}>
                  {printerOpts.length === 0 && <option value="">Add a printer in Settings</option>}
                  {printerOpts.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
              <label className="ph-lbl">Material
                <select className="ph-input" value={draft.material} onChange={(e) => {
                  const m = materials.find((x) => x.name === e.target.value)
                  setDraft((d) => ({ ...d, material: e.target.value, ...(m ? { nozzle: m.nozzle, bed: m.bed } : {}) }))
                }}>
                  {materialOpts.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
              <label className="ph-lbl">Nozzle °C
                <input type="number" className="ph-input ph-mono" value={draft.nozzle} onChange={set('nozzle')} />
              </label>
              <label className="ph-lbl">Bed °C
                <input type="number" className="ph-input ph-mono" value={draft.bed} onChange={set('bed')} />
              </label>
            </div>
            <div className="ph-col6">
              <div className="ph-field-label">Supports</div>
              <div className="ph-seg-row">
                {SUPPORTS.map((o) => (
                  <button key={o} className="ph-seg" style={segStyle(draft.supports === o)}
                    onClick={() => setDraft((d) => ({ ...d, supports: o }))}>{o}</button>
                ))}
              </div>
            </div>
            <div className="ph-col6">
              <div className="ph-field-label">Result</div>
              <div className="ph-seg-row">
                {['Success', 'Failed'].map((o) => (
                  <button key={o} className="ph-seg" style={{ padding: '0 14px', ...segStyle(draft.result === o, o === 'Success' ? 'ok' : 'fail') }}
                    onClick={() => setDraft((d) => ({ ...d, result: o }))}>{o}</button>
                ))}
              </div>
            </div>
            <button className="ph-btn-primary" onClick={savePrint}>Save print</button>
          </div>

          <div className="ph-col10">
            <div className="ph-section-title">Print history</div>
            {file.prints.length === 0 && <div className="ph-muted13">No prints logged yet.</div>}
            {file.prints.map((p, i) => (
              <div key={p.date + '-' + i} className="ph-hist">
                <span className="ph-dot8" style={{ background: p.result === 'Success' ? OK : FAIL }} />
                <div className="ph-hist-main">
                  <div className="ph-hist-top">
                    <span style={{ fontWeight: 500 }}>{p.result}</span>
                    <span className="ph-mono ph-meta">{fmtDate(p.date)}</span>
                  </div>
                  <div className="ph-hist-sum">
                    {[p.printer || 'Unknown printer', p.material, `${p.nozzle}° / ${p.bed}°C`,
                      p.supports === 'None' ? 'No supports' : 'Supports: ' + p.supports.toLowerCase()].join(' · ')}
                  </div>
                </div>
                <button className="ph-x ph-x-sm" aria-label="Remove print"
                  onClick={() => update((f) => ({ ...f, prints: f.prints.filter((_, j) => j !== i) }))}>×</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

function StatusPill({ status }) {
  return (
    <span className="ph-status-pill">
      <span className="ph-dot6" style={{ background: STATUS_COLOR[status] || GREY }} />{status}
    </span>
  )
}

function ProjectsPage({ projects, files, onEdit, onRemove, onAdd, onOpen }) {
  const busyWork = projects.filter((p) => p.category === 'Work' && p.status === 'In progress')
  return (
    <>
      <div className="ph-head-row" style={{ marginBottom: 6 }}>
        <h1 className="ph-h1">Projects</h1>
      </div>
      <div className="ph-sub">Each file can belong to a project. Uploaded files are sorted into the project whose auto-sort words appear in the file name. Changes save automatically.</div>
      {busyWork.length > 1 && (
        <div className="ph-banner ph-banner-warn">
          <strong>{busyWork.length} work projects are in progress:</strong> {busyWork.map((p) => p.name).join(', ')}.
          {' '}Your rule: finish one before starting the next.
        </div>
      )}
      {CATS.map((c) => {
        const list = projects.filter((p) => p.category === c)
        return (
          <section key={c} className="ph-proj-section">
            <div className="ph-proj-head">
              <h2 className="ph-h2">{c}</h2>
              <span className="ph-mono ph-count">{list.length}</span>
              <div style={{ flex: 1 }} />
              <button className="ph-btn-outline" onClick={() => onAdd(c)}>Add {c.toLowerCase()} project</button>
            </div>
            <div className="ph-proj-grid">
              {list.map((p) => {
                const count = files.filter((f) => f.projectId === p.id).length
                return (
                  <div key={p.id} className="ph-proj">
                    <div className="ph-proj-top">
                      <input className="ph-cell is-strong ph-proj-name" value={p.name} placeholder="Project name"
                        onChange={(e) => onEdit(p.id, 'name', e.target.value)} />
                      <button className="ph-x" aria-label="Delete project" onClick={() => onRemove(p.id)}>×</button>
                    </div>
                    <div className="ph-proj-row">
                      <span className="ph-dot8" style={{ marginTop: 0, background: STATUS_COLOR[p.status] || GREY }} />
                      <select className="ph-proj-select" value={p.status} onChange={(e) => onEdit(p.id, 'status', e.target.value)}>
                        {STATUSES.map((st) => <option key={st}>{st}</option>)}
                      </select>
                      <select className="ph-proj-select" value={p.category} onChange={(e) => onEdit(p.id, 'category', e.target.value)}>
                        {CATS.map((cc) => <option key={cc}>{cc}</option>)}
                      </select>
                    </div>
                    <label className="ph-kw">
                      <span>Auto-sort words</span>
                      <input className="ph-kw-input" value={p.keywords || ''} placeholder="e.g. hook, cage"
                        onChange={(e) => onEdit(p.id, 'keywords', e.target.value)} />
                    </label>
                    <textarea className="ph-proj-notes" value={p.notes} placeholder="Notes, measurements, what's next…" rows={4}
                      onChange={(e) => onEdit(p.id, 'notes', e.target.value)} />
                    <button className="ph-proj-files" onClick={() => onOpen(p.id)}>
                      {count ? `${count} file${count === 1 ? '' : 's'}` : 'No files yet'} →
                    </button>
                  </div>
                )
              })}
              {list.length === 0 && <div className="ph-muted13">No {c.toLowerCase()} projects yet.</div>}
            </div>
          </section>
        )
      })}
    </>
  )
}
