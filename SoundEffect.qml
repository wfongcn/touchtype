import QtQuick
import Quickshell.Io
import QtMultimedia

// One sound effect of the Falling Letters game. The sound is synthesised by
// Sounds.js as a base64 WAV payload and written to the runtime directory, so
// the plugin carries no audio files of its own. The caller passes the payload;
// this only writes it once, points a player at it and plays it on demand.
Item {
  id: effect

  // Where the WAV file goes, and the payload that is written there.
  property string filePath: ""
  property string payload: ""
  property real volume: 0.5

  // False until the file has been written, so a hit before the writer
  // finishes stays silent instead of playing an empty file.
  property bool ready: false

  function play() {
    if (effect.ready) player.play()
  }

  MediaPlayer {
    id: player
    source: ""
    audioOutput: AudioOutput { volume: effect.volume }
  }

  Process {
    id: writer
    command: ["bash", "-c", "mkdir -p \"$(dirname \"$1\")\" && printf %s \"$2\" | base64 -d > \"$1\"",
      "bash", effect.filePath, effect.payload]
    onExited: {
      player.source = "file://" + effect.filePath
      effect.ready = true
    }
  }

  // The sound is prepared as soon as the plugin loads, so the first letter
  // that is hit already makes a noise.
  Component.onCompleted: {
    if (effect.filePath !== "" && effect.payload !== "") writer.running = true
  }
}
