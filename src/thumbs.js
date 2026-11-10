// Makes a preview picture for a 3D file, right in the browser.
//  1. 3MF: use the picture saved inside the file (the one the file itself
//     names as its thumbnail, else a slicer plate picture under Metadata/).
//  2. G-code from Orca-based slicers (Anycubic Slicer Next, Bambu, Orca):
//     use the preview picture embedded in the file's comments.
//  3. Otherwise draw the model with three.js (STL, OBJ, 3MF, G-code).
// STEP files can't be drawn here, so they get no picture (returns null).
// Returns a Blob (WebP, or PNG/JPEG for embedded pictures) or null.

export const W = 640
export const H = 400
const MAX_RENDER_BYTES = 80 * 1024 * 1024
const MAX_GCODE_RENDER_BYTES = 25 * 1024 * 1024

export const canThumb = (ext) => ['stl', 'obj', '3mf', 'gcode'].includes(ext)

// Returns a picture Blob, or throws an Error whose message says why not
// (shown in the file panel so problems are visible).
export async function makeThumb(blob, ext) {
  if (ext === 'step') throw new Error("STEP files can't be drawn in the browser")
  if (ext === '3mf') {
    const pic = await picFrom3mf(blob).catch(() => null)
    if (pic) return pic
  }
  if (ext === 'gcode') {
    const pic = await picFromGcode(blob).catch(() => null)
    if (pic) return pic
    if (blob.size > MAX_GCODE_RENDER_BYTES) throw new Error('G-code over 25 MB with no built-in preview is too big to draw')
  }
  if (!canThumb(ext)) throw new Error(`No preview for .${ext} files`)
  if (blob.size > MAX_RENDER_BYTES) throw new Error('File is over 80 MB, too big to draw in the browser')
  try {
    const pic = await render(blob, ext)
    if (!pic) throw new Error('The browser returned an empty picture')
    return pic
  } catch (e) {
    const msg = String(e?.message || e)
    if (/webgl|context/i.test(msg)) throw new Error('3D drawing (WebGL) is turned off or unavailable in this browser')
    throw new Error(`Couldn't draw this file: ${msg}`)
  }
}

// ---------- pictures already inside the file ----------

const IMG_RE = /\.(png|jpe?g)$/i
const SKIP_IMG_RE = /_small|pick_|top_|_no_light/i
const MAX_EMBED_BYTES = 1.4 * 1024 * 1024

export function pick3mfPicture(entries) {
  const byLower = new Map(Object.keys(entries).map((n) => [n.toLowerCase(), n]))
  const relsName = byLower.get('_rels/.rels')
  if (relsName) {
    const xml = new TextDecoder().decode(entries[relsName])
    for (const m of xml.matchAll(/<Relationship\b[^>]*>/gi)) {
      if (!/Type="[^"]*\/thumbnail"/i.test(m[0])) continue
      const target = /Target="([^"]+)"/i.exec(m[0])?.[1]
      const name = target && byLower.get(decodeURIComponent(target).replace(/^\//, '').toLowerCase())
      if (name && entries[name].length) return name
    }
  }
  const imgs = Object.keys(entries).filter((n) => IMG_RE.test(n) && !SKIP_IMG_RE.test(n) && entries[n].length)
  if (!imgs.length) return null
  // plate_1 (Bambu/Orca/Anycubic) or thumbnail (Prusa/Cura); else the biggest
  return imgs.find((n) => /plate_1\.(png|jpe?g)$/i.test(n)) || imgs.find((n) => /(^|\/)thumbnail\.(png|jpe?g)$/i.test(n))
    || imgs.sort((a, b) => entries[b].length - entries[a].length)[0]
}

export const imageType = (bytes) =>
  bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png'
    : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg'
      : null

async function picFrom3mf(blob) {
  const { unzipSync } = await import('fflate')
  const data = new Uint8Array(await blob.arrayBuffer())
  const wanted = (n) => n.toLowerCase() === '_rels/.rels' || (IMG_RE.test(n) && /^(metadata|auxiliaries)\//i.test(n))
  let entries = unzipSync(data, { filter: (f) => wanted(f.name) })
  let name = pick3mfPicture(entries)
  if (!name) {
    // the official thumbnail may live outside Metadata/
    entries = { ...entries, ...unzipSync(data, { filter: (f) => IMG_RE.test(f.name) && !wanted(f.name) }) }
    name = pick3mfPicture(entries)
  }
  if (!name) return null
  const bytes = entries[name]
  const type = imageType(bytes)
  if (!type) return null
  const pic = new Blob([bytes], { type })
  return pic.size > MAX_EMBED_BYTES ? shrink(pic) : pic
}

async function shrink(pic) {
  const bmp = await createImageBitmap(pic)
  const scale = Math.min(1, W / bmp.width, H / bmp.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.88))
}

