#!/usr/bin/env bash
# The Linux packages on a fresh Ubuntu (.github/workflows/linux.yml, after `npm run dist:linux` and installing the
# .deb): the installed program with Chromium's sandbox, a few checks of build/scripts under Xvfb with software
# rendering, the data folder of an update from Cozystacks or Lesesaal, and the portable archive with the sandbox helper
# set up as START.txt says. Logs and pictures go to $OUT; the exit code is 1 when anything failed.
set -u
OUT=${OUT:-$PWD/ci-out}
TMP=${RUNNER_TEMP:-/tmp}/cozy
mkdir -p "$OUT/shots" "$TMP"
fail=0

# a small library: the sample books in three departments
LIB="$TMP/lib"
mkdir -p "$LIB/Romane" "$LIB/Schach" "$LIB/Sachbuch"
cp app/dev-samples/test.epub "$LIB/Romane/Ein Testbuch - Erika Muster.epub"
cp app/dev-samples/chess.epub "$LIB/Schach/Schach fuer Anfaenger.epub"
cp app/dev-samples/test.pdf "$LIB/Sachbuch/Ein Testheft.pdf"
cp app/dev-samples/sample.md "$LIB/Sachbuch/Notizen.md"

# the lowest graphics settings: the runner has no graphics card, SwiftShader draws every frame on the CPU
LOW='"graphics":{"quality":"low","bloom":false,"shadows":false,"ssao":false,"godrays":false,"resolutionScale":0.5}'
seed() { mkdir -p "$1"; [ -e "$1/settings.json" ] || echo "{$LOW}" > "$1/settings.json"; }

# run <name> <check> [VAR=value …]: one check of build/scripts in its own data folder, with the low settings (a
# settings file without folders still counts as a first start; NOSEED=1 leaves the folder empty)
run() {
  local name=$1 check=$2; shift 2
  echo "== $name"
  local ud="$TMP/ud-$name" a
  for a in "$@"; do case $a in COZYSHELVES_USERDATA=*) ud=${a#*=} ;; esac; done
  [ "${NOSEED:-}" = 1 ] || seed "$ud"
  env SHOW_WINDOW=1 SWIFTSHADER=1 HARNESS_LOAD_TIMEOUT=180000 SHOT_DIR="$OUT/shots/$name" \
    COZYSHELVES_USERDATA="$TMP/ud-$name" "$@" \
    timeout 1500 xvfb-run -a -s "-screen 0 1920x1080x24" node build/screenshot.js "$check" > "$OUT/$name.log" 2>&1
  local code=$?
  grep -E "^(PASS|FAIL|SKIP)|[0-9]+/[0-9]+ passed|SMOKE|script failed|main window not found" "$OUT/$name.log" | cut -c1-400
  if [ $code -ne 0 ] || grep -qE "^FAIL|script failed|main window not found" "$OUT/$name.log" || ! grep -qE "[0-9]+/[0-9]+ passed|SMOKE-OK" "$OUT/$name.log"; then
    echo "!! $name failed (exit $code), last lines:"; tail -n 25 "$OUT/$name.log"; fail=1
  fi
}
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }

echo "== package"
check 'the package is installed' 'dpkg -s cozy-shelves >/dev/null'
check 'the sandbox helper belongs to root and has the setuid bit' '[ "$(stat -c "%a %U" /opt/CozyShelves/chrome-sandbox)" = "4755 root" ]'
check 'the command is on the PATH' '[ "$(readlink -f "$(command -v cozy-shelves)")" = /opt/CozyShelves/cozy-shelves ]'
check 'the menu entry is valid' 'desktop-file-validate /usr/share/applications/cozy-shelves.desktop'
check 'the icon is installed' '[ -s /usr/share/icons/hicolor/512x512/apps/cozy-shelves.png ]'
echo "user namespaces restricted by AppArmor: $(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo n/a)"

