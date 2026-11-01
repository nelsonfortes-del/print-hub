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

export const CATS = ['Functional parts', 'Household', 'Tools']
const EXTS = ['stl', '3mf', 'obj', 'step', 'gcode']
const SUPPORTS = ['None', 'Buildplate only', 'Everywhere']
export const MAX_FILE_BYTES = 500 * 1024 * 1024
export const BLOB_PREFIX = 'printhub/'

const SEED_PRINTERS = [
  ['p1', 'Prusa MK4', '0.4', '250×210×220', 'Textured PEI sheet'],
  ['p2', 'Bambu P1S', '0.4', '256×256×256', ''],
]
const SEED_MATERIALS = [
  ['m1', 'PLA', 215, 60, 100, 'Default for most parts'],
  ['m2', 'PETG', 240, 80, 40, 'Use glue stick on smooth PEI'],
  ['m3', 'ABS', 250, 100, 0, 'Enclosure required'],
  ['m4', 'ASA', 255, 100, 10, 'Outdoor parts'],
  ['m5', 'TPU', 225, 50, 50, 'Print slow, 20 mm/s'],
]

// ---------- tables ----------

// Creates the tables from db/schema.sql and fills
// in starter printers and materials the very first time.
let _ready = null
function ensureTables() {
  if (!_ready) {
    _ready = (async () => {
      const d = await db()
      const [{ t }] = await d.query("select to_regclass('public.ph_meta') as t")
      if (!t) {
        const text = readFileSync(new URL('../../db/schema.sql', import.meta.url), 'utf8')
        const statements = text.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
          .split(';').map((s) => s.trim()).filter(Boolean)
        for (const st of statements) await d.query(st)
      }
      const seeded = await d.query("select 1 from ph_meta where key = 'seeded'")
      if (!seeded.length) {
        for (const [i, p] of SEED_PRINTERS.entries()) {
          await d.query('insert into ph_printers (id, name, nozzle, volume, notes, sort) values ($1,$2,$3,$4,$5,$6) on conflict do nothing', [...p, i])
        }
        for (const [i, m] of SEED_MATERIALS.entries()) {
          await d.query('insert into ph_materials (id, name, nozzle, bed, fan, notes, sort) values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing', [...m, i])
        }
        await d.query("insert into ph_meta (key, value) values ('seeded', $1) on conflict do nothing", [new Date().toISOString()])
      }
    })().catch((e) => { _ready = null; throw e })
  }
  return _ready
}

async function q(text, params = []) {
  await ensureTables()
  return (await db()).query(text, params)
}

// ---------- cleaning input ----------

const str = (v, max = 500) => String(v ?? '').slice(0, max)
const int = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)))
const okId = (id) => {
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
  fav: r.fav, added: Number(r.added),
  prints: Array.isArray(r.prints) ? r.prints : JSON.parse(r.prints || '[]'),
  hasFile: !!r.blob_path,
})

// ---------- reads ----------

export async function loadAll() {
  const [files, printers, materials] = await Promise.all([
    q('select * from ph_files order by added desc, id'),
    q('select id, name, nozzle, volume, notes from ph_printers order by sort, id'),
    q('select id, name, nozzle, bed, fan, notes from ph_materials order by sort, id'),
  ])
  return {
    files: files.map(fileRow),
    printers,
    materials: materials.map((m) => ({ ...m, nozzle: m.nozzle ?? '', bed: m.bed ?? '', fan: m.fan ?? '' })),
    storage: storageMode(),
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
    CATS.includes(body.category) ? body.category : CATS[0],
    JSON.stringify(tags), !!body.fav, Number(body.added) || Date.now(), JSON.stringify(prints),
  ]
  // blob_path is only ever set by attachFile, never from the browser.
  const [saved] = await q(
    `insert into ph_files (id, name, ext, size, category, tags, fav, added, prints)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb)
     on conflict (id) do update set name = excluded.name, ext = excluded.ext, size = excluded.size,
       category = excluded.category, tags = excluded.tags, fav = excluded.fav, prints = excluded.prints,
       updated_at = now()
     returning *`, row)
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

export async function deleteFile(id) {
  id = okId(id)
  const [row] = await q('delete from ph_files where id = $1 returning blob_path', [id])
  if (row?.blob_path) await removeStored(row.blob_path)
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

export async function deleteProfile(kind, id) {
  id = okId(id)
  await q(`delete from ${kind === 'printer' ? 'ph_printers' : 'ph_materials'} where id = $1`, [id])
  return { ok: true }
}

// ---------- file storage ----------

// 'blob' on Vercel, 'local' on a developer's own computer without a Blob
// token (files go into a folder), 'none' if Vercel has no Blob store.
export const blobAccess = () => (process.env.BLOB_ACCESS === 'public' ? 'public' : 'private')
export const LOCAL_FILES = path.resolve(process.cwd(), 'db/.local-files')
export function storageMode() {
  if (blobToken()) return 'blob'
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
  if (!blobToken()) {
    if (storageMode() !== 'local') throw httpError(404, 'Not found')
    const file = localPath(blobPath)
    const s = await stat(file).catch(() => null)
    if (!s) throw httpError(404, 'Not found')
    return { stream: createReadStream(file), size: s.size }
  }
  const { get } = await import('@vercel/blob')
  const { Readable } = await import('stream')
  const res = await get(blobPath, { access: blobAccess(), token: blobToken() })
  if (!res || res.statusCode !== 200 || !res.stream) throw httpError(404, 'Not found')
  return { stream: Readable.fromWeb(res.stream), size: res.blob?.size }
}

async function removeStored(blobPath) {
  try {
    if (blobToken()) {
      const { del } = await import('@vercel/blob')
      await del(blobPath, { token: blobToken() })
    } else if (storageMode() === 'local') {
      await rm(localPath(blobPath), { force: true })
    }
  } catch { /* an orphaned file is harmless; the database row is what counts */ }
}
