#!/bin/bash
# Print Hub Link: runs every minute on the Mac (started by the
# "Print Hub Link" app). Does the hub's jobs on the inbox folder, then sends
# new 3D files up. Settings: ~/Library/Application Support/PrintHubLink/config

SUP="$HOME/Library/Application Support/PrintHubLink"
. "$SUP/config" || exit 1
TRASH_DIR="$HOME/.Trash"
LOG="$SUP/link.log"
TMP="$SUP/tmp"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }
api() { curl -fsS --max-time 60 --retry 2 "$@"; }
text_post() { api -X POST -H 'Content-Type: text/plain; charset=utf-8' --data-binary @- "$@"; }

if ! mkdir "$SUP/lock" 2>/dev/null; then
  [ -n "$(find "$SUP/lock" -maxdepth 0 -mmin +60 2>/dev/null)" ] || exit 0
  rm -rf "$SUP/lock"; mkdir "$SUP/lock" || exit 0
fi
trap 'rm -rf "$SUP/lock" "$TMP"' EXIT
mkdir -p "$TMP"
[ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 2000 ] && tail -n 1000 "$LOG" > "$LOG.old" && mv "$LOG.old" "$LOG"

urlenc() {
  local LC_ALL=C s="$1" out="" c i
  for ((i = 0; i < ${#s}; i++)); do
    c="${s:i:1}"
    case "$c" in [A-Za-z0-9._~-]) out+="$c" ;; *) out+=$(printf '%%%02X' "'$c") ;; esac
  done
  printf '%s' "$out"
}

# Removes a folder left empty by a move (never the inbox or its _trash)
tidy() { case "$1" in "$INBOX"|"$INBOX/_trash") ;; *) rmdir "$1" 2>/dev/null ;; esac; }

status=ok
if [ ! -d "$INBOX" ]; then status=missing
elif ! ls "$INBOX" >/dev/null 2>&1; then status=denied
fi
echo "$status" > "$SUP/status"

tasks=$(api "$HUB/api/link-tasks?status=$status&inbox=$(urlenc "$(basename "$INBOX")")") || { log "can't reach $HUB"; exit 0; }
[ "$status" = ok ] || { log "inbox $status: $INBOX"; exit 0; }

# A path inside the inbox is safe: not empty, no leading /, no .. parts
safe() { case "/$1/" in *//*|*/../*|*/./*) return 1 ;; esac; }

# "a/b.stl" -> "a/b (2).stl" until the name is free
free_name() {
  local p="$1" base ext n=2
  [ -e "$p" ] || { printf '%s' "$p"; return; }
  base="${p%.*}"; ext="${p##*.}"
  [ "$base" = "$p" ] && ext="" || ext=".$ext"
  while [ -e "$base ($n)$ext" ]; do n=$((n + 1)); done
  printf '%s' "$base ($n)$ext"
}

# Moves inbox/$1 to inbox/$2; prints where it ended up (inside the inbox)
move_in_inbox() {
  local src="$INBOX/$1" dst
  [ -e "$src" ] || return 2
  dst=$(free_name "$INBOX/$2")
  mkdir -p "$(dirname "$dst")" && mv -n "$src" "$dst" || return 1
  tidy "$(dirname "$src")"
  printf '%s' "${dst#"$INBOX"/}"
}

scan_wanted=0
results=""
while IFS=$'\t' read -r tid action from to; do
  [ -n "$tid" ] || continue
  if [ "$tid" = ok ]; then scan_wanted="$action"; continue; fi
  if ! safe "$from" || { [ -n "$to" ] && ! safe "$to"; }; then results+="$tid	fail	"$'\n'; continue; fi
  case "$action" in
    trash|restore)
      where=$(move_in_inbox "$from" "$to"); rc=$?
      ;;
    purge)
      if [ -e "$INBOX/$from" ]; then
        dst=$(free_name "$TRASH_DIR/$(basename "$from")")
        mv -n "$INBOX/$from" "$dst"; rc=$?
        tidy "$(dirname "$INBOX/$from")"
      else rc=2; fi
      where=""
      ;;
    *) continue ;;
  esac
  case $rc in
    0) results+="$tid	ok	$where"$'\n'; log "$action: $from -> ${where:-Trash}" ;;
    2) results+="$tid	missing	"$'\n'; log "$action: $from was already gone" ;;
    *) results+="$tid	fail	"$'\n'; log "$action failed: $from" ;;
  esac
done <<< "$tasks"
[ -n "$results" ] && printf '%s' "$results" | text_post "$HUB/api/link-done" >/dev/null

# Inbox listing: size, last saved (ms), path. Skips _trash, hidden files and
# files still being downloaded (changed in the last 20 seconds).
now=$(date +%s)
listing=$(cd "$INBOX" && find . \( -path ./_trash -o -name '.?*' \) -prune -o -type f \
  \( -iname '*.stl' -o -iname '*.3mf' -o -iname '*.obj' \) -print0 2>/dev/null \
  | xargs -0 stat -f '%z	%m	%N' 2>/dev/null \
  | while IFS=$'\t' read -r size mtime path; do
      [ $((now - mtime)) -ge 20 ] || continue
      printf '%s\t%s000\t%s\n' "$size" "$mtime" "${path#./}"
    done | sort -t $'\t' -k3)
sig=$(printf '%s' "$listing" | md5 -q)
[ "$scan_wanted" = 1 ] || [ "$sig" != "$(cat "$SUP/last-scan" 2>/dev/null)" ] || exit 0

uploads=$(printf '%s\n' "$listing" | text_post "$HUB/api/link-scan") || { log "scan failed"; exit 0; }
failed=0
while IFS=$'\t' read -r id path; do
  [ -n "$id" ] || continue
  safe "$path" && [ -f "$INBOX/$path" ] || continue
  api -X POST "$HUB/api/link-ticket?id=$(urlenc "$id")" -d '' > "$TMP/ticket" || { failed=1; log "no upload ticket for $path"; continue; }
  url=$(head -n 1 "$TMP/ticket")
  tail -n +2 "$TMP/ticket" > "$TMP/headers"
  if curl -fsS --retry 2 -X PUT -H @"$TMP/headers" -T "$INBOX/$path" "$url" >/dev/null \
    && api -X POST "$HUB/api/link-uploaded?id=$(urlenc "$id")" -d '' >/dev/null; then
    log "sent: $path"
  else
    failed=1; log "upload failed: $path"
  fi
done <<< "$uploads"
[ $failed = 0 ] && printf '%s' "$sig" > "$SUP/last-scan"
exit 0
