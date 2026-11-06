import QtQuick
import qs.Commons
import qs.Ui

// The play field of the Falling Letters game: characters falling from the top
// of the field to the bottom, each from its own spot across the width, and
// the blast of a letter that was hit.
//
// The screen drives it — spawn() puts a character on its way down,
// knockOut() takes one out where it stands, clear() empties the field — and it
// reports back what the game rules need: a letter that reached the bottom
// (landed), one that has fallen halfway (halfway, which lets the next one
// start) and one that exploded (exploded, so the screen can play the bang).
Rectangle {
  id: field

  // Theme inputs, so the field looks like the rest of the trainer.
  property color foreground: Color.foreground
  property string glyphFont: ""
  property real cardRadius: 10
  // How long one character takes to fall, top to bottom.
  property int fallMs: 4000

  // The letter reached the bottom of the field.
  signal landed(int planIndex)
  // The letter has fallen halfway: the next one may start.
  signal halfway(int planIndex)
  // A letter was knocked out and exploded where it stood.
  signal exploded()

  // The letters on the field right now, oldest first.
  property var letters: []

  radius: Math.min(field.cardRadius, 10)
  color: Util.alpha(field.foreground, 0.04)
  border.width: 1
  border.color: Util.alpha(field.foreground, 0.12)
  clip: true

  function spawn(planIndex, char, xFrac) {
    var letter = letterComponent.createObject(field)
    if (!letter) return false
    letter.planIndex = planIndex
    letter.letterChar = char
    letter.xFrac = xFrac
    field.letters = field.letters.concat([letter])
    // Start the fall once the letter carries its character, so its length is
    // already known when the animation works out where the bottom is.
    letter.startFall()
    return true
  }

  // Takes a letter off the field. Returns it, or null when the field does not
  // hold it any more.
  function take(planIndex) {
    for (var i = 0; i < field.letters.length; i++) {
      if (field.letters[i].planIndex !== planIndex) continue
      var letter = field.letters[i]
      field.letters = field.letters.slice(0, i).concat(field.letters.slice(i + 1))
      letter.stopFall()
      return letter
    }
    return null
  }

  // The letter was hit: it disappears in a blast where it stood.
  function knockOut(planIndex) {
    var letter = field.take(planIndex)
    if (!letter) return false
    var point = letter.burstPoint()
    letter.destroy()
    field.explodeAt(point)
    return true
  }

  // A letter reached the bottom: take it off the field and report it.
  function land(planIndex) {
    var letter = field.take(planIndex)
    if (!letter) return false
    letter.destroy()
    field.landed(planIndex)
    return true
  }

  // Takes the letters off the field — used when a round is finished or
  // abandoned, so no letter of the old round can report into the next one.
  function clear() {
    var old = field.letters
    field.letters = []
    for (var i = 0; i < old.length; i++) {
      old[i].stopFall()
      old[i].destroy()
    }
  }

  function explodeAt(point) {
    var blast = blastComponent.createObject(field)
    if (!blast) return
    blast.x = point.x
    blast.y = point.y
    field.exploded()
  }

  // The blast of a letter that was hit: a ring of light and a spray of
  // pieces at the spot the letter stood.
  Component {
    id: blastComponent

    Item {
      id: blast
      width: 0
      height: 0

      Rectangle {
        width: 12
        height: 12
        radius: 6
        color: "transparent"
        border.width: 3
        border.color: Color.accent
        anchors.centerIn: parent
        NumberAnimation on scale { from: 0.3; to: 3.4; duration: 320; easing.type: Easing.OutQuad }
        NumberAnimation on opacity { from: 0.95; to: 0; duration: 320 }
      }

      Repeater {
        model: 12
        Rectangle {
          required property int index
          // The pieces fan out evenly around the blast.
          readonly property real angle: (index * 137.5) * Math.PI / 180
          readonly property real reach: 30 + (index % 4) * 11
          width: 7
          height: 7
          radius: 3.5
          color: index % 3 === 0 ? Color.accent : field.foreground
          x: -width / 2
          y: -height / 2
          NumberAnimation on x {
            from: -width / 2
            to: -width / 2 + Math.cos(angle) * reach
            duration: 360 + index * 10
            easing.type: Easing.OutCubic
          }
          NumberAnimation on y {
            from: -height / 2
            to: -height / 2 + Math.sin(angle) * reach
            duration: 360 + index * 10
            easing.type: Easing.OutCubic
          }
          NumberAnimation on opacity { from: 1; to: 0; duration: 360 + index * 10 }
          ScaleAnimator on scale { from: 1; to: 0.3; duration: 360 + index * 10 }
        }
      }

      Timer {
        interval: 620
        onTriggered: blast.destroy()
      }
    }
  }

  // One letter of the field. It owns its fall animation and the timer that
  // reports the halfway mark, so several letters can be on their way down at
  // the same time.
  Component {
    id: letterComponent

    Item {
      id: letter
      property string letterChar: ""
      property real xFrac: 0
      property int planIndex: -1

      width: field.width
      height: field.height

      function stopFall() {
        fallAnim.stop()
        halfwayTimer.stop()
      }

      function startFall() {
        fallAnim.start()
        halfwayTimer.start()
      }

      // The point the letter stood at, in the field's coordinates — where its
      // blast belongs.
      function burstPoint() {
        return { x: glyph.x + glyph.width / 2, y: glyph.y + glyph.height / 2 }
      }

      Text {
        id: glyph
        // The letters keep a margin at both edges of the field, so none of
        // them sits half outside it.
        x: field.width * 0.1 + letter.xFrac * (field.width * 0.8 - width)
        y: 0
        text: letter.letterChar
        color: field.foreground
        font.family: field.glyphFont
        font.pixelSize: Style.font.displayLarge
        font.bold: true
      }

      NumberAnimation {
        id: fallAnim
        target: glyph
        property: "y"
        from: 0
        to: Math.max(0, field.height - glyph.height)
        duration: field.fallMs > 0 ? field.fallMs : 4000
        easing.type: Easing.InQuad
        onFinished: field.land(letter.planIndex)
      }

      Timer {
        id: halfwayTimer
        // The fall accelerates (InQuad), so distance = (t / duration)²: the
        // letter is halfway down the field at √0.5 ≈ 0.71 of its fall, not at
        // half the time.
        interval: Math.max(1, fallAnim.duration * 0.7071)
        onTriggered: field.halfway(letter.planIndex)
      }
    }
  }
}
