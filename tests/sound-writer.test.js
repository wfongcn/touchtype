const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { loadScript } = require("./helpers/loadScript.js");

// The plugin writes its sounds through SoundWriter.js, so the tests can run
// exactly the command the shell runs.
const writer = loadScript("SoundWriter.js");

// A stand-in for the WAV payload Sounds.js produces.
const PAYLOAD = Buffer.from("RIFF0000WAVEfmt ").toString("base64");

// A private directory standing in for the session's runtime directory, and
// one standing in for the temporary directory.
function sandbox(t, base = os.tmpdir()) {
  const root = fs.mkdtempSync(path.join(base, "touchtype-sound-writer-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "runtime"));
  fs.mkdirSync(path.join(root, "tmp"));
  return root;
}

// The first uid of the range this user may use inside a user namespace, or
// null when there is none.
function subuidBase() {
  let entries;
  try {
    entries = fs.readFileSync("/etc/subuid", "utf8").split("\n");
  } catch {
    return null;
  }
  const name = os.userInfo().username;
  const entry = entries.find((line) => line.startsWith(`${name}:`));
  if (!entry) return null;
  const base = Number(entry.split(":")[1]);
  return Number.isFinite(base) ? base : null;
}

// Runs the writer the way the plugin does: no runtime directory unless the
// test asks for one, and a temporary directory of our own.
function write(name, payload, env) {
  const command = writer.writeCommand(name, payload);
  const result = spawnSync(command[0], command.slice(1), {
    env: { ...process.env, XDG_RUNTIME_DIR: "", TMPDIR: "", ...env },
    encoding: "utf8",
  });
  return { status: result.status, path: result.stdout.trim(), stderr: result.stderr };
}

test("the sound is written to a private file", (t) => {
  const root = sandbox(t);
  const runtime = path.join(root, "runtime");
  const result = write("explosion.wav", PAYLOAD, { XDG_RUNTIME_DIR: runtime, TMPDIR: path.join(root, "tmp") });

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.path.startsWith(runtime), `the sound should stay in the runtime directory, got ${result.path}`);
  assert.ok(fs.lstatSync(result.path).isFile(), "the sound should be a regular file");
  assert.deepEqual(fs.readFileSync(result.path), Buffer.from(PAYLOAD, "base64"));

  // The file and the directory it lives in are readable by nobody else.
  assert.equal(fs.statSync(result.path).mode & 0o777, 0o600, "the sound file should be private");
  const dir = fs.statSync(path.dirname(result.path));
  assert.equal(dir.mode & 0o777, 0o700, "the directory should be private");
  assert.equal(dir.uid, process.getuid(), "the directory should belong to us");
});

test("without a runtime directory the sound still lands in a private directory", (t) => {
  const root = sandbox(t);
  const tmp = path.join(root, "tmp");
  const result = write("explosion.wav", PAYLOAD, { XDG_RUNTIME_DIR: "", TMPDIR: tmp });

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.path.startsWith(tmp), `the sound should land under the temporary directory, got ${result.path}`);
  const dir = fs.statSync(path.dirname(result.path));
  assert.equal(dir.mode & 0o777, 0o700, "the directory should be private");
  assert.equal(dir.uid, process.getuid(), "the directory should belong to us");
});

test("a symlink planted where the sound goes is replaced, not followed", (t) => {
  const root = sandbox(t);
  const runtime = path.join(root, "runtime");
  const victim = path.join(root, "victim-file");
  fs.writeFileSync(victim, "IMPORTANT VICTIM DATA\n");
  const env = { XDG_RUNTIME_DIR: runtime, TMPDIR: path.join(root, "tmp") };

  const first = write("explosion.wav", PAYLOAD, env);
  assert.equal(first.status, 0, first.stderr);

  // Somebody who can write into the sound directory plants a symlink where
  // the sound file goes, pointing at a file the victim owns.
  fs.unlinkSync(first.path);
  fs.symlinkSync(victim, first.path);

  const second = write("explosion.wav", PAYLOAD, env);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(fs.readFileSync(victim, "utf8"), "IMPORTANT VICTIM DATA\n", "the victim's file must not be overwritten");
  assert.ok(fs.lstatSync(second.path).isFile(), "the sound should be a regular file, not a symlink");
  assert.deepEqual(fs.readFileSync(second.path), Buffer.from(PAYLOAD, "base64"));
});

