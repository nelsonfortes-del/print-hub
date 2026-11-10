/* global process, Buffer */
// Print Hub server code: catalog rows in a Postgres database (Neon), the 3D
// files themselves in Vercel Blob.
import { readFileSync, createReadStream } from 'fs'
import { mkdir, writeFile, rm, stat } from 'fs/promises'
import path from 'path'
import { neon } from '@neondatabase/serverless'

export function httpError(status, message) {
  return Object.assign(new Error(message), { status })
}

// ---------- connections ----------

// Vercel's Neon integration sets DATABASE_URL (or POSTGRES_URL).
export const databaseUrl = () =>
  ['DATABASE_URL', 'POSTGRES_URL', 'DATABASE_URL_UNPOOLED'].map((k) => process.env[k]).find((v) => v && v.trim()) || ''

// Neon over HTTP in production; a localhost database (for trying it out on
// your own computer) goes through the regular Postgres driver.
let _db = null
async function db() {
  if (_db) return _db
  const url = databaseUrl().trim()
  if (!url) throw httpError(503, 'DATABASE_URL not set')
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    const { default: pg } = await import('pg')
    const pool = new pg.Pool({ connectionString: url, max: 4 })
    _db = { query: async (text, params) => (await pool.query(text, params)).rows }
  } else {
    const sql = neon(url)
    _db = { query: (text, params) => sql.query(text, params) }
  }
  return _db
}

// Any env var ending in BLOB_READ_WRITE_TOKEN (Vercel names it that way,
// sometimes with a prefix).
export const blobToken = () => {
  const key = Object.keys(process.env).find((k) => k.endsWith('BLOB_READ_WRITE_TOKEN') && process.env[k])
  return key ? process.env[key] : ''
}

// Newer Vercel Blob stores set BLOB_STORE_ID instead of a token and sign in
// with the project's own Vercel identity (OIDC). Either one turns storage on.
export const blobStoreId = () => (process.env.BLOB_STORE_ID || '').trim()
export const blobOn = () => !!(blobToken() || blobStoreId())
// Passed to the Blob calls: the token if there is one, otherwise nothing,
// so the library signs in with BLOB_STORE_ID.
export const blobAuth = () => (blobToken() ? { token: blobToken() } : {})

export async function readRaw(req, limit) {
  if (Buffer.isBuffer(req.body)) return req.body
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > limit) throw httpError(413, 'File too large')
    chunks.push(c)
  }
  return Buffer.concat(chunks)
}

export const CATS = ['Work', 'Personal']
export const STATUSES = ['Idea', 'In design', 'Ready to print', 'In progress', 'Works', 'Done', 'Stalled']
const EXTS = ['stl', '3mf', 'obj', 'step', 'gcode']
const SUPPORTS = ['None', 'Buildplate only', 'Everywhere']
export const MAX_FILE_BYTES = 500 * 1024 * 1024
export const BLOB_PREFIX = 'printhub/'

