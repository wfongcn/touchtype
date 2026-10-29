// The sounds of the Falling Letters game.
//
// Pure JS, no imports: the blast of a letter that was hit and the beep of
// a wrong key are synthesised here as small WAV files, so the plugin
// carries no audio files of its own. The caller writes the base64 payload
// to disk and points a sound player at the file.
//
// Every operation returns plain values — the samples are arrays of numbers
// between -1 and 1 — so the Node test suite can exercise them without a
// running shell.
.pragma library

// The sample rate of the generated files. 22 kHz is plenty for a blast and
// a beep, and it keeps the files small.
var SAMPLE_RATE = 22050

var BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

// A small deterministic noise source, so the blast sounds the same every
// time it is played.
function makeNoise(seed) {
  var state = seed >>> 0
  return function () {
    state = (state * 1664525 + 1013904223) >>> 0
    return (state / 4294967296) * 2 - 1
  }
}

function sampleCount(durationMs, sampleRate) {
  var rate = sampleRate || SAMPLE_RATE
  return Math.floor(rate * durationMs / 1000)
}

// Scales the samples so that the loudest one reaches the target level, so
// every sound is heard at a comparable strength.
function normalize(samples, target) {
  var peak = 0
  for (var i = 0; i < samples.length; i++) {
    var value = Math.abs(samples[i])
    if (value > peak) peak = value
  }
  if (peak <= 0) return samples
  var scale = target / peak
  var out = []
  for (var j = 0; j < samples.length; j++) out.push(samples[j] * scale)
  return out
}

// The blast of a letter that was hit: a burst of noise that dies away at
// once, over a low tone that slides down. The two together read as an
// explosion rather than as a click.
function explosionSamples(durationMs, sampleRate) {
  var count = sampleCount(durationMs, sampleRate)
  var out = []
  var noise = makeNoise(20251029)
  for (var i = 0; i < count; i++) {
    var t = i / (sampleRate || SAMPLE_RATE)
    var progress = count > 0 ? i / count : 0
    // The crack: white noise, gone in a fraction of a second.
    var crack = noise() * Math.exp(-t * 26) * 0.5
    // The boom: a low tone that slides from 120 Hz down to 45 Hz.
    var boom = Math.sin(2 * Math.PI * (120 - 75 * progress) * t) * Math.exp(-t * 7) * 0.6
    var value = crack + boom
    if (value > 1) value = 1
    if (value < -1) value = -1
    out.push(value)
  }
  return normalize(out, 0.95)
}

// The beep of a wrong key: a short tone with a quick attack and a quick
// decay, the "beep" of a machine that says no. It sits at a pitch that
// carries over the bang of a hit, so a mistake is heard even in the
// middle of a busy field.
function beepSamples(durationMs, sampleRate) {
  var count = sampleCount(durationMs, sampleRate)
  var out = []
  for (var i = 0; i < count; i++) {
    var t = i / (sampleRate || SAMPLE_RATE)
    var envelope = Math.min(1, t * 120) * Math.exp(-t * 11)
    var tone = Math.sin(2 * Math.PI * 700 * t) * 0.7 + Math.sin(2 * Math.PI * 1400 * t) * 0.2
    var value = tone * envelope
    if (value > 1) value = 1
    if (value < -1) value = -1
    out.push(value)
  }
  return normalize(out, 0.85)
}

function writeString(bytes, offset, text) {
  for (var i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i)
}

function writeU16(bytes, offset, value) {
  bytes[offset] = value & 255
  bytes[offset + 1] = (value >> 8) & 255
}

function writeU32(bytes, offset, value) {
  bytes[offset] = value & 255
  bytes[offset + 1] = (value >> 8) & 255
  bytes[offset + 2] = (value >> 16) & 255
  bytes[offset + 3] = (value >> 24) & 255
}

function writeSample(bytes, offset, value) {
  var v = Math.round(value * 32767)
  if (v < 0) v += 65536
  bytes[offset] = v & 255
  bytes[offset + 1] = (v >> 8) & 255
}

// Wraps the samples in a WAV file: a 44 byte header (RIFF/WAVE, one
// channel, 16 bits per sample) followed by the samples themselves.
function wavBytes(samples, sampleRate) {
  var rate = sampleRate || SAMPLE_RATE
  var dataSize = samples.length * 2
  var bytes = new Uint8Array(44 + dataSize)
  writeString(bytes, 0, "RIFF")
  writeU32(bytes, 4, 36 + dataSize)
  writeString(bytes, 8, "WAVE")
  writeString(bytes, 12, "fmt ")
  writeU32(bytes, 16, 16)
  writeU16(bytes, 20, 1)
  writeU16(bytes, 22, 1)
  writeU32(bytes, 24, rate)
  writeU32(bytes, 28, rate * 2)
  writeU16(bytes, 32, 2)
  writeU16(bytes, 34, 16)
  writeString(bytes, 36, "data")
  writeU32(bytes, 40, dataSize)
  for (var i = 0; i < samples.length; i++) writeSample(bytes, 44 + i * 2, samples[i])
  return bytes
}

// Base64 of the bytes, as plain ASCII text — safe to hand to a shell.
function toBase64(bytes) {
  var out = ""
  for (var i = 0; i < bytes.length; i += 3) {
    var b0 = bytes[i]
    var b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined
    var b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined
    out += BASE64_ALPHABET.charAt(b0 >> 2)
    out += BASE64_ALPHABET.charAt(((b0 & 3) << 4) | (b1 === undefined ? 0 : (b1 >> 4)))
    if (b1 === undefined) { out += "=="; break }
    out += BASE64_ALPHABET.charAt(((b1 & 15) << 2) | (b2 === undefined ? 0 : (b2 >> 6)))
    if (b2 === undefined) { out += "="; break }
    out += BASE64_ALPHABET.charAt(b2 & 63)
  }
  return out
}

// The explosion, as a base64 WAV file.
function explosionWav(durationMs) {
  return toBase64(wavBytes(explosionSamples(durationMs || 400), SAMPLE_RATE))
}

// The wrong-key beep, as a base64 WAV file.
function beepWav(durationMs) {
  return toBase64(wavBytes(beepSamples(durationMs || 220), SAMPLE_RATE))
}