test("a directory claimed by another account is not used", (t) => {
  const root = sandbox(t);
  const runtime = path.join(root, "runtime");
  const victim = path.join(root, "victim-file");
  fs.writeFileSync(victim, "IMPORTANT VICTIM DATA\n");
  const env = { XDG_RUNTIME_DIR: runtime, TMPDIR: path.join(root, "tmp") };

  const first = write("explosion.wav", PAYLOAD, env);
  assert.equal(first.status, 0, first.stderr);

  // Another account claims the directory the writer used: it is now a
  // symlink to a directory the attacker controls, which holds a symlink
  // where the sound file goes.
  const attacker = path.join(root, "attacker");
  fs.mkdirSync(attacker);
  fs.symlinkSync(victim, path.join(attacker, "explosion.wav"));
  const claimed = path.dirname(first.path);
  fs.rmSync(claimed, { recursive: true, force: true });
  fs.symlinkSync(attacker, claimed);

  const second = write("explosion.wav", PAYLOAD, env);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(fs.readFileSync(victim, "utf8"), "IMPORTANT VICTIM DATA\n", "the victim's file must not be overwritten");
  const used = fs.realpathSync(path.dirname(second.path));
  assert.notEqual(used, fs.realpathSync(attacker), `the sound must not be written into the attacker's directory, got ${second.path}`);
  assert.deepEqual(fs.readFileSync(second.path), Buffer.from(PAYLOAD, "base64"));
});

test("a directory owned by another account is not used", (t) => {
  // A user namespace lets us act as a second account; without a subuid
  // range (or user namespaces) the case cannot be staged here.
  const base = subuidBase();
  if (base === null) return t.skip("no subuid range is available");
  const mapping = ["-r", `--map-users=1:${base}:1`, `--map-groups=1:${base}:1`];
  if (spawnSync("unshare", [...mapping, "id", "-u"], { encoding: "utf8" }).status !== 0) {
    return t.skip("user namespaces are not available");
  }

  // The other account has to be able to reach the runtime directory, so
  // this sandbox lives in the shared temporary directory and can be
  // traversed.
  const root = sandbox(t, "/tmp");
  fs.chmodSync(root, 0o755);
  const runtime = path.join(root, "runtime");
  // Inside the namespace we are uid 0, so the directory the writer looks
  // for is named after uid 0. The other account claims that name.
  const runner = path.join(root, "runner.sh");
  fs.writeFileSync(
    runner,
    `#!/bin/bash
set -eu
runtime="$1"
shift
chmod 0777 "$runtime"
setpriv --reuid=1 --regid=1 --clear-groups mkdir -p "$runtime/touchtype-0"
export XDG_RUNTIME_DIR="$runtime"
status=0
"$@" || status=$?
# The claimed directory belongs to the other account, so only that account
# can take it away again.
setpriv --reuid=1 --regid=1 --clear-groups rm -rf "$runtime/touchtype-0"
exit $status
`
  );

  const command = writer.writeCommand("explosion.wav", PAYLOAD);
  const result = spawnSync("unshare", [...mapping, "bash", runner, runtime, ...command], { encoding: "utf8" });
  const written = result.stdout.trim();

  assert.equal(result.status, 0, result.stderr);
  const claimed = path.join(runtime, "touchtype-0");
  assert.ok(!written.startsWith(claimed), `the sound must not be written into the claimed directory, got ${written}`);
  const dir = fs.statSync(path.dirname(written));
  assert.equal(dir.mode & 0o777, 0o700, "the directory should be private");
  assert.equal(dir.uid, process.getuid(), "the directory should belong to us");
  assert.notEqual(dir.uid, base, "the directory should not belong to the other account");
});
