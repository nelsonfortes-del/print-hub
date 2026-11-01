// Auto-sort: picks a project for an uploaded file from its name.
//
// Each project has comma-separated keywords. A keyword matches when it starts
// a word in the file name ("hook" matches "Cage_Hooks_v2" but "hit" doesn't
// match "white"). If several projects match, the longest keyword wins, since
// it's the most specific ("trading card" beats "organizer").

// "CageHook_v2-FINAL.stl" -> "cage hook v2 final stl"
export function normalize(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // å -> a
    .replace(/([a-z])([A-Z])/g, '$1 $2')              // camelCase -> camel Case
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')              // v2 stays together below
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b([a-z]) (\d)/g, '$1$2')               // "v 2" -> "v2"
    .trim()
}

export const keywordList = (keywords) =>
  String(keywords || '').split(',').map(normalize).filter(Boolean)

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Returns { project, keyword } or null.
export function matchProject(fileName, projects) {
  const name = ' ' + normalize(fileName) + ' '
  let best = null
  for (const p of projects) {
    for (const kw of keywordList(p.keywords)) {
      if (!new RegExp(' ' + escape(kw)).test(name)) continue
      if (!best || kw.length > best.keyword.length) best = { project: p, keyword: kw }
    }
  }
  return best
}
