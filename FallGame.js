// Rules of the Falling Letters game.
//
// Pure JS, no imports: the planned characters, the hits, the misses, the
// lives and the end of a round all live here so they can be exercised by the
// Node test suite without a running shell. Every operation returns a NEW
// session instead of mutating the one it is given — the caller reassigns its
// bound property so QML bindings refresh.
//
// A session is a list of letter records, `{ index, char, x, state }`, and a
// cursor (`index`) over it. A record's state is "queued" (not dropped yet),
// "falling" (on its way down), "hit" or "missed" — one record, one place that
// knows everything about that character, so the queue, the spots the letters
// start from and their outcomes cannot drift apart.
.pragma library

function clamp01(value) {
  if (typeof value !== "number" || value < 0) return 0
  if (value > 1) return 1
  return value
}

// Builds the planned characters for a level: `count` characters drawn at
// random from the level's key set. Each gets its own spot across the play
// field, as a fraction of its width (0 is the left edge, 1 the right edge),
// so the learner scans the whole width for the falling character rather than
// waiting in one column.
function buildLetters(level, rng) {
  rng = rng || Math.random
  var keys = (level && level.keys) || []
  var count = (level && level.count) || 0
  var out = []
  if (keys.length === 0) return out
  for (var i = 0; i < count; i++) {
    var x = rng()
    // Two characters in the same spot in a row read as a single column, so
    // re-roll a few times when that happens and then take what we got.
    var tries = 0
    while (tries < 5 && i > 0 && Math.abs(x - out[i - 1].x) < 0.05) {
      x = rng()
      tries++
    }
    out.push({
      index: i,
      char: keys[Math.floor(rng() * keys.length)],
      x: clamp01(x),
      state: "queued"
    })
  }
  return out
}

// Starts a round. The level states how many lives the learner gets.
function createSession(level, rng) {
  var letters = buildLetters(level, rng)
  return {
    letters: letters,
    index: 0,
    hits: 0,
    missed: 0,
    wrongPresses: 0,
    wrongByChar: {},
    lives: level.lives,
    total: letters.length,
    finished: false
  }
}

function copy(session) {
  var next = {}
  for (var key in session) next[key] = session[key]
  next.letters = session.letters.map(function (letter) {
    return { index: letter.index, char: letter.char, x: letter.x, state: letter.state }
  })
  next.wrongByChar = {}
  for (var ch in session.wrongByChar) next.wrongByChar[ch] = session.wrongByChar[ch]
  return next
}

// The character that falls next — its plan index, its key and the spot it
// starts from — or null when the level has nothing left to drop.
function nextLetter(session) {
  if (!session || session.finished) return null
  if (session.index >= session.letters.length) return null
  var letter = session.letters[session.index]
  return { index: letter.index, char: letter.char, x: letter.x }
}

// Puts the next planned character on its way down. Several letters can be on
// their way down at the same time, oldest first.
function spawn(session) {
  if (!session || session.finished) return session
  if (session.index >= session.letters.length) return session
  var next = copy(session)
  next.letters[next.index].state = "falling"
  next.index++
  return next
}

// The letters on their way down right now, oldest first.
function fallingLetters(session) {
  if (!session || !session.letters) return []
  return session.letters.filter(function (letter) {
    return letter.state === "falling"
  })
}

// The oldest falling letter with that character, or null when no letter
// carries it.
function findFalling(session, char) {
  var letters = fallingLetters(session)
  for (var i = 0; i < letters.length; i++) {
    if (letters[i].char === char) return letters[i]
  }
  return null
}

// The character the learner was expected to press: the letter that has been
// falling the longest, because that is the one about to be lost.
function expectedChar(session) {
  var letters = fallingLetters(session)
  return letters.length > 0 ? letters[0].char : ""
}

// The character was typed in time: the letter it knocks out counts as a hit
// and leaves the field.
function registerHit(session, char) {
  var letter = findFalling(session, char)
  if (!letter) return session
  var next = copy(session)
  next.letters[letter.index].state = "hit"
  next.hits++
  next.finished = isFinished(next)
  return next
}

// A letter reached the bottom: it counts as a miss and costs a life.
function registerMiss(session, index) {
  var next = copy(session)
  if (next.letters[index] && next.letters[index].state === "falling") {
    next.letters[index].state = "missed"
  }
  next.missed++
  next.lives--
  next.finished = isFinished(next)
  return next
}

// A key was pressed that is not one of the falling characters. It does not
// hit anything; it is recorded against the character that was expected, so it
// shows up in the weak-key statistics.
function registerWrong(session, expected) {
  var next = copy(session)
  next.wrongPresses++
  if (expected) {
    next.wrongByChar[expected] = (next.wrongByChar[expected] || 0) + 1
  }
  return next
}

// True when the round is over: the lives ran out, or every planned
// character has been resolved and none is still falling.
function isFinished(session) {
  if (!session) return true
  if (session.finished === true) return true
  if (session.lives <= 0) return true
  if (session.index < session.letters.length) return false
  return fallingLetters(session).length === 0
}

// True when the round ended because the lives ran out with characters still
// unresolved: the learner walked away from a round that was not finished, so
// the round is a failure whatever the hit rate says.
function ranOutOfLives(session) {
  if (!session || session.lives > 0) return false
  return session.hits + session.missed < session.total
}

// Characters hit ÷ characters planned — the number the level is judged on.
function hitRate(session) {
  if (!session || session.total <= 0) return 0
  return session.hits / session.total
}

// Per-key hit/miss statistics in the shape the progress store expects:
// { char: { hits: n, misses: n } }. A missed character and a wrong key
// press both count as misses on the key they belong to.
function keyResults(session) {
  var out = {}
  if (!session) return out
  for (var i = 0; i < session.letters.length; i++) {
    var letter = session.letters[i]
    if (letter.state !== "hit" && letter.state !== "missed") continue
    var stat = out[letter.char] || { hits: 0, misses: 0 }
    if (letter.state === "hit") stat.hits++
    else stat.misses++
    out[letter.char] = stat
  }
  for (var wrong in session.wrongByChar) {
    var wstat = out[wrong] || { hits: 0, misses: 0 }
    wstat.misses += session.wrongByChar[wrong]
    out[wrong] = wstat
  }
  return out
}
