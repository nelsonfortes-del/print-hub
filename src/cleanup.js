// Builds the Mac cleanup script: a plain bash file that finds the files you
// deleted in Print Hub (same name AND same size, so it never touches a
// different file that happens to share a name), lists them, asks first, then
// moves them to the Trash with Finder (so "Put Back" still works).

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`

export function cleanupScript(removed) {
  const checks = removed.map((r) => `check ${q(`${r.name}.${r.ext}`)} ${Number(r.size) || 0} ${q(r.sourcePath || '')}`).join('\n')
  return `#!/bin/bash
# Print Hub — Mac cleanup
# Moves files you deleted in Print Hub to the Trash.
# It only picks files with the exact same name AND size, shows you the list,
# and asks before touching anything. Trashed files can be put back from the Trash.
#
# How to run: open Terminal, type  bash  and a space, drag this file into the
# Terminal window, then press Return.

found=()
missing=0
# iCloud Drive lives inside ~/Library, which the home-folder search skips
roots=()
[ -d "$HOME/Library/Mobile Documents/com~apple~CloudDocs" ] && roots+=("$HOME/Library/Mobile Documents/com~apple~CloudDocs")

check() {
  local name="$1" size="$2" hit=0
  while IFS= read -r -d '' f; do
    if [ "$(stat -f%z "$f" 2>/dev/null)" = "$size" ]; then found+=("$f"); hit=1; fi
  done < <(find "$HOME" "\${roots[@]}" \\( -path "$HOME/Library" -o -path "$HOME/.Trash" -o -name '.*' \\) -prune -o -type f -name "$(printf '%s' "$name" | sed 's/[][*?\\\\]/\\\\&/g')" -print0 2>/dev/null)
  [ $hit = 0 ] && missing=$((missing + 1))
}

echo "Print Hub cleanup: looking for ${removed.length} file(s) in your home folder and iCloud Drive…"
echo "(macOS may ask to let Terminal see Desktop, Documents or Downloads — say OK.)"
echo
${checks}

if [ \${#found[@]} = 0 ]; then
  echo "Nothing to clean up: none of those files are on this Mac (already gone, or renamed)."
  exit 0
fi

echo "Found \${#found[@]} file(s):"
for f in "\${found[@]}"; do echo "  \${f/#"$HOME"/\\~}"; done
[ $missing -gt 0 ] && echo "($missing deleted file(s) weren't found on this Mac.)"
echo
read -r -p "Move these to the Trash? (y/n) " answer
if [ "$answer" != "y" ] && [ "$answer" != "Y" ]; then echo "Nothing changed."; exit 0; fi

moved=0
for f in "\${found[@]}"; do
  if osascript -e 'on run {p}' -e 'tell application "Finder" to delete (POSIX file p as alias)' -e 'end run' "$f" >/dev/null 2>&1; then
    moved=$((moved + 1))
  else
    echo "Couldn't move: \${f/#"$HOME"/\\~}"
  fi
done
echo
echo "Done: moved $moved file(s) to the Trash."
echo "Back in Print Hub, press \\"Mark all as done\\" on the Mac cleanup page."
`
}

export function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  // Safari only downloads from a link that's on the page, and needs the URL a while
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