// Starting data, from Nelson's 3D printing notes. Only ever inserted once
// (see ensureTables); after that everything is edited in the app.
const PRINTERS = [
  ['kobra-s1', 'Anycubic Kobra S1 Combo', '0.4', '250×250×250', 'Main printer. ACE Pro multi-color unit. Replacement unit, working fine since 8/31/2026. GECO cold plate for PLA (no bed heat).'],
  ['ad5m', 'Flashforge Adventurer 5M', '0.4', '220×220×220', 'Used for the Honeycomb Storage Wall panels.'],
]
const MATERIALS = [
  ['eryone-silk', 'Eryone Silk PLA', 230, 55, null, 'Anycubic Slicer Next preset: flow 0.95, PA 0.024. To do: re-run the flow test at the right temperature.'],
  ['m1', 'PLA', 215, 60, 100, 'On hand: black and white. Two-color: slot 1 black, slot 2 white; height-range modifier for raised text.'],
  ['m2', 'PETG', 240, 80, 40, 'Use glue stick on smooth PEI'],
  ['m3', 'ABS', 250, 100, 0, 'Enclosure required'],
  ['m4', 'ASA', 255, 100, 10, 'Outdoor parts'],
  ['m5', 'TPU', 225, 50, 50, 'Print slow, 20 mm/s'],
]
const PROJECTS = [
  ['metris-hooks', 'Metris Van Cage Hooks', 'Work', 'Works', 'v2 two-clip design works; about 8 printed (Oct 2026). Next: higher hook lip, a fold-up hook, and a ~1 qt trash bin that hangs on the same clips.'],
  ['scanner-mount', 'Dash Cubby Scanner Mount', 'Work', 'In design', 'Friction-fit cubby anchor + cradle for the Zebra TC77 (80.1 × 160 × 25.2 mm). Two pieces: anchor with shaft, cradle with snap-on clamp rings that tilt. Fix from first print: scale anchor down 5%, square the top-right corner. Later: phone pocket, slide-in cup holder.'],
  ['hit-dividers', 'Hit Divider Cards', 'Work', 'Ready to print', '215.9 × 108 mm, 2.4 mm black body, 1.2 mm raised white text, Inter Display Black, SLAB layout. 18 hits (Hit 1 = Weybosset). python3 hit_divider.py all. 0.2 mm layers, 3 walls, no supports, 5 mm brim.'],
  ['form-box', 'PS 3849 Form Box', 'Work', 'In design', 'For 3.5" × 7.5" forms. Flat, square, fully enclosed. Tambour lid slides back and rolls down inside. Based on A+Gridfinity+Tambour+Box. Wanted as FreeCAD + STL.'],
  ['honeycomb-wall', 'Honeycomb Storage Wall', 'Work', 'In progress', 'Mail case back wall, magnets, no drilling. 20 mm hex, 1.8 mm wall, 8 mm deep (HSW compatible). One row of 220 mm panels on the Flashforge. Envelope tray done (8 snap clips). Deferred: letter file rack.'],
  ['mail-organizer', '5-Slot Mail Carrier Organizer', 'Work', 'In progress', 'Truck sorter. Slanted dividers, one long side closed. Side bins: one left, two right, set back. One piece, max bed length.'],
  ['pocket-folder', 'Mail Pocket Folder', 'Work', 'Idea', 'Slim book-style folder behind the mail stack: forms, labels, pen, writing surface. Thinness first, at least #10 envelope wide, roughly weatherproof. Options: initials, rubber band slot, magnet closure, trifold.'],
  ['crown-dove', 'Crown with Dove', 'Personal', 'In progress', 'Three parts: crown, pedestal plate, stand. Small dove on the orb, no wand or scepter, hollow crown bottom.'],
  ['gridfinity-base', 'Gridfinity Baseplate', 'Personal', 'Idea', '28" × 13" area, 16 × 7 grid. Needs printable STLs.'],
  ['skadis', 'SKÅDIS Pegboard', 'Personal', 'Idea', 'About 30" × 20", printed in tiles on the Kobra S1. Test a small piece first.'],
  ['tcg-sorting', 'TCG Card Sorting', 'Personal', 'Idea', 'Thin SKÅDIS strip with ~6 pockets for loose cards. Wall buckets: Gridfinity Trading Card Organizer (Printables). Hex tray: check Makerworld first.'],
  ['sorting-tray', 'Sorting Tray', 'Personal', 'Stalled', ''],
]

// Starting auto-sort keywords. A file whose name contains one of these words
// goes into that project when uploaded.
const KEYWORDS = {
  'metris-hooks': 'hook, cage, metris, satchel, trash bin',
  'scanner-mount': 'scanner, tc77, zebra, cubby, cradle, dash',
  'hit-dividers': 'hit, hit divider, divider card, weybosset',
  'form-box': '3849, tambour, form box',
  'honeycomb-wall': 'hsw, honeycomb, hex panel, envelope, glove, tilt box',
  'mail-organizer': 'organizer, sorter, 5 slot, mail sorter',
  'pocket-folder': 'pocket folder, folder',
  'crown-dove': 'crown, dove, orb, pedestal',
  'gridfinity-base': 'baseplate, gridfinity base',
  skadis: 'skadis, pegboard',
  'tcg-sorting': 'tcg, trading card, card sorting, card',
  'sorting-tray': 'sorting tray',
}

