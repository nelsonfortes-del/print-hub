// The Mac link: a small app on the Mac that watches the 3D inbox folder.
// Every minute it asks for jobs (move to _trash, restore, empty), sends the
// list of files in the inbox, and uploads the new ones. Everything it reads
// and sends is plain text, one item per line, fields split by tabs, so the
// Mac side is a plain bash script with nothing to install.
import { readFileSync } from 'fs'
import {
  q, str, okId, httpError, saveFile, attachFile, purgeExpired,
  blobToken, blobAuth, blobAccess, storageMode, BLOB_PREFIX, MAX_FILE_BYTES,
} from './printhub.js'
import { autoPlace } from '../../src/autosort.js'

export const LINK_EXTS = ['stl', '3mf', 'obj']
const BLOB_API_VERSION = '13'

// A path inside the inbox: no leading slash, no "..", no tabs or line breaks
export function safePath(p) {
  const s = String(p || '').replace(/^\.\//, '')
  if (!s || s.length > 1000 || s.startsWith('/') || /[\t\r\n\0]/.test(s)) return null
  if (s.split('/').some((seg) => !seg || seg === '.' || seg === '..')) return null
  return s
}

const setMeta = (key, value) => q('insert into ph_meta (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value', [key, String(value)])
const lines = (text) => String(text || '').split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean)

const uid = () => 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
const splitName = (path) => {
  const base = path.split('/').pop()
  const dot = base.lastIndexOf('.')
  return { name: base.slice(0, dot), ext: base.slice(dot + 1).toLowerCase(), folder: path.split('/').slice(0, -1).join('/') }
}

// The Mac checks in: records when, then hands back the jobs to do.
// First line: "ok<TAB>1" if the hub wants a fresh look at the inbox (Sync now).
export async function linkTasks({ status, inbox }) {
  await setMeta('link_seen', Date.now())
  await setMeta('link_status', ['ok', 'denied', 'missing'].includes(status) ? status : 'ok')
  if (inbox) await setMeta('link_inbox', str(inbox, 200))
  await purgeExpired()
  const [scan] = await q("select value from ph_meta where key = 'link_scan'")
  const tasks = await q('select id, action, from_path, to_path from ph_link_tasks where not done order by id limit 200')
  return [`ok\t${scan?.value === '1' ? 1 : 0}`, ...tasks.map((t) => [t.id, t.action, t.from_path, t.to_path].join('\t'))].join('\n') + '\n'
}

// Results from the Mac, one per line: task id, ok | missing | fail, where the file ended up
export async function linkDone(text) {
  for (const line of lines(text)) {
    const [idText, result, newPath] = line.split('\t')
    if (!/^\d+$/.test(idText) || result === 'fail') continue
    const [t] = await q('update ph_link_tasks set done = true where id = $1 and not done returning file_id, action', [idText])
    if (!t?.file_id) continue
    const where = result === 'ok' ? safePath(newPath) : null
    if (t.action === 'trash') {
      await q('update ph_files set trash_path = $2, inbox_path = case when $2::text is null then null else inbox_path end where id = $1', [t.file_id, where])
    } else if (t.action === 'restore') {
      await q('update ph_files set inbox_path = $2, trash_path = null where id = $1', [t.file_id, where])
    }
  }
  return 'ok\n'
}

export async function requestScan() {
  await setMeta('link_scan', '1')
  return { ok: true }
}

// The inbox listing, one file per line: size, last-saved time (ms), path.
// Adds new files to the library and answers with the ones to upload
// ("id<TAB>path"). Files with the same name and size as one already in the
// library are duplicates: they're skipped, or linked to it if it has no Mac copy yet.
export async function linkScan(text) {
  const found = []
  for (const line of lines(text)) {
    const [sizeText, mtimeText, ...rest] = line.split('\t')
    const path = safePath(rest.join('\t'))
    if (!path || path.startsWith('_trash/')) continue
    const { name, ext } = splitName(path)
    if (!name || !LINK_EXTS.includes(ext)) continue
    const size = Number(sizeText)
    if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_BYTES) continue
    found.push({ path, size, modified: Number(mtimeText) || null })
  }
  await setMeta('link_scan', '0')
  if (!found.length) return ''

  const paths = found.map((f) => f.path)
  const known = await q(`select id, inbox_path, blob_path, trashed_at from ph_files
    where inbox_path = any($1::text[]) and (trashed_at is null or trash_path is null)`, [paths])
  const knownBy = new Map(known.map((r) => [r.inbox_path, r]))

  const upload = known.filter((r) => !r.blob_path && r.trashed_at == null).map((r) => [r.id, r.inbox_path])
  const fresh = found.filter((f) => !knownBy.has(f.path))
  if (!fresh.length) return upload.map((u) => u.join('\t')).join('\n')

  const live = await q('select id, lower(name) as name, ext, size, blob_path, inbox_path from ph_files where trashed_at is null')
  const key = (name, ext, size) => `${name.toLowerCase()}.${ext}|${size}`
  const byKey = new Map(live.map((r) => [key(r.name, r.ext, Number(r.size)), r]))
  const projects = (await q('select id, category, keywords, folders from ph_projects')).map((p) => ({ ...p, folders: Array.isArray(p.folders) ? p.folders : JSON.parse(p.folders || '[]') }))

  for (const f of fresh) {
    const { name, ext, folder } = splitName(f.path)
    const k = key(name, ext, f.size)
    const dup = byKey.get(k)
    if (dup) {
      if (!dup.inbox_path) {
        await q('update ph_files set inbox_path = $2 where id = $1', [dup.id, f.path])
        dup.inbox_path = f.path
        if (!dup.blob_path) upload.push([dup.id, f.path])
      }
      continue
    }
    const place = autoPlace(name, folder, projects)
    const id = uid()
    await saveFile({
      id, name, ext, size: f.size, category: place.project?.category || 'Personal', projectId: place.project?.id || null,
      subfolder: place.subfolder, tags: place.tag ? [place.tag] : [], fav: false, prints: [], added: Date.now(),
      stage: /final/i.test(name) ? 'final' : /clean/i.test(name) ? 'cleaned' : 'raw',
      modified: f.modified, sourcePath: f.path,
    })
    await q('update ph_files set inbox_path = $2 where id = $1', [id, f.path])
    byKey.set(k, { id, inbox_path: f.path })
    upload.push([id, f.path])
  }
  return upload.map((u) => u.join('\t')).join('\n')
}

