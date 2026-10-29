const test = require("node:test");
const assert = require("node:assert/strict");
const { loadScript } = require("./helpers/loadScript.js");

const sounds = loadScript("Sounds.js");

// Decodes base64 the way the shell will, so the tests can look at the
// bytes the plugin writes to disk.
function decodeBase64(text) {
  return Buffer.from(text, "base64");
}

test("the explosion is a WAV file with the right header", () => {
  const wav = decodeBase64(sounds.explosionWav());
  assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(wav.subarray(8, 12).toString("ascii"), "WAVE");
  assert.equal(wav.subarray(12, 16).toString("ascii"), "fmt ");
  // One channel, 16 bits per sample.
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(24), sounds.SAMPLE_RATE);
  assert.equal(wav.subarray(36, 40).toString("ascii"), "data");
});

test("the header says how long the sound is", () => {
  const wav = decodeBase64(sounds.explosionWav());
  const dataSize = wav.readUInt32LE(40);
  assert.equal(wav.length, 44 + dataSize);
  assert.equal(wav.readUInt32LE(4), 36 + dataSize);
});

test("the beep is a WAV file too", () => {
  const wav = decodeBase64(sounds.beepWav());
  assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(wav.subarray(8, 12).toString("ascii"), "WAVE");
  assert.ok(wav.length > 44);
});

test("the blast starts loud and dies away", () => {
  const samples = sounds.explosionSamples(400);
  assert.ok(samples.length > 0);
  for (const sample of samples) {
    assert.ok(sample >= -1 && sample <= 1, `sample ${sample} is out of range`);
  }
  const peak = (from, to) => {
    let loudest = 0;
    for (let i = from; i < to; i++) loudest = Math.max(loudest, Math.abs(samples[i]));
    return loudest;
  };
  assert.ok(peak(0, 200) > 0.2, "the blast should start loud");
  assert.ok(peak(samples.length - 400, samples.length) < 0.05, "the blast should die away");
});

test("the beep is short and quiet at its edges", () => {
  const samples = sounds.beepSamples(220);
  assert.ok(samples.length > 0);
  assert.ok(Math.abs(samples[0]) < 0.2, "the beep should not click at the start");
  let loudest = 0;
  for (const sample of samples) loudest = Math.max(loudest, Math.abs(sample));
  assert.ok(loudest > 0.3, "the beep should be audible");
  assert.ok(Math.abs(samples[samples.length - 1]) < 0.1, "the beep should fade out");
});

// A sound nobody can hear is not a sound: the beep has to be as loud as the
// blast, and pitched where a laptop speaker can actually reproduce it. An
// earlier low, quiet beep was played on every wrong key and still went
// unnoticed.
test("every sound is normalised to a comparable level", () => {
  const peakOf = (samples) => samples.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
  const boom = peakOf(sounds.explosionSamples(400));
  const beep = peakOf(sounds.beepSamples(220));
  assert.ok(boom > 0.9, `the blast peaks at ${boom}, too quiet`);
  assert.ok(beep > 0.8, `the beep peaks at ${beep}, too quiet`);
});

test("the beep is pitched high enough for a small speaker", () => {
  const samples = sounds.beepSamples(220);
  // Count the zero crossings of the loud first half of the beep: a pure
  // tone crosses zero twice per cycle, so the count gives its frequency.
  let crossings = 0;
  const half = Math.floor(samples.length / 2);
  for (let i = 1; i < half; i++) {
    if ((samples[i - 1] < 0 && samples[i] >= 0) || (samples[i - 1] >= 0 && samples[i] < 0)) crossings++;
  }
  const seconds = half / sounds.SAMPLE_RATE;
  const frequency = crossings / 2 / seconds;
  assert.ok(frequency >= 400, `the beep sits at ${Math.round(frequency)} Hz, too low to be heard`);
});

test("the base64 encoding matches the standard one", () => {
  const bytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) bytes[i] = i;
  assert.equal(sounds.toBase64(bytes), Buffer.from(bytes).toString("base64"));
});