// ---------- tables ----------

// Every statement in db/schema.sql is safe to re-run ("if not exists"), so
// they all run once per server start; that's how new columns get added.
// Starting data goes in once, tracked in ph_meta.
let _ready = null
function ensureTables() {
  if (!_ready) {
    _ready = (async () => {
      const d = await db()
      const text = readFileSync(new URL('../../db/schema.sql', import.meta.url), 'utf8')
      const statements = text.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
        .split(';').map((s) => s.trim()).filter(Boolean)
      for (const st of statements) await d.query(st)

      const done = new Set((await d.query('select key from ph_meta')).map((r) => r.key))
      const mark = (key) => d.query('insert into ph_meta (key, value) values ($1, $2) on conflict do nothing', [key, new Date().toISOString()])

      // v1 setup: real printers, filament, projects, Work/Personal
      if (!done.has('setup-v1')) {
        // the first version's sample printers, if they were never touched
        await d.query(`delete from ph_printers where (id = 'p1' and name = 'Prusa MK4' and notes = 'Textured PEI sheet')
                                               or (id = 'p2' and name = 'Bambu P1S' and notes = '')`)
        await d.query(`delete from ph_materials where id = 'm1' and name = 'PLA' and notes = 'Default for most parts'`)
        for (const [i, p] of PRINTERS.entries()) {
          await d.query('insert into ph_printers (id, name, nozzle, volume, notes, sort) values ($1,$2,$3,$4,$5,$6) on conflict do nothing', [...p, i])
        }
        for (const [i, m] of MATERIALS.entries()) {
          await d.query('insert into ph_materials (id, name, nozzle, bed, fan, notes, sort) values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing', [...m, i])
        }
        for (const [i, pr] of PROJECTS.entries()) {
          await d.query('insert into ph_projects (id, name, category, status, notes, sort) values ($1,$2,$3,$4,$5,$6) on conflict do nothing', [...pr, i])
        }
        // old categories (Functional parts / Household / Tools) become Personal
        await d.query("update ph_files set category = 'Personal' where category not in ('Work', 'Personal')")
        await mark('setup-v1')
      }

      // v2: auto-sort keywords (only fills in projects that have none yet)
      if (!done.has('setup-v2')) {
        for (const [id, words] of Object.entries(KEYWORDS)) {
          await d.query("update ph_projects set keywords = $2 where id = $1 and keywords = ''", [id, words])
        }
        await mark('setup-v2')
      }
    })().catch((e) => { _ready = null; throw e })
  }
  return _ready
}

export async function q(text, params = []) {
  await ensureTables()
  return (await db()).query(text, params)
}

// ---------- cleaning input ----------

export const str = (v, max = 500) => String(v ?? '').slice(0, max)
const int = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)))
export const okId = (id) => {
  const s = String(id || '')
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) throw httpError(400, 'Bad id')
  return s
}

function cleanPrint(p) {
  return {
    date: Number(p?.date) || Date.now(),
    printer: str(p?.printer, 120),
    material: str(p?.material, 120),
    nozzle: int(p?.nozzle) ?? 0,
    bed: int(p?.bed) ?? 0,
    supports: SUPPORTS.includes(p?.supports) ? p.supports : 'None',
    result: p?.result === 'Failed' ? 'Failed' : 'Success',
  }
}

const fileRow = (r) => ({
  id: r.id, name: r.name, ext: r.ext, size: Number(r.size), category: r.category,
  tags: Array.isArray(r.tags) ? r.tags : JSON.parse(r.tags || '[]'),
  fav: r.fav, modified: r.modified == null ? null : Number(r.modified), sellable: !!r.sellable, price: r.price == null ? null : Number(r.price), added: Number(r.added),
  prints: Array.isArray(r.prints) ? r.prints : JSON.parse(r.prints || '[]'),
  hasFile: !!r.blob_path,
  projectId: r.project_id || null,
  thumbV: r.has_thumb ? Number(r.thumb_v) || 1 : 0,
  sourcePath: r.source_path || null,
  subfolder: r.subfolder || null,
  inboxPath: r.inbox_path || null,
  trashedAt: r.trashed_at == null ? null : Number(r.trashed_at),
})

