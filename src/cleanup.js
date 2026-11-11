// Builds the Mac cleanup script: a plain bash file that finds the files you
// deleted in Print Hub (same name AND same size, so it never touches a
// different file that happens to share a name), lists them, asks first, then
// moves them to the Trash with Finder (so "Put Back" still works).

export function cleanupScript(removed) {
  // name <TAB> size, one line per deleted file (tabs and newlines can't be in it)
  const list = removed.map((r) => `${`${r.name}.${r.ext}`.replace(/[\t\r\n]/g, ' ')}\t${Number(r.size) || 0}`).join('\n')
  return `#!/bin/bash
# Print Hub — Mac cleanup
# Moves files you deleted in Print Hub to the Trash.
# It only picks files with the exact same name AND size, shows you the list,
# and asks before touching anything. Trashed files can be put back from the Trash.
#
# How to run: open Terminal, type  bash  and a space, drag this file into the
# Terminal window, then press Return.

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/want.tsv" <<'PRINTHUB_LIST'
${list}
PRINTHUB_LIST

# iCloud Drive lives inside ~/Library, which the home-folder search skips
roots=("$HOME")
[ -d "$HOME/Library/Mobile Documents/com~apple~CloudDocs" ] && roots+=("$HOME/Library/Mobile Documents/com~apple~CloudDocs")

echo "Print Hub cleanup: looking for ${removed.length} file(s) in your home folder and iCloud Drive."
echo "(macOS may ask to let Terminal see Desktop, Documents or Downloads — say OK.)"
echo "Scanning once for 3D files… this can take a minute."

# One pass over every 3D file: size <TAB> path
find "\${roots[@]}" \\( -path "$HOME/Library" -o -path "$HOME/.Trash" -o -name '.*' \\) -prune -o -type f \\
  \\( -iname '*.stl' -o -iname '*.3mf' -o -iname '*.obj' -o -iname '*.step' -o -iname '*.stp' -o -iname '*.gcode' -o -iname '*.gco' \\) \\
  -print0 2>/dev/null | xargs -0 stat -f '%z%t%N' 2>/dev/null > "$TMP/have.tsv"
echo "Checked $(grep -c . "$TMP/have.tsv") 3D file(s) on this Mac."
echo

# Same name (any upper/lower case) and same size
awk -F'\\t' -v missfile="$TMP/missing" '
  NR == FNR { if ($1 != "") want[tolower($1) "\\t" $2] = 1; next }
  {
    path = $0; sub(/^[^\\t]*\\t/, "", path)
    n = path; sub(/.*\\//, "", n); n = tolower(n)
    sub(/\\.stp$/, ".step", n); sub(/\\.gco$/, ".gcode", n)
    k = n "\\t" $1
    if (k in want) { print path; hit[k] = 1 }
  }
  END { m = 0; for (k in want) if (!(k in hit)) m++; print m > missfile }
' "$TMP/want.tsv" "$TMP/have.tsv" > "$TMP/found.txt"
found=()
while IFS= read -r f; do [ -n "$f" ] && found+=("$f"); done < "$TMP/found.txt"
missing=$(cat "$TMP/missing" 2>/dev/null || echo 0)

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
