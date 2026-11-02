/* global Buffer */
import {
  httpError, readRaw, blobToken, databaseUrl,
  loadAll, saveFile, attachFile, deleteFile, deleteFiles, markRemoved, fileForDownload, changeFolder, moveToFolder,
  savePrinter, saveMaterial, saveProject, deleteProfile,
  saveLocal, openStored, MAX_FILE_BYTES, BLOB_PREFIX, saveThumb, readThumb,
} from './_lib/printhub.js'

// /api/state                    GET     files + printers + materials + storage mode
// /api/files                    PUT     save one file's details;  DELETE ?id=
// /api/attach                   POST    {id, pathname} after a file upload finishes
// /api/upload                   POST    Vercel Blob client-upload handshake
// /api/local-file?id=&name=     PUT     raw file body (developer's computer only)
// /api/file?id=                 GET     download the stored file
// /api/delete-files            POST    {ids} delete several (adds them to the Mac cleanup list)
// /api/folder                   POST    {projectId, from, to|null} rename or remove a project folder
// /api/move-files               POST    {ids, subfolder} put files into a folder
// /api/removed                  POST    {ids} mark cleanup-list entries as handled
// /api/thumb?id=&v=             GET     preview picture;  PUT {id, type, data(base64)}
// /api/printers | materials | projects  PUT     save one row;  DELETE ?id=
export default async function handler(req, res) {
  const resource = req.query.resource
  const method = req.method

  // Preview pictures. The address includes the picture's version (?v=), so
  // browsers can keep them for good and still see a new one when it changes.
  if (resource === 'thumb' && method === 'GET') {
    try {
      const { data, type } = await readThumb(req.query.id)
      res.setHeader('content-type', type)
      res.setHeader('cache-control', 'public, max-age=31536000, immutable')
      return res.end(data)
    } catch (e) {
      return res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' })
    }
  }

  // Download a stored file (a plain link, so the browser saves it directly)
  if (resource === 'file' && method === 'GET') {
    try {
      const row = await fileForDownload(req.query.id)
      const { stream, size } = await openStored(row.blob_path)
      const filename = `${row.name}.${row.ext}`.replace(/["\\\r\n]/g, '_')
      res.setHeader('content-type', 'application/octet-stream')
      res.setHeader('content-disposition', `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`)
      res.setHeader('cache-control', 'private, no-store')
      if (size) res.setHeader('content-length', String(size))
      stream.on('error', () => res.destroy())
      return stream.pipe(res)
    } catch (e) {
      return res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' })
    }
  }

  if (!databaseUrl()) return res.status(503).json({ error: 'DATABASE_URL not set' })

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) && !Buffer.isBuffer(req.body) ? req.body : {}

  try {
    if (resource === 'state' && method === 'GET') return res.json(await loadAll())

    if (resource === 'files') {
      if (method === 'PUT') return res.json(await saveFile(body))
      if (method === 'DELETE') return res.json(await deleteFile(req.query.id))
    }

    // Browser-side problems (like a preview that couldn't be made) are written
    // to the Vercel function log so they can be looked up later.
    if (resource === 'log' && method === 'POST') {
      console.warn('[print-hub client]', JSON.stringify(body).slice(0, 2000))
      return res.json({ ok: true })
    }

    if (resource === 'folder' && method === 'POST') return res.json(await changeFolder(body))
    if (resource === 'move-files' && method === 'POST') return res.json(await moveToFolder(body))
    if (resource === 'delete-files' && method === 'POST') return res.json(await deleteFiles(body.ids))
    if (resource === 'removed' && method === 'POST') return res.json(await markRemoved(body.ids))

    if (resource === 'thumb' && method === 'PUT') return res.json(await saveThumb(body))

    if (resource === 'attach' && method === 'POST') return res.json(await attachFile(body.id, body.pathname))

    if (resource === 'upload' && method === 'POST') {
      if (!blobToken()) throw httpError(503, 'File storage (Vercel Blob) is not turned on')
      const { handleUpload } = await import('@vercel/blob/client')
      const result = await handleUpload({
        body,
        request: req,
        token: blobToken(),
        onBeforeGenerateToken: async (pathname) => {
          if (!String(pathname).startsWith(BLOB_PREFIX)) throw httpError(400, 'Bad file path')
          return { maximumSizeInBytes: MAX_FILE_BYTES, addRandomSuffix: true }
        },
      })
      return res.json(result)
    }

    if (resource === 'local-file' && method === 'PUT') {
      const buf = await readRaw(req, MAX_FILE_BYTES)
      return res.json(await saveLocal(req.query.id, String(req.query.name || ''), buf))
    }

    const kinds = { printers: ['printer', savePrinter], materials: ['material', saveMaterial], projects: ['project', saveProject] }
    if (kinds[resource]) {
      const [kind, save] = kinds[resource]
      if (method === 'PUT') return res.json(await save(body))
      if (method === 'DELETE') return res.json(await deleteProfile(kind, req.query.id))
    }

    return res.status(404).json({ error: 'Not found' })
  } catch (e) {
    if (!e.status) console.error(e)
    return res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' })
  }
}
