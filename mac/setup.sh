#!/bin/bash
# Print Hub Link setup. Runs when "Print Hub Link Setup" is opened:
#  1. asks which folder is the 3D inbox
#  2. builds the small "Print Hub Link" app in ~/Applications
#  3. has macOS start it every minute, and runs it once now
HUB='__HUB__'
SUP="$HOME/Library/Application Support/PrintHubLink"
APP="$HOME/Applications/Print Hub Link.app"
AGENT_ID="app.printhub.link"
AGENT="$HOME/Library/LaunchAgents/$AGENT_ID.plist"
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
ICLOUD="$HOME/Library/Mobile Documents/com~apple~CloudDocs"

dialog() { # message, buttons (AppleScript list), default button
  osascript - "$1" "$2" "$3" <<'OSA' 2>/dev/null
on run {msg, btns, def}
  set AppleScript's text item delimiters to "|"
  set r to display dialog msg buttons (text items of btns) default button def with title "Print Hub Link" with icon note
  return button returned of r
end run
OSA
}

pretty() { case "$1" in "$HOME"/*) printf '~%s' "${1#"$HOME"}" ;; *) printf '%s' "$1" ;; esac; }

stop_link() {
  launchctl bootout "gui/$(id -u)/$AGENT_ID" 2>/dev/null
  rm -f "$AGENT"
}

if [ -f "$SUP/config" ]; then
  . "$SUP/config"
  answer=$(dialog "Print Hub Link is on.

Inbox: $(pretty "$INBOX")" "Turn off|Pick another folder|Done" "Done")
  case "$answer" in
    "Turn off")
      stop_link
      rm -rf "$APP" "$SUP"
      dialog "Print Hub Link is off. Nothing on this Mac syncs with Print Hub anymore." "OK" "OK" >/dev/null
      exit 0 ;;
    "Pick another folder") ;;
    *) exit 0 ;;
  esac
fi

start="$ICLOUD"; [ -d "$start" ] || start="$HOME"
INBOX=$(osascript - "$start" <<'OSA' 2>/dev/null
on run {startAt}
  return POSIX path of (choose folder with prompt "Pick your 3D inbox folder (in iCloud Drive):" default location (POSIX file startAt))
end run
OSA
) || exit 0
INBOX="${INBOX%/}"
[ -n "$INBOX" ] || exit 0

mkdir -p "$SUP" "$HOME/Applications" "$HOME/Library/LaunchAgents" "$INBOX/_trash"
cp "$RES/link.sh" "$SUP/link.sh" && chmod 755 "$SUP/link.sh"
printf 'HUB=%q\nINBOX=%q\n' "$HUB" "$INBOX" > "$SUP/config"
rm -f "$SUP/last-scan" "$SUP/status"

# The app that does the work. Built here with macOS's own AppleScript tool,
# so it's a normal Mac app: macOS asks once to let it see iCloud Drive.
stop_link
rm -rf "$APP"
osacompile -o "$APP" \
  -e 'try' \
  -e 'do shell script "/bin/bash " & quoted form of (POSIX path of (path to home folder) & "Library/Application Support/PrintHubLink/link.sh")' \
  -e 'end try' || { dialog "Couldn't build the Print Hub Link app." "OK" "OK" >/dev/null; exit 1; }
plutil -replace LSUIElement -bool YES "$APP/Contents/Info.plist"
plutil -replace CFBundleIdentifier -string "$AGENT_ID" "$APP/Contents/Info.plist"
codesign --force --deep --sign - "$APP" >/dev/null 2>&1
xattr -dr com.apple.quarantine "$APP" 2>/dev/null

cat > "$AGENT" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$AGENT_ID</string>
  <key>ProgramArguments</key>
  <array><string>/usr/bin/open</string><string>-g</string><string>-j</string><string>$APP</string></array>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
PLIST
launchctl bootstrap "gui/$(id -u)" "$AGENT" 2>/dev/null || launchctl load "$AGENT" 2>/dev/null

# Wait for the first run (macOS may ask to allow iCloud Drive access first)
for _ in $(seq 1 60); do [ -s "$SUP/status" ] && break; sleep 1; done
case "$(cat "$SUP/status" 2>/dev/null)" in
  ok)
    dialog "Print Hub Link is on.

Every minute it sends new STL, 3MF and OBJ files from $(pretty "$INBOX") to Print Hub, and does what you did in Print Hub (deleted files go into the _trash folder).

It keeps running in the background, also after a restart. Open this setup again to turn it off." "OK" "OK" >/dev/null ;;
  denied)
    answer=$(dialog "One more step: macOS blocked Print Hub Link from seeing your inbox folder.

In System Settings > Privacy & Security > Files and Folders, find Print Hub Link and turn on iCloud Drive." "Open Settings|Later" "Open Settings")
    [ "$answer" = "Open Settings" ] && open "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders" ;;
  *)
    dialog "Print Hub Link is installed but hasn't run yet. Check Print Hub's Mac link page in a minute." "OK" "OK" >/dev/null ;;
esac
exit 0
