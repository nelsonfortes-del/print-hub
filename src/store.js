// Print Hub data: the database (through /api) holds the catalog, printers
// and materials; the 3D files go to online file storage (Vercel Blob).

async function call(path, opts = {}) {
  const res = await fetch('/api/' + path, {
    ...opts,
    headers: { ...(opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status })
  return data
}
const json = (method, body) => ({ method, body: JSON.stringify(body) })

// The Blob store is private unless the server says otherwise (BLOB_ACCESS)
let blobAccess = 'private'
let uploadMode = 'token' // 'presigned' when the store has no token (BLOB_STORE_ID)
export const loadAll = () => call('state').then((d) => {
  blobAccess = d.blobAccess || 'private'
  uploadMode = d.uploadMode || 'token'
  return d
})
export const saveFile = (file) => call('files', json('PUT', file))
export const deleteFile = (id) => call('files?id=' + encodeURIComponent(id), { method: 'DELETE' })
export const saveProfile = (kind, row) => call(kind, json('PUT', row))
export const deleteProfile = (kind, id) => call(`${kind}?id=${encodeURIComponent(id)}`, { method: 'DELETE' })

export const downloadUrl = (id) => `/api/file?id=${encodeURIComponent(id)}`

// Sends the 3D file itself. 'blob' goes straight from the browser to Vercel
// Blob (so large files are fine); 'local' is a developer's own computer.
export async function uploadFile(storage, id, file, onProgress) {
  const safe = file.name.replace(/[^A-Za-z0-9._ -]/g, '_')
  if (storage === 'blob') {
    const { upload, uploadPresigned } = await import('@vercel/blob/client')
    const blob = await (uploadMode === 'presigned' ? uploadPresigned : upload)(`printhub/${id}/${safe}`, file, {
      access: blobAccess,
      handleUploadUrl: '/api/upload',
      // presigned uploads go up in one piece; the token kind splits big files
      multipart: uploadMode !== 'presigned' && file.size > 20 * 1024 * 1024,
      onUploadProgress: onProgress ? (e) => onProgress(e.percentage) : undefined,
    })
    await call('attach', json('POST', { id, pathname: blob.pathname }))
    return
  }
  if (storage === 'local') {
    await call(`local-file?id=${encodeURIComponent(id)}&name=${encodeURIComponent(safe)}`, {
      method: 'PUT', body: file, headers: { 'Content-Type': 'application/octet-stream' },
    })
    return
  }
  throw new Error('File storage is not turned on')
}

// ---------- preview pictures ----------

export const thumbUrl = (id, v) => `/api/thumb?id=${encodeURIComponent(id)}&v=${v}`

export async function saveThumb(id, blob) {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return call('thumb', json('PUT', { id, type: blob.type || 'image/png', data: btoa(bin) }))
}

export async function fetchStoredFile(id) {
  const res = await fetch(downloadUrl(id))
  if (!res.ok) throw new Error(`Download failed (${res.status})`)
  return res.blob()
}

// ---------- deleting + Mac cleanup list ----------

export const deleteFiles = (ids, macCleanup = true) => call('delete-files', json('POST', { ids, macCleanup }))
export const markRemoved = (ids) => call('removed', json('POST', { ids }))

// Sends a problem report to the server log (never blocks or throws)
export function reportProblem(info) {
  try {
    fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...info, browser: navigator.userAgent, at: new Date().toISOString() }) }).catch(() => {})
  } catch { /* ignore */ }
}

// ---------- folders inside a project ----------

export const changeFolder = (projectId, from, to) => call('folder', json('POST', { projectId, from, to }))
export const moveToFolder = (ids, subfolder) => call('move-files', json('POST', { ids, subfolder }))