const blobPathFor = (id, path) => `${BLOB_PREFIX}${id}/${path.split('/').pop().replace(/[^A-Za-z0-9._ -]/g, '_')}`

// Where and how the Mac uploads one file: first line the address, then the
// headers to send ("Name: value"). The Mac sends the file with one PUT.
export async function linkTicket(id, origin) {
  id = okId(id)
  const [row] = await q('select inbox_path from ph_files where id = $1', [id])
  if (!row?.inbox_path) throw httpError(404, 'File not found')
  const pathname = blobPathFor(id, row.inbox_path)
  const mode = storageMode()
  if (mode === 'local') {
    const name = pathname.split('/').pop()
    return `${origin}/api/local-file?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}\nContent-Type: application/octet-stream\n`
  }
  if (mode !== 'blob') throw httpError(503, 'File storage (Vercel Blob) is not turned on')
  const common = [
    `x-api-version: ${BLOB_API_VERSION}`,
    `x-vercel-blob-access: ${blobAccess()}`,
    'x-content-type: application/octet-stream',
  ]
  const url = `https://vercel.com/api/blob/?pathname=${encodeURIComponent(pathname)}`
  if (blobToken()) {
    const { generateClientTokenFromReadWriteToken } = await import('@vercel/blob/client')
    const clientToken = await generateClientTokenFromReadWriteToken({
      token: blobToken(), pathname, maximumSizeInBytes: MAX_FILE_BYTES,
      addRandomSuffix: false, allowOverwrite: true, validUntil: Date.now() + 3600000,
    })
    const storeId = blobToken().split('_')[3]
    return [url, `authorization: Bearer ${clientToken}`, `x-vercel-blob-store-id: ${storeId}`, 'x-add-random-suffix: 0', 'x-allow-overwrite: 1', ...common].join('\n') + '\n'
  }
  const { issueSignedToken, presignUrl, parseStoreIdFromDelegationToken } = await import('@vercel/blob')
  const signed = await issueSignedToken({ pathname, operations: ['put'], maximumSizeInBytes: MAX_FILE_BYTES, validUntil: Date.now() + 3600000 })
  const { presignedUrl } = await presignUrl(signed, { pathname, operation: 'put', addRandomSuffix: false, allowOverwrite: true, maximumSizeInBytes: MAX_FILE_BYTES })
  return [presignedUrl, `x-vercel-blob-store-id: ${parseStoreIdFromDelegationToken(signed.delegationToken)}`, ...common].join('\n') + '\n'
}

// The Mac finished uploading: check the file really arrived, then attach it
export async function linkUploaded(id) {
  id = okId(id)
  const [row] = await q('select inbox_path, blob_path from ph_files where id = $1', [id])
  if (!row?.inbox_path) throw httpError(404, 'File not found')
  if (storageMode() === 'local') {
    if (!row.blob_path) throw httpError(409, 'Upload did not arrive')
    return 'ok\n'
  }
  const pathname = blobPathFor(id, row.inbox_path)
  const { head } = await import('@vercel/blob')
  const info = await head(pathname, blobAuth()).catch(() => null)
  if (!info) throw httpError(409, 'Upload did not arrive')
  await attachFile(id, pathname)
  return 'ok\n'
}

// ---------- the Mac app ----------

const macFile = (name) => readFileSync(new URL(`../../mac/${name}`, import.meta.url), 'utf8')

// "Print Hub Link Setup.app" in a zip, with this hub's address built in.
// Opening it installs the link (see mac/setup.sh).
export async function macAppZip(origin) {
  const { zipSync, strToU8 } = await import('fflate')
  const app = 'Print Hub Link Setup.app/Contents/'
  const exe = { os: 3, attrs: (0o100755 << 16) >>> 0 }
  const plain = { os: 3, attrs: (0o100644 << 16) >>> 0 }
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>setup</string>
  <key>CFBundleIdentifier</key><string>app.printhub.link.setup</string>
  <key>CFBundleName</key><string>Print Hub Link Setup</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
</dict>
</plist>
`
  const setup = macFile('setup.sh').replace('__HUB__', origin.replace(/'/g, ''))
  return zipSync({
    [app + 'Info.plist']: [strToU8(plist), plain],
    [app + 'MacOS/setup']: [strToU8(setup), exe],
    [app + 'Resources/link.sh']: [strToU8(macFile('link.sh')), exe],
  })
}

export const hubOrigin = (req) => {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost'
  const proto = req.headers['x-forwarded-proto'] || (/^(localhost|127\.)/.test(host) ? 'http' : 'https')
  return `${String(proto).split(',')[0]}://${String(host).split(',')[0]}`.replace(/[^A-Za-z0-9:/._-]/g, '')
}
