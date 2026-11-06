const test = require("node:test");
const assert = require("node:assert/strict");
const { loadScript } = require("./helpers/loadScript.js");

const fall = loadScript("FallGame.js");
const curriculum = loadScript("Curriculum.js");

const plain = (value) => JSON.parse(JSON.stringify(value));

// A level with a fixed key set and a fixed number of characters, so the
// tests do not depend on randomness.
const level = { keys: ["a", "b"], count: 4, lives: 3 };
const fixedRng = () => 0;
// Alternates between two spots and two keys, so the plan spreads out.
const alternatingRng = (() => {
  let i = 0;
  return () => (i++ % 2) * 0.5;
})();

// A session with one letter already on its way down.
function started(rng) {
  return plain(fall.spawn(plain(fall.createSession(level, rng || fixedRng))));
}

test("the plan holds one character per planned drop, from the key set", () => {
  const letters = plain(fall.buildLetters(level, alternatingRng));
  assert.equal(letters.length, 4);
  for (const letter of letters) {
    assert.ok(level.keys.includes(letter.char), `unexpected character "${letter.char}"`);
    assert.equal(letter.state, "queued");
    assert.equal(typeof letter.index, "number");
  }
});

test("the plan follows the level's character count", () => {
  assert.equal(plain(fall.buildLetters({ keys: ["x"], count: 7 }, fixedRng)).length, 7);
  assert.equal(plain(fall.buildLetters({ keys: [], count: 3 }, fixedRng)).length, 0);
});

test("every planned character gets a spot across the field", () => {
  const letters = plain(fall.buildLetters(level, alternatingRng));
  for (const letter of letters) {
    assert.ok(letter.x >= 0 && letter.x <= 1, `spot ${letter.x} is outside the field`);
  }
});

test("the characters do not all fall in one column", () => {
  const letters = plain(fall.buildLetters({ keys: ["a"], count: 8 }, alternatingRng));
  assert.ok(new Set(letters.map((letter) => letter.x)).size > 1, "the characters should not share one spot");
});

test("two characters in a row do not fall from the same spot", () => {
  const letters = plain(fall.buildLetters({ keys: ["a"], count: 8 }, alternatingRng));
  for (let i = 1; i < letters.length; i++) {
    assert.ok(
      Math.abs(letters[i].x - letters[i - 1].x) >= 0.05,
      `characters ${i - 1} and ${i} fall from the same spot`,
    );
  }
});

test("a session starts with the level's lives and characters", () => {
  const session = plain(fall.createSession(level, fixedRng));
  assert.equal(session.total, 4);
  assert.equal(session.lives, 3);
  assert.equal(session.hits, 0);
  assert.equal(session.missed, 0);
  assert.equal(fall.isFinished(session), false);
  assert.equal(fall.fallingLetters(session).length, 0);
  assert.equal(fall.nextLetter(session).index, 0);
});

test("a letter that is put on its way down joins the letters already falling", () => {
  let session = started();
  assert.equal(fall.fallingLetters(session).length, 1);
  assert.equal(session.letters[0].state, "falling");
  session = plain(fall.spawn(session));
  assert.equal(fall.fallingLetters(session).length, 2);
  assert.equal(session.letters[1].state, "falling");
  assert.equal(session.index, 2);
  assert.equal(fall.nextLetter(session).index, 2);
});

test("the letters that are falling keep the spots they were given", () => {
  const session = started(alternatingRng);
  assert.equal(fall.fallingLetters(session)[0].x, session.letters[0].x);
});

test("nothing falls once the plan is exhausted", () => {
  const one = { keys: ["a"], count: 1, lives: 3 };
  let session = plain(fall.createSession(one, fixedRng));
  assert.equal(fall.nextLetter(session).index, 0);
  session = plain(fall.spawn(session));
  assert.equal(fall.nextLetter(session), null);
  assert.equal(fall.isFinished(session), false);
  session = plain(fall.registerHit(session, "a"));
  assert.equal(fall.isFinished(session), true);
});

test("hitting a character counts it and takes its letter off the field", () => {
  const session = started();
  const char = fall.fallingLetters(session)[0].char;
  const after = plain(fall.registerHit(session, char));
  assert.equal(after.hits, 1);
  assert.equal(after.lives, 3);
  assert.equal(after.letters[0].state, "hit");
  assert.equal(fall.fallingLetters(after).length, 0);
});

test("hitting a character that is not falling changes nothing", () => {
  const session = started();
  const after = plain(fall.registerHit(session, "z"));
  assert.equal(after.hits, 0);
  assert.equal(fall.fallingLetters(after).length, 1);
});

test("the letter that has been falling the longest is the one expected", () => {
  let session = started();
  const first = fall.fallingLetters(session)[0].char;
  session = plain(fall.spawn(session));
  assert.equal(fall.expectedChar(session), first);
});

