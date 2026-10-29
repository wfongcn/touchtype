const test = require("node:test");
const assert = require("node:assert/strict");
const { loadScript } = require("./helpers/loadScript.js");

const progress = loadScript("ProgressStore.js");
const i18n = loadScript("I18n.js");

const plain = (value) => JSON.parse(JSON.stringify(value));

test("a fresh progress blob carries a settings section", () => {
  const fresh = plain(progress.defaultProgress());
  assert.equal(typeof fresh.settings, "object");
  assert.equal(fresh.settings.language, "");
});

test("the language preference survives a save-and-load round trip", () => {
  const saved = progress.toJsonText({ ...progress.defaultProgress(), settings: { language: "zh-CN" } });
  const loaded = progress.parse(saved);
  assert.equal(loaded.settings.language, "zh-CN");
});

test("a missing settings section leaves the language unset", () => {
  const loaded = progress.parse(JSON.stringify({ version: 1, levels: {} }));
  assert.equal(loaded.settings.language, "");
});

test("a malformed language value is kept but never crashes the load", () => {
  const loaded = progress.parse(JSON.stringify({ settings: { language: 42 } }));
  assert.equal(loaded.settings.language, "");
  assert.equal(i18n.normalize(loaded.settings.language), "en");
});

test("an unknown language resolves to the default locale", () => {
  const loaded = progress.parse(JSON.stringify({ settings: { language: "fr" } }));
  assert.equal(loaded.settings.language, "fr");
  assert.equal(i18n.normalize(loaded.settings.language), "en");
});

test("a corrupt progress file falls back to defaults", () => {
  const loaded = progress.parse("{ not json");
  assert.equal(loaded.settings.language, "");
  assert.equal(i18n.normalize(loaded.settings.language), "en");
});

test("resetting progress clears training data but keeps the language", () => {
  const trained = progress.recordAttempt(
    progress.defaultProgress(),
    { id: "anchors", passAccuracy: 90, passWpm: 0 },
    { accuracy: 95, wpm: 20, timeMs: 5000, keyResults: { f: { hits: 9, misses: 1 } } }
  );
  const withLanguage = { ...trained.progress, settings: { language: "zh-CN" } };

  const reset = plain(progress.resetProgress(withLanguage));

  assert.equal(reset.settings.language, "zh-CN");
  assert.deepEqual(reset.levels, {});
  assert.deepEqual(reset.keyStats, {});
  assert.equal(reset.streak.count, 0);
  assert.equal(reset.totals.sessions, 0);
});

test("resetting progress without a saved language leaves it unset", () => {
  const reset = plain(progress.resetProgress(progress.defaultProgress()));
  assert.equal(reset.settings.language, "");
});

test("recording an attempt preserves the language preference", () => {
  const start = { ...progress.defaultProgress(), settings: { language: "zh-CN" } };
  const outcome = progress.recordAttempt(
    start,
    { id: "anchors", passAccuracy: 90, passWpm: 0 },
    { accuracy: 95, wpm: 20, timeMs: 5000, keyResults: {} }
  );
  assert.equal(outcome.progress.settings.language, "zh-CN");
});

test("a round that runs out of lives is a failure, whatever the hit rate says", () => {
  const level = { id: "fall-1", passAccuracy: 70, passWpm: 0 };
  // 70% would clear the bar, but the round ended early with characters still
  // unresolved, so it is a failed round.
  const outcome = progress.recordAttempt(
    progress.defaultProgress(),
    level,
    { accuracy: 70, wpm: 0, timeMs: 5000, keyResults: {}, aborted: true }
  );
  assert.equal(outcome.attemptPassed, false);
  assert.equal(outcome.passed, false);
  assert.equal(outcome.progress.levels["fall-1"].passed, false);
});

test("a level stays passed when a later round misses the bar", () => {
  const level = { id: "fall-1", passAccuracy: 80, passWpm: 0 };
  const passed = progress.recordAttempt(
    progress.defaultProgress(),
    level,
    { accuracy: 100, wpm: 10, timeMs: 5000, keyResults: {} }
  );
  assert.equal(passed.attemptPassed, true);
  assert.equal(passed.passed, true);

  const failed = progress.recordAttempt(
    passed.progress,
    level,
    { accuracy: 0, wpm: 0, timeMs: 5000, keyResults: {} }
  );
  // The round failed...
  assert.equal(failed.attemptPassed, false);
  // ...but the level stays unlocked.
  assert.equal(failed.passed, true);
  assert.equal(failed.progress.levels["fall-1"].passed, true);
});