// ---------- reads ----------

export async function loadAll() {
  await purgeExpired()
  const [files, printers, materials, projects, meta] = await Promise.all([
    q(`select id, name, ext, size, category, tags, fav, sellable, price, modified, added, prints, blob_path, project_id, source_path, subfolder, inbox_path, trashed_at, thumb_v, (thumb is not null) as has_thumb
       from ph_files order by added desc, id`),
    q('select id, name, nozzle, volume, notes from ph_printers order by sort, id'),
    q('select id, name, nozzle, bed, fan, notes from ph_materials order by sort, id'),
    q('select id, name, category, status, notes, keywords, folders from ph_projects order by sort, id'),
    q("select key, value from ph_meta where key like 'link_%'"),
  ])
  const m = Object.fromEntries(meta.map((r) => [r.key, r.value]))
  const all = files.map(fileRow)
  return {
    files: all.filter((f) => !f.trashedAt),
    trash: all.filter((f) => f.trashedAt).sort((a, b) => b.trashedAt - a.trashedAt),
    link: m.link_seen ? { seen: Number(m.link_seen), status: m.link_status || 'ok', inbox: m.link_inbox || '', scanPending: m.link_scan === '1' } : null,
    printers,
    materials: materials.map((m) => ({ ...m, nozzle: m.nozzle ?? '', bed: m.bed ?? '', fan: m.fan ?? '' })),
    projects: projects.map((p) => ({ ...p, folders: Array.isArray(p.folders) ? p.folders : JSON.parse(p.folders || '[]') })),
    removed: await listRemoved(),
    storage: storageMode(),
    blobAccess: blobAccess(),
    // 'presigned' for stores that sign in with BLOB_STORE_ID (no token)
    uploadMode: blobToken() ? 'token' : 'presigned',
  }
}

// ---------- files ----------