async function picFromGcode(blob) {
  // the picture sits in the first part of the file
  const head = await blob.slice(0, 4 * 1024 * 1024).text()
  const re = /; thumbnail(_JPG|_PNG)? begin (\d+)x(\d+) \d+\r?\n([\s\S]*?); thumbnail(?:_JPG|_PNG)? end/g
  let best = null
  for (const m of head.matchAll(re)) {
    const size = Number(m[2]) * Number(m[3])
    if (!best || size > best.size) best = { size, jpg: m[1] === '_JPG', b64: m[4].replace(/^;\s?/gm, '').replace(/\s+/g, '') }
  }
  if (!best) return null
  const bytes = Uint8Array.from(atob(best.b64), (c) => c.charCodeAt(0))
  return new Blob([bytes], { type: best.jpg ? 'image/jpeg' : 'image/png' })
}

// ---------- drawing the model ----------

async function load(blob, ext, THREE) {
  if (ext === 'stl') {
    const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js')
    const geo = new STLLoader().parse(await blob.arrayBuffer())
    return { object: new THREE.Mesh(geo), zUp: true }
  }
  if (ext === 'obj') {
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js')
    return { object: new OBJLoader().parse(await blob.text()), zUp: false }
  }
  if (ext === '3mf') {
    const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js')
    return { object: new ThreeMFLoader().parse(await blob.arrayBuffer()), zUp: false } // loader already turns Z-up into Y-up
  }
  if (ext === 'gcode') {
    const { GCodeLoader } = await import('three/examples/jsm/loaders/GCodeLoader.js')
    const group = new GCodeLoader().parse(await blob.text())
    group.children = group.children.filter((c) => c.name !== 'travel') // only the printed lines
    return { object: group, zUp: false, lines: true }
  }
  throw new Error('Unsupported file')
}

async function render(blob, ext) {
  const THREE = await import('three')
  const { object, zUp, lines } = await load(blob, ext, THREE)

  // one color for every surface: light blue, softly shaded
  const mat = new THREE.MeshStandardMaterial({ color: 0xa9c8ff, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide })
  const lineMat = new THREE.LineBasicMaterial({ color: 0xa9c8ff })
  object.traverse((o) => {
    if (o.isMesh) {
      // many STL files store blank or wrong surface directions; always redo them
      o.geometry.deleteAttribute('normal')
      o.geometry.computeVertexNormals()
      o.material = mat
    } else if (o.isLine || o.isLineSegments) {
      o.material = lineMat
    }
  })
  if (zUp) object.rotation.x = -Math.PI / 2

  const scene = new THREE.Scene()
  scene.add(object)
  object.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) throw new Error('Empty model')
  const center = box.getCenter(new THREE.Vector3())
  object.position.sub(center)
  const radius = box.getSize(new THREE.Vector3()).length() / 2

  scene.add(new THREE.HemisphereLight(0xffffff, 0x1a2a44, lines ? 2 : 1.6))
  const key = new THREE.DirectionalLight(0xffffff, 1.8)
  key.position.set(1, 1.6, 1.2)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xbcd4ff, 0.6)
  fill.position.set(-1.2, 0.4, -0.8)
  scene.add(fill)

  // three-quarter view from above, model fills the frame
  const fov = 30
  const camera = new THREE.PerspectiveCamera(fov, W / H, radius / 100, radius * 100)
  const dir = new THREE.Vector3(1, 0.85, 1.1).normalize()
  camera.position.copy(dir.clone().multiplyScalar(radius * 4))
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  // zoom so the model's corners just fit, with a small margin
  const corners = []
  const b = new THREE.Box3().setFromObject(object)
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) corners.push(new THREE.Vector3(x, y, z))
  const tanV = Math.tan(THREE.MathUtils.degToRad(fov / 2))
  const tanH = tanV * camera.aspect
  const toCam = camera.matrixWorldInverse
  let dist = 0
  for (const c of corners) {
    const v = c.clone().applyMatrix4(toCam) // camera looks down -z
    const depth = -v.z - radius * 4         // distance in front of the target plane
    dist = Math.max(dist, Math.abs(v.x) / (tanH * 0.9) - depth, Math.abs(v.y) / (tanV * 0.88) - depth)
  }
  camera.position.copy(dir.multiplyScalar(dist))
  camera.near = dist / 100
  camera.far = dist * 100
  camera.updateProjectionMatrix()

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(W, H, false)
  renderer.setClearColor(0x000000, 0) // see-through, so it sits on the card color
  try {
    renderer.render(scene, camera)
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.88))
  } finally {
    renderer.dispose()
    renderer.forceContextLoss()
    mat.dispose()
    lineMat.dispose()
    object.traverse((o) => o.geometry?.dispose())
  }
}