INST=(COZYSHELVES_EXE=/opt/CozyShelves/cozy-shelves HARNESS_SANDBOX=1 "COZYSHELVES_BOOKS=$LIB|structured")
run smoke smoke "${INST[@]}"
# the window closes once the world is built: under software rendering a shader compile can hold it for a while
run quit quit-check "${INST[@]}" QUIT_WAIT=30000 QUIT_EXIT_WAIT=60000
# the map on Linux: open, the tiles on the screen (served by the check, never by OpenStreetMap), clicks, search, no
# connection, themes, English. Left out: painting the wall map and the keys (CPU timings), Street View (needs WebGL in
# Google's page, which software rendering does not give)
run worldmap worldmap-check "${INST[@]}" WM_ONLY=open,click,neighbour,city,search,offline,theme,english
# the first start (welcome card, folder choice) is interface logic checked on Windows; its many pictures take too
# long under software rendering

# an update: the folder of a former name under $XDG_CONFIG_HOME stays in use, while the one under the new name
# ("Cozy Shelves", Electron's name of the program) holds no data. From Lesesaal through Cozystacks: Cozystacks kept
# the Lesesaal folder, its own folder only got Electron's "Local State"
CFG="$TMP/cfg"
mkdir -p "$CFG/Lesesaal" "$CFG/Cozystacks"
echo "{\"language\":\"en\",$LOW}" > "$CFG/Lesesaal/settings.json"
echo '{}' > "$CFG/Cozystacks/Local State"
run datadir datadir-check "${INST[@]}" XDG_CONFIG_HOME="$CFG" HARNESS_NO_USERDATA=1 EXPECT_USERDATA="$CFG/Lesesaal"
check 'no settings under the new name after the run' '[ ! -e "$CFG/Cozy Shelves/settings.json" ] && [ ! -e "$CFG/Cozy Shelves/library.json" ]'
# from Cozystacks: its folder comes before an older Lesesaal folder (German there, so a wrong pick fails the language)
CFG2="$TMP/cfg2"
mkdir -p "$CFG2/Lesesaal" "$CFG2/Cozystacks"
echo "{\"language\":\"de\",$LOW}" > "$CFG2/Lesesaal/settings.json"
echo "{\"language\":\"en\",$LOW}" > "$CFG2/Cozystacks/settings.json"
run datadir2 datadir-check "${INST[@]}" XDG_CONFIG_HOME="$CFG2" HARNESS_NO_USERDATA=1 EXPECT_USERDATA="$CFG2/Cozystacks"
check 'no settings under the new name after the second run' '[ ! -e "$CFG2/Cozy Shelves/settings.json" ] && [ ! -e "$CFG2/Cozy Shelves/library.json" ]'

# the portable archive, with the sandbox helper set up the way START.txt says
echo "== portable archive"
mkdir -p "$TMP/tgz"
tar -xzf dist/CozyShelves-*-linux-x64.tar.gz -C "$TMP/tgz"
APPDIR=$(echo "$TMP"/tgz/CozyShelves-*-linux-x64)
check 'the program is executable' '[ -x "$APPDIR/cozy-shelves" ]'
check 'the archive holds the guide and the licenses' '[ -s "$APPDIR/START.txt" ] && [ -s "$APPDIR/COPYING.txt" ] && [ -s "$APPDIR/THIRD_PARTY_LICENSES.txt" ]'
(cd "$APPDIR" && sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox)
run portable smoke COZYSHELVES_EXE="$APPDIR/cozy-shelves" HARNESS_SANDBOX=1 "COZYSHELVES_BOOKS=$LIB|structured"
HOME_ENTRY="$TMP/home"
mkdir -p "$HOME_ENTRY"
check 'install-desktop-entry.sh writes a valid menu entry' 'XDG_DATA_HOME="$HOME_ENTRY" sh "$APPDIR/install-desktop-entry.sh" >/dev/null && desktop-file-validate "$HOME_ENTRY/applications/cozy-shelves.desktop" && grep -q "^Exec=\"$APPDIR/cozy-shelves\" %U" "$HOME_ENTRY/applications/cozy-shelves.desktop"'

echo
if [ $fail -eq 0 ]; then echo "LINUX-TEST passed"; else echo "LINUX-TEST FAILED"; fi
exit $fail