export async function saveFile(body) {
  const id = okId(body.id)
  const tags = [...new Set((Array.isArray(body.tags) ? body.tags : []).map((t) => str(t, 60).toLowerCase().replace(/^#+/, '').trim()).filter(Boolean))]
  const prints = (Array.isArray(body.prints) ? body.prints : []).slice(0, 500).map(cleanPrint)
  const row = [
    id, str(body.name, 300) || 'Untitled',
    EXTS.includes(body.ext) ? body.ext : 'stl',
    Math.max(0, Number(body.size) || 0),
    CATS.includes(body.category) ? body.category : CATS[1],
    JSON.stringify(tags), !!body.fav, Number(body.added) || Date.now(), JSON.stringify(prints),
    body.projectId ? okId(body.projectId) : null,
    body.sourcePath ? str(body.sourcePath, 1000) : null,
    body.projectId && body.subfolder ? cleanFolder(body.subfolder) || null : null,
    !!body.sellable,
    Number(body.price) > 0 ? Math.min(99999, Math.round(Number(body.price) * 100) / 100) : null,
    Number(body.modified) > 0 ? Math.round(Number(body.modified)) : null,
  ]
  // blob_path is only ever set by attachFile, never from the browser.
  const [saved] = await q(
    `insert into ph_files (id, name, ext, size, category, tags, fav, added, prints, project_id, source_path, subfolder, sellable, price, modified)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15)
     on conflict (id) do update set name = excluded.name, ext = excluded.ext, size = excluded.size,
       category = excluded.category, tags = excluded.tags, fav = excluded.fav, sellable = excluded.sellable, price = excluded.price, modified = coalesce(excluded.modified, ph_files.modified), prints = excluded.prints,
       project_id = excluded.project_id, source_path = coalesce(excluded.source_path, ph_files.source_path),
       subfolder = excluded.subfolder, updated_at = now()
     returning id, name, ext, size, category, tags, fav, sellable, price, modified, added, prints, blob_path, project_id, source_path, subfolder, inbox_path, trashed_at, thumb_v, (thumb is not null) as has_thumb`, row)
  return fileRow(saved)
}

export async function attachFile(id, blobPath) {
  id = okId(id)
  if (!String(blobPath || '').startsWith(BLOB_PREFIX + id + '/')) throw httpError(400, 'Bad file path')
  const [old] = await q('select blob_path from ph_files where id = $1', [id])
  if (!old) throw httpError(404, 'File not found')
  await q('update ph_files set blob_path = $2, updated_at = now() where id = $1', [id, blobPath])
  if (old.blob_path && old.blob_path !== blobPath) await removeStored(old.blob_path)
  return { ok: true }
}

// ---------- preview pictures ----------

const THUMB_TYPES = ['image/webp', 'image/png', 'image/jpeg']
const MAX_THUMB_BYTES = 1.5 * 1024 * 1024

export async function saveThumb(body) {
  const id = okId(body.id)
  const type = THUMB_TYPES.includes(body.type) ? body.type : null
  if (!type) throw httpError(400, 'Bad picture type')
  const buf = Buffer.from(String(body.data || ''), 'base64')
  if (!buf.length || buf.length > MAX_THUMB_BYTES) throw httpError(400, 'Picture missing or too large')
  const v = Date.now()
  // sent as hex text so both database drivers handle it the same way
  const rows = await q("update ph_files set thumb = decode($2, 'hex'), thumb_type = $3, thumb_v = $4 where id = $1 returning id", [id, buf.toString('hex'), type, v])
  if (!rows.length) throw httpError(404, 'File not found')
  return { ok: true, thumbV: v }
}

export async function readThumb(id) {
  id = okId(id)
  const [row] = await q("select encode(thumb, 'base64') as b64, thumb_type from ph_files where id = $1", [id])
  if (!row?.b64) throw httpError(404, 'No picture')
  const data = Buffer.from(row.b64, 'base64')
  return { data, type: row.thumb_type || 'image/png' }
}

// Deleting for good. Files from the Mac inbox: the Mac link moves the Mac's
// copy to the Mac's Trash. Other files go on the Mac cleanup list (ph_removed),
// unless macCleanup is false (removing duplicates: the copy that's kept has
// the same name and size, so the Mac cleanup script would trash it too).
export async function deleteFiles(ids, macCleanup = true) {
  ids = (Array.isArray(ids) ? ids : [ids]).slice(0, 1000).map(okId)
  if (!ids.length) return { ok: true, deleted: 0 }
  const rows = await q('delete from ph_files where id = any($1::text[]) returning id, name, ext, size, source_path, blob_path, inbox_path, trash_path', [ids])
  const now = Date.now()
  for (const r of rows) {
    if (r.inbox_path || r.trash_path) {
      await q('delete from ph_link_tasks where file_id = $1 and not done', [r.id])
      await q("insert into ph_link_tasks (file_id, action, from_path, created_at) values ($1, 'purge', $2, $3)", [r.id, r.trash_path || r.inbox_path, now])
    } else if (macCleanup) await q(`insert into ph_removed (id, name, ext, size, source_path, removed_at) values ($1,$2,$3,$4,$5,$6)
             on conflict (id) do update set removed_at = excluded.removed_at, cleaned = false`,
      [r.id, r.name, r.ext, r.size, r.source_path, now])
    if (r.blob_path) await removeStored(r.blob_path)
  }
  return { ok: true, deleted: rows.length }
}
export const deleteFile = (id) => deleteFiles([id])

// ---------- trash ----------

export const TRASH_DAYS = 30

// Into the hub's Trash. A file from the Mac inbox also moves into the
// inbox's _trash folder on the Mac (done by the Mac link).
export async function trashFiles(ids) {
  ids = (Array.isArray(ids) ? ids : []).slice(0, 1000).map(okId)
  if (!ids.length) return { ok: true }
  const now = Date.now()
  const rows = await q('update ph_files set trashed_at = $2, updated_at = now() where id = any($1::text[]) and trashed_at is null returning id, inbox_path', [ids, now])
  for (const r of rows.filter((x) => x.inbox_path)) {
    await q("insert into ph_link_tasks (file_id, action, from_path, to_path, created_at) values ($1, 'trash', $2, $3, $4)",
      [r.id, r.inbox_path, '_trash/' + r.inbox_path, now])
  }
  return { ok: true, trashed: rows.length }
}

export async function restoreFiles(ids) {
  ids = (Array.isArray(ids) ? ids : []).slice(0, 1000).map(okId)
  if (!ids.length) return { ok: true }
  const now = Date.now()
  const rows = await q('update ph_files set trashed_at = null, updated_at = now() where id = any($1::text[]) and trashed_at is not null returning id, inbox_path, trash_path', [ids])
  for (const r of rows) {
    const cancelled = await q("delete from ph_link_tasks where file_id = $1 and action = 'trash' and not done returning id", [r.id])
    if (!cancelled.length && r.trash_path) {
      await q("insert into ph_link_tasks (file_id, action, from_path, to_path, created_at) values ($1, 'restore', $2, $3, $4)",
        [r.id, r.trash_path, r.inbox_path || r.trash_path.replace(/^_trash\//, ''), now])
    }
  }
  return { ok: true, restored: rows.length }
}

export async function emptyTrash() {
  const rows = await q('select id from ph_files where trashed_at is not null')
  return deleteFiles(rows.map((r) => r.id))
}

export async function purgeExpired() {
  const rows = await q('select id from ph_files where trashed_at is not null and trashed_at < $1', [Date.now() - TRASH_DAYS * 86400000])
  if (rows.length) await deleteFiles(rows.map((r) => r.id))
}

export async function listRemoved() {
  const rows = await q('select id, name, ext, size, source_path, removed_at from ph_removed where not cleaned order by removed_at desc')
  return rows.map((r) => ({ id: r.id, name: r.name, ext: r.ext, size: Number(r.size), sourcePath: r.source_path, removedAt: Number(r.removed_at) }))
}

// "done": handled on the Mac.  "keep": leave it on the Mac, drop from the list.
export async function markRemoved(ids) {
  ids = (Array.isArray(ids) ? ids : []).slice(0, 5000).map(okId)
  if (ids.length) await q('update ph_removed set cleaned = true where id = any($1::text[])', [ids])
  return { ok: true }
}

export async function fileForDownload(id) {
  id = okId(id)
  const [row] = await q('select name, ext, blob_path from ph_files where id = $1', [id])
  if (!row?.blob_path) throw httpError(404, 'No file stored for this entry')
  return row
}

// ---------- printers & materials ----------

export async function savePrinter(body) {
  const id = okId(body.id)
  await q(
    `insert into ph_printers (id, name, nozzle, volume, notes, sort) values ($1,$2,$3,$4,$5,$6)
     on conflict (id) do update set name = excluded.name, nozzle = excluded.nozzle, volume = excluded.volume, notes = excluded.notes`,
    [id, str(body.name, 120), str(body.nozzle, 20), str(body.volume, 60), str(body.notes), Date.now()])
  return { ok: true }
}

export async function saveMaterial(body) {
  const id = okId(body.id)
  await q(
    `insert into ph_materials (id, name, nozzle, bed, fan, notes, sort) values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (id) do update set name = excluded.name, nozzle = excluded.nozzle, bed = excluded.bed, fan = excluded.fan, notes = excluded.notes`,
    [id, str(body.name, 120), int(body.nozzle), int(body.bed), int(body.fan), str(body.notes), Date.now()])
  return { ok: true }
}

export async function saveProject(body) {
  const id = okId(body.id)
  await q(
    `insert into ph_projects (id, name, category, status, notes, keywords, folders, sort) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
     on conflict (id) do update set name = excluded.name, category = excluded.category, status = excluded.status,
       notes = excluded.notes, keywords = excluded.keywords, folders = excluded.folders`,
    [id, str(body.name, 160), CATS.includes(body.category) ? body.category : CATS[1],
      STATUSES.includes(body.status) ? body.status : STATUSES[0], str(body.notes, 4000), str(body.keywords, 1000),
      JSON.stringify(cleanFolders(body.folders)), Date.now()])
  return { ok: true }
}

// ---------- folders inside a project ----------

const cleanFolder = (name) => str(name, 60).replace(/\s+/g, ' ').trim()
function cleanFolders(list) {
  const seen = new Set()
  return (Array.isArray(list) ? list : []).map(cleanFolder).filter((f) => {
    const k = f.toLowerCase()
    if (!f || seen.has(k)) return false
    seen.add(k)
    return true
  }).slice(0, 50)
}

// Rename (to = new name) or remove (to = null) a folder: updates the project's
// list and every file in it. Removing a folder keeps its files in the project.
export async function changeFolder({ projectId, from, to }) {
  projectId = okId(projectId)
  from = cleanFolder(from)
  to = to == null ? null : cleanFolder(to)
  const [p] = await q('select folders from ph_projects where id = $1', [projectId])
  if (!p) throw httpError(404, 'Project not found')
  const list = Array.isArray(p.folders) ? p.folders : JSON.parse(p.folders || '[]')
  const next = cleanFolders(to ? list.map((f) => (f === from ? to : f)) : list.filter((f) => f !== from))
  await q('update ph_projects set folders = $2::jsonb where id = $1', [projectId, JSON.stringify(next)])
  await q('update ph_files set subfolder = $3 where project_id = $1 and subfolder = $2', [projectId, from, to || null])
  return { ok: true, folders: next }
}

// Put several files into one folder of their project (null = no folder)
export async function moveToFolder({ ids, subfolder }) {
  ids = (Array.isArray(ids) ? ids : []).slice(0, 2000).map(okId)
  const name = subfolder ? cleanFolder(subfolder) : null
  if (ids.length) await q('update ph_files set subfolder = $2 where id = any($1::text[]) and project_id is not null', [ids, name])
  return { ok: true }
}

const PROFILE_TABLES = { printer: 'ph_printers', material: 'ph_materials', project: 'ph_projects' }
export async function deleteProfile(kind, id) {
  id = okId(id)
  const table = PROFILE_TABLES[kind]
  if (!table) throw httpError(400, 'Unknown list')
  await q(`delete from ${table} where id = $1`, [id])
  if (kind === 'project') await q('update ph_files set project_id = null where project_id = $1', [id])
  return { ok: true }
}

// ---------- file storage ----------

// 'blob' on Vercel, 'local' on a developer's own computer without a Blob
// token (files go into a folder), 'none' if Vercel has no Blob store.
export const blobAccess = () => (process.env.BLOB_ACCESS === 'public' ? 'public' : 'private')
export const LOCAL_FILES = path.resolve(process.cwd(), 'db/.local-files')
export function storageMode() {
  if (blobOn()) return 'blob'
  return process.env.VERCEL ? 'none' : 'local'
}

const localPath = (blobPath) => {
  const file = path.resolve(LOCAL_FILES, blobPath)
  if (!file.startsWith(LOCAL_FILES + path.sep)) throw httpError(400, 'Bad file path')
  return file
}

export async function saveLocal(id, filename, buf) {
  if (storageMode() !== 'local') throw httpError(404, 'Not found')
  id = okId(id)
  const safe = str(filename, 200).replace(/[^A-Za-z0-9._ -]/g, '_') || 'file'
  const blobPath = `${BLOB_PREFIX}${id}/${Date.now()}-${safe}`
  const file = localPath(blobPath)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, buf)
  await attachFile(id, blobPath)
  return { ok: true, pathname: blobPath }
}

// Returns { stream (Node readable), size?, contentType? } for a stored file.
export async function openStored(blobPath) {
  if (!blobOn()) {
    if (storageMode() !== 'local') throw httpError(404, 'Not found')
    const file = localPath(blobPath)
    const s = await stat(file).catch(() => null)
    if (!s) throw httpError(404, 'Not found')
    return { stream: createReadStream(file), size: s.size }
  }
  const { get } = await import('@vercel/blob')
  const { Readable } = await import('stream')
  const res = await get(blobPath, { access: blobAccess(), ...blobAuth() })
  if (!res || res.statusCode !== 200 || !res.stream) throw httpError(404, 'Not found')
  return { stream: Readable.fromWeb(res.stream), size: res.blob?.size }
}

async function removeStored(blobPath) {
  try {
    if (blobOn()) {
      const { del } = await import('@vercel/blob')
      await del(blobPath, blobAuth())
    } else if (storageMode() === 'local') {
      await rm(localPath(blobPath), { force: true })
    }
  } catch { /* an orphaned file is harmless; the database row is what counts */ }
}
