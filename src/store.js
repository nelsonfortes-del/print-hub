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

export const loadAll = () => call('state')
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
    const { upload } = await import('@vercel/blob/client')
    const blob = await upload(`printhub/${id}/${safe}`, file, {
      access: 'private',
      handleUploadUrl: '/api/upload',
      multipart: file.size > 20 * 1024 * 1024,
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