test("a letter that reaches the bottom costs a life", () => {
  let session = started();
  session = plain(fall.registerMiss(session, 0));
  assert.equal(session.missed, 1);
  assert.equal(session.lives, 2);
  assert.equal(session.letters[0].state, "missed");
  assert.equal(fall.fallingLetters(session).length, 0);
  assert.equal(fall.isFinished(session), false);
});

test("running out of lives ends the round", () => {
  let session = plain(fall.createSession(level, fixedRng));
  for (let i = 0; i < 3; i++) {
    session = plain(fall.spawn(session));
    session = plain(fall.registerMiss(session, i));
  }
  assert.equal(session.lives, 0);
  assert.equal(fall.isFinished(session), true);
});

test("a round that runs out of lives early was abandoned", () => {
  let session = plain(fall.createSession(level, fixedRng));
  for (let i = 0; i < 3; i++) {
    session = plain(fall.spawn(session));
    session = plain(fall.registerMiss(session, i));
  }
  assert.equal(session.hits + session.missed < session.total, true);
  assert.equal(fall.ranOutOfLives(session), true);
});

test("a round that ends on its last character was not abandoned", () => {
  let session = plain(fall.createSession(level, fixedRng));
  for (let i = 0; i < 4; i++) session = plain(fall.spawn(session));
  session = plain(fall.registerMiss(session, 0));
  session = plain(fall.registerMiss(session, 1));
  session = plain(fall.registerMiss(session, 2));
  session = plain(fall.registerHit(session, fall.fallingLetters(session)[0].char));
  assert.equal(session.lives, 0);
  assert.equal(fall.isFinished(session), true);
  assert.equal(fall.ranOutOfLives(session), false);
});

test("the round ends when every planned character has fallen", () => {
  let session = plain(fall.createSession(level, fixedRng));
  for (let i = 0; i < 4; i++) {
    session = plain(fall.spawn(session));
    session = plain(fall.registerHit(session, fall.fallingLetters(session)[0].char));
  }
  assert.equal(session.hits, 4);
  assert.equal(fall.isFinished(session), true);
  assert.equal(fall.ranOutOfLives(session), false);
});

test("a round is over once every character is resolved and none is falling", () => {
  let session = plain(fall.createSession(level, fixedRng));
  session = plain(fall.spawn(session));
  assert.equal(fall.isFinished(session), false);
  session = plain(fall.registerHit(session, fall.fallingLetters(session)[0].char));
  assert.equal(fall.isFinished(session), false);
});

test("a wrong key does not hit anything and is recorded against the expected key", () => {
  const session = started();
  const expected = fall.expectedChar(session);
  const after = plain(fall.registerWrong(session, expected));
  assert.equal(after.hits, 0);
  assert.equal(after.wrongPresses, 1);
  assert.equal(after.wrongByChar[expected], 1);
  assert.equal(fall.fallingLetters(after).length, 1);
  assert.equal(fall.isFinished(after), false);
});

test("the hit rate is hits over planned characters", () => {
  let session = started();
  assert.equal(fall.hitRate(session), 0);
  session = plain(fall.registerHit(session, fall.fallingLetters(session)[0].char));
  assert.equal(fall.hitRate(session), 0.25);
});

test("per-key statistics count hits, misses and wrong keys", () => {
  const single = { keys: ["a"], count: 3, lives: 3 };
  let session = plain(fall.spawn(plain(fall.createSession(single, fixedRng))));
  session = plain(fall.registerHit(session, "a"));
  session = plain(fall.spawn(session));
  session = plain(fall.registerMiss(session, 1));
  session = plain(fall.registerWrong(session, "a"));
  const stats = plain(fall.keyResults(session));
  assert.deepEqual(stats.a, { hits: 1, misses: 2 });
});

test("letters that are still falling are not counted in the statistics", () => {
  let session = started();
  session = plain(fall.spawn(session));
  assert.deepEqual(plain(fall.keyResults(session)), {});
});

test("the operations do not mutate the session they are given", () => {
  const session = started();
  const before = JSON.stringify(session);
  fall.registerHit(session, fall.fallingLetters(session)[0].char);
  fall.registerMiss(session, 0);
  fall.registerWrong(session, "a");
  fall.spawn(session);
  assert.equal(JSON.stringify(session), before);
});

test("every falling level produces a playable session", () => {
  for (const definition of plain(curriculum.fallLevels())) {
    const session = plain(fall.createSession(definition, fixedRng));
    assert.equal(session.total, definition.count);
    assert.equal(session.lives, definition.lives);
    for (const letter of session.letters) {
      assert.ok(definition.keys.includes(letter.char), `${definition.id} produced unexpected character "${letter.char}"`);
      assert.ok(letter.x >= 0 && letter.x <= 1, `${definition.id} put a letter outside the field`);
    }
  }
});
