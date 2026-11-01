// Turns whatever was dropped or picked (files, folders, .zip files) into a
// flat list of { file, folder } — folder is the path the file was found in
// ("labels/hits"), or '' for a loose file.

const isJunk = (path) => path.split('/').some((part) => part.startsWith('.') || part === '__MACOSX')
const isZip = (file) => /\.zip$/i.test(file.name)
const dirOf = (path) => path.split('/').slice(0, -1).join('/')

// --- folders dragged in (Chrome, Safari, Edge, Firefox all support this) ---

function readAll(dirReader) {
  // readEntries returns results in chunks; keep asking until it's empty
  return new Promise((resolve, reject) => {
    const out = []
    const next = () => dirReader.readEntries((batch) => {
      if (!batch.length) return resolve(out)
      out.push(...batch)
      next()
    }, reject)
    next()
  })
}

async function walk(entry, out) {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject))
    out.push({ file, path: entry.fullPath.replace(/^\//, '') })
  } else if (entry.isDirectory) {
    for (const child of await readAll(entry.createReader())) await walk(child, out)
  }
}

// Must be called synchronously inside the drop event: the browser forgets
// the dropped items as soon as the event handler returns.
export function grabDropped(dataTransfer) {
  const items = [...(dataTransfer.items || [])]
  const entries = items.map((i) => (i.kind === 'file' && i.webkitGetAsEntry ? i.webkitGetAsEntry() : null))
  if (entries.length && entries.every(Boolean)) {
    return async () => {
      const out = []
      for (const e of entries) await walk(e, out)
      return out
    }
  }
  const files = [...(dataTransfer.files || [])]
  return async () => files.map((file) => ({ file, path: file.name }))
}

// From the file picker (a folder picker fills in webkitRelativePath)
export const fromPicker = (fileList) =>
  [...fileList].map((file) => ({ file, path: file.webkitRelativePath || file.name }))

// --- zips ---

async function unzip(file) {
  const { unzipSync } = await import('fflate')
  const data = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const base = file.name.replace(/\.zip$/i, '')
  return Object.entries(data)
    .filter(([name, bytes]) => !name.endsWith('/') && bytes.length)
    .map(([name, bytes]) => ({ file: new File([bytes], name.split('/').pop()), path: `${base}/${name}` }))
}

// Final list: zips opened up (one level), junk like .DS_Store dropped.
export async function expand(found) {
  const out = []
  const badZips = []
  for (const { file, path } of found) {
    if (isJunk(path)) continue
    if (isZip(file)) {
      try {
        out.push(...(await unzip(file)).filter((x) => !isJunk(x.path)))
      } catch {
        badZips.push(file.name)
      }
    } else {
      out.push({ file, path })
    }
  }
  return { items: out.map(({ file, path }) => ({ file, folder: dirOf(path) })), badZips }
}
