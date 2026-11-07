// Where the synthesised sounds land on disk.
//
// Pure JS, no imports: this module owns the shell command that writes a
// sound, so the Node test suite can run exactly the command the plugin
// runs. The plugin carries no audio files of its own: Sounds.js hands over
// a base64 WAV payload and this module puts it on disk.
//
// The sound directory has to survive a machine with more than one account
// on it, so the writer is careful about two things:
//
//   - the directory it writes into is one only this user can write to, and
//   - the file is created without ever following a symlink, so a symlink
//     planted by another account cannot redirect the write onto a file
//     that belongs to somebody else.
.pragma library

// The shell script that writes one sound.
//
//   $1 - the name of the sound file (e.g. "explosion.wav")
//   $2 - the base64 payload
//
// The script prints the path of the file it wrote on stdout.
var WRITE_SCRIPT = [
  "set -eu",
  "umask 077",
  "",
  "# The name of the sound file, and the payload to write into it.",
  'name="$1"',
  'payload="$2"',
  'case "$name" in',
  '  "" | "." | ".." | */*) exit 2 ;;',
  "esac",
  "",
  "# Makes a private directory under the given base and prints its path.",
  "# The directory is named after our user id, so another account cannot",
  "# own it; if somebody did claim that name anyway, a directory with a",
  "# random name is used instead.",
  "make_dir() {",
  '  base="$1"',
  '  dir="$base/touchtype-$(id -u)"',
  "  if { mkdir -p -m 700 -- \"$dir\" 2>/dev/null &&",
  '       [ -d "$dir" ] && [ ! -L "$dir" ] && [ -O "$dir" ]; }; then',
  '    chmod 700 -- "$dir" 2>/dev/null || true',
  '    printf %s "$dir"',
  "    return 0",
  "  fi",
  '  mktemp -d "$base/touchtype-XXXXXXXXXX" 2>/dev/null',
  "}",
  "",
  "# The private directory: the session's runtime directory when the shell",
  "# has one, the temporary directory otherwise.",
  'dir=""',
  'for base in "${XDG_RUNTIME_DIR:-}" "${TMPDIR:-}" /tmp; do',
  '  [ -n "$base" ] || continue',
  '  [ -d "$base" ] || continue',
  "  case \"$base\" in",
  "    /*) ;;",
  '    *) base="$(cd -- "$base" 2>/dev/null && pwd)" || continue ;;',
  "  esac",
  '  candidate="$(make_dir "$base" || true)"',
  '  if [ -n "$candidate" ]; then',
  '    dir="$candidate"',
  "    break",
  "  fi",
  "done",
  '[ -n "$dir" ] || exit 1',
  "",
  "# The file is created under a random name and moved into place, so it is",
  "# never opened through a symlink and never left half-written.",
  'tmp="$(mktemp "$dir/.sound-XXXXXXXXXX")" || exit 1',
  'if ! printf %s "$payload" | base64 -d > "$tmp"; then',
  '  rm -f -- "$tmp"',
  "  exit 1",
  "fi",
  'if ! mv -fT -- "$tmp" "$dir/$name"; then',
  '  rm -f -- "$tmp"',
  "  exit 1",
  "fi",
  'printf %s "$dir/$name"'
].join("\n")

// The command that writes one sound: the name of the file and the payload.
// The caller reads the path of the written file from the command's stdout.
function writeCommand(name, payload) {
  return ["bash", "-c", WRITE_SCRIPT, "bash", name, payload]
}
